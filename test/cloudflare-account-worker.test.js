'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

class MemoryStore {
  constructor(){this.accounts=new Map();this.licenses=[];this.tokens=[];this.installations=new Map();this.delivery=[];}
  async findActiveLicense(email){return this.licenses.find(item=>item.email===email&&item.status==='ACTIVE')||null;}
  async saveActivationToken(token){this.tokens.push({...token});}
  async findActivationToken({email,digest,now}){return this.tokens.find(item=>item.email===email&&item.tokenDigest===digest&&!item.usedAt&&item.expiresAt>now)||null;}
  async consumeActivationToken(id,usedAt){const item=this.tokens.find(token=>token.id===id);if(item)item.usedAt=usedAt;}
  async saveInstallation(record){this.installations.set(record.installationId,{...record});}
  async findInstallation(id){return this.installations.get(id)||null;}
  async logEmail(record){this.delivery.push({...record});}
}

async function loadWorker(){return import('../cloudflare/account/src/worker.mjs');}
function request(path,init={}){return new Request(`https://account.example${path}`,{headers:{'content-type':'application/json',...(init.headers||{})},...init});}

function envWithLicense(){
  const store=new MemoryStore();
  store.licenses.push({id:'lic-1',email:'owner@example.com',status:'ACTIVE'});
  const sent=[];
  return {store,sent,env:{ACCOUNT_STORE:store,ACTIVATION_PEPPER:'test-pepper',EMAIL:{send:async(message)=>{sent.push(message);}}}};
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
  const env={ACCOUNT_STORE:store,ACTIVATION_PEPPER:'pepper',EMAIL:{send:async(message)=>sent.push(message)}};
  let response=await handleRequest(request('/v1/activation/request',{method:'POST',body:JSON.stringify({installationId:'install-1',email:'missing@example.com'})}),env);
  assert.equal(response.status,202);assert.equal(sent.length,0);

  store.licenses.push({id:'lic-1',email:'owner@example.com',status:'ACTIVE'});
  response=await handleRequest(request('/v1/activation/request',{method:'POST',body:JSON.stringify({installationId:'install-1',email:' Owner@Example.COM '})}),env);
  assert.equal(response.status,202);assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@example.com');
  assert.equal(store.tokens.length,1);assert.ok(store.tokens[0].tokenDigest);assert.equal('code' in store.tokens[0],false);
  assert.equal(store.delivery.at(-1).status,'SENT');
});

test('activation token is expiring, single-use and binds one installation to the license',async()=>{
  const {handleRequest}=await loadWorker();
  const {store,sent,env}=envWithLicense();
  let response=await handleRequest(request('/v1/activation/request',{method:'POST',body:JSON.stringify({installationId:'install-1',email:'owner@example.com'})}),env);
  assert.equal(response.status,202);
  const code=sent[0].code;
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
