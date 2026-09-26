'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

class MemoryStore {
  constructor(){this.accounts=new Map();this.licenses=[];this.tokens=[];this.recoveryTokens=[];this.installations=new Map();this.delivery=[];}
  async findAccount(email){return this.accounts.get(email)||null;}
  async findActiveLicense(email){return this.licenses.find(item=>item.email===email&&item.status==='ACTIVE')||null;}
  async saveActivationToken(token){this.tokens.push({...token});}
  async findActivationToken({email,digest,now}){return this.tokens.find(item=>item.email===email&&item.tokenDigest===digest&&!item.usedAt&&item.expiresAt>now)||null;}
  async consumeActivationToken(id,usedAt){const item=this.tokens.find(token=>token.id===id);if(item)item.usedAt=usedAt;}
  async saveRecoveryToken(token){this.recoveryTokens.push({...token});}
  async findRecoveryToken({email,digest,now}){return this.recoveryTokens.find(item=>item.email===email&&item.tokenDigest===digest&&!item.usedAt&&item.expiresAt>now&&Number(item.attempts||0)<5)||null;}
  async findLatestRecoveryToken({email,now}){return [...this.recoveryTokens].reverse().find(item=>item.email===email&&!item.usedAt&&item.expiresAt>now)||null;}
  async consumeRecoveryToken(id,usedAt){const item=this.recoveryTokens.find(token=>token.id===id);if(item)item.usedAt=usedAt;}
  async incrementRecoveryAttempts(id){const item=this.recoveryTokens.find(token=>token.id===id);if(item)item.attempts=Number(item.attempts||0)+1;}
  async saveInstallation(record){this.installations.set(record.installationId,{...record});}
  async findInstallation(id){return this.installations.get(id)||null;}
  async logEmail(record){this.delivery.push({...record});}
}

async function loadWorker(){return import('../cloudflare/account/src/worker.mjs');}
function request(path,init={}){return new Request(`https://account.example${path}`,{headers:{'content-type':'application/json',...(init.headers||{})},...init});}

function envWithLicense(){
  const store=new MemoryStore();
  store.accounts.set('owner@example.com',{id:'account-1',email:'owner@example.com'});
  store.licenses.push({id:'lic-1',accountId:'account-1',email:'owner@example.com',status:'ACTIVE'});
  const sent=[];
  return {store,sent,env:{ACCOUNT_STORE:store,ACTIVATION_PEPPER:'test-pepper',RECOVERY_PEPPER:'recovery-pepper',EMAIL_FROM:'noreply@example.com',EMAIL:{send:async(message)=>{sent.push(message);}}}};
}

test('Cloudflare account worker exposes a health endpoint',async()=>{
  const {handleRequest}=await loadWorker();
  const response=await handleRequest(request('/health'),{});
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,service:'artisys-account'});
});

test('activation request is enumeration-safe and only sends email for an active license',async()=>{
  const {handleRequest}=await loadWorker();
  const store=new MemoryStore();const sent=[];
  const env={ACCOUNT_STORE:store,ACTIVATION_PEPPER:'pepper',EMAIL_FROM:'noreply@example.com',EMAIL:{send:async(message)=>sent.push(message)}};
  let response=await handleRequest(request('/v1/activation/request',{method:'POST',body:JSON.stringify({installationId:'install-1',email:'missing@example.com'})}),env);
  assert.equal(response.status,202);assert.equal(sent.length,0);

  store.licenses.push({id:'lic-1',email:'owner@example.com',status:'ACTIVE'});
  response=await handleRequest(request('/v1/activation/request',{method:'POST',body:JSON.stringify({installationId:'install-1',email:' Owner@Example.COM '})}),env);
  assert.equal(response.status,202);assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@example.com');assert.equal(sent[0].from,'noreply@example.com');
  assert.equal(store.tokens.length,1);assert.ok(store.tokens[0].tokenDigest);assert.equal('code' in store.tokens[0],false);
  assert.equal(store.delivery.at(-1).status,'SENT');
});

test('activation token is expiring, single-use and binds one installation to the license',async()=>{
  const {handleRequest}=await loadWorker();
  const {store,sent,env}=envWithLicense();
  let response=await handleRequest(request('/v1/activation/request',{method:'POST',body:JSON.stringify({installationId:'install-1',email:'owner@example.com'})}),env);
  assert.equal(response.status,202);
  const code=sent[0].text.match(/\b(\d{6})\b/)?.[1];
  assert.match(code,/^\d{6}$/);

  response=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-1',email:'owner@example.com',code})}),env);
  assert.equal(response.status,200);
  const activation=await response.json();
  assert.equal(activation.licenseId,'lic-1');assert.equal(activation.accountEmail,'owner@example.com');
  assert.equal((await store.findInstallation('install-1')).licenseId,'lic-1');

  const replay=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-1',email:'owner@example.com',code})}),env);
  assert.equal(replay.status,400);

  const status=await handleRequest(request('/v1/license/status?installationId=install-1'),env);
  assert.equal(status.status,200);assert.equal((await status.json()).active,true);
});

test('password recovery request is enumeration-safe, rate-limited and stores only a digest',async()=>{
  const {handleRequest}=await loadWorker();
  const {store,sent,env}=envWithLicense();

  let response=await handleRequest(request('/v1/password-recovery/request',{method:'POST',body:JSON.stringify({email:'missing@example.com'})}),env);
  assert.equal(response.status,202);assert.equal(sent.length,0);

  response=await handleRequest(request('/v1/password-recovery/request',{method:'POST',body:JSON.stringify({email:' Owner@Example.COM '})}),env);
  assert.equal(response.status,202);assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@example.com');
  assert.match(sent[0].subject,/recupera/i);
  assert.equal(store.recoveryTokens.length,1);
  assert.ok(store.recoveryTokens[0].tokenDigest);
  assert.equal('code' in store.recoveryTokens[0],false);
  assert.equal(store.recoveryTokens[0].attempts,0);

  response=await handleRequest(request('/v1/password-recovery/request',{method:'POST',body:JSON.stringify({email:'owner@example.com'})}),env);
  assert.equal(response.status,202);assert.equal(sent.length,1,'second request inside rate-limit window must not send another email');
});

test('password recovery code expires, is single-use and limits invalid attempts',async()=>{
  const {handleRequest}=await loadWorker();
  const {store,sent,env}=envWithLicense();
  let response=await handleRequest(request('/v1/password-recovery/request',{method:'POST',body:JSON.stringify({email:'owner@example.com'})}),env);
  assert.equal(response.status,202);
  const code=sent[0].text.match(/\b(\d{6})\b/)?.[1];assert.match(code,/^\d{6}$/);

  const bad=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({email:'owner@example.com',code:'000000'})}),env);
  assert.equal(bad.status,400);assert.equal(store.recoveryTokens[0].attempts,1);

  response=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({email:'owner@example.com',code})}),env);
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{verified:true,accountEmail:'owner@example.com'});

  const replay=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({email:'owner@example.com',code})}),env);
  assert.equal(replay.status,400);

  await handleRequest(request('/v1/password-recovery/request',{method:'POST',body:JSON.stringify({email:'owner@example.com'})}),env);
  const current=store.recoveryTokens.at(-1);current.expiresAt='2000-01-01T00:00:00.000Z';
  const expiredCode=sent.at(-1).text.match(/\b(\d{6})\b/)?.[1];
  const expired=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({email:'owner@example.com',code:expiredCode})}),env);
  assert.equal(expired.status,400);
});