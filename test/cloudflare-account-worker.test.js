'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

class MemoryStore {
  constructor(){this.accounts=new Map();this.licenses=[];this.tokens=[];this.recoveryTokens=[];this.installations=new Map();}
  async findAccount(email){return this.accounts.get(email)||null;}
  async findActiveLicense(email){return [...this.licenses].reverse().find(x=>x.email===email&&x.status==='ACTIVE'&&(!x.expiresAt||x.expiresAt>new Date().toISOString()))||null;}
  async saveActivationToken(token){this.tokens.push({...token});}
  async findActivationToken({email,digest,now}){return [...this.tokens].reverse().find(x=>x.email===email&&x.tokenDigest===digest&&!x.usedAt&&x.expiresAt>now)||null;}
  async consumeActivationToken(id,usedAt){const x=this.tokens.find(t=>t.id===id);if(x)x.usedAt=usedAt;}
  async saveInstallation(record){this.installations.set(record.installationId,{...record});}
  async findInstallation(id){return this.installations.get(id)||null;}
  async provisionLicense({email,expiresAt,codeDigest,codeExpiresAt,createdAt}){
    let account=this.accounts.get(email);if(!account){account={id:'acc-'+(this.accounts.size+1),email};this.accounts.set(email,account);}
    this.licenses.filter(x=>x.email===email&&x.status==='ACTIVE').forEach(x=>x.status='CANCELLED');
    const license={id:'lic-'+(this.licenses.length+1),accountId:account.id,email,status:'ACTIVE',expiresAt};this.licenses.push(license);
    this.tokens.push({id:'tok-'+(this.tokens.length+1),accountId:account.id,licenseId:license.id,installationId:'PENDING',email,tokenDigest:codeDigest,expiresAt:codeExpiresAt,createdAt});
    return {accountId:account.id,licenseId:license.id};
  }
  async listLicenses(){return this.licenses.map(x=>({id:x.id,email:x.email,status:x.status,expires_at:x.expiresAt,installation_id:[...this.installations.values()].find(i=>i.licenseId===x.id)?.installationId||null}));}
  async setLicenseStatus(id,status){const x=this.licenses.find(l=>l.id===id);if(x)x.status=status;}
  async saveRecoveryToken(token){this.recoveryTokens.push({...token});}
  async createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt}){const i=this.installations.get(installationId);if(!i||i.accountEmail!==email||i.status!=='ACTIVE')return null;this.recoveryTokens.push({id:'rec-'+(this.recoveryTokens.length+1),accountId:i.accountId,email,installationId,tokenDigest:codeDigest,attempts:0,createdAt,expiresAt});return {accountId:i.accountId};}
  async findRecoveryToken({email,installationId,digest,now}){return [...this.recoveryTokens].reverse().find(x=>x.email===email&&x.installationId===installationId&&x.tokenDigest===digest&&!x.usedAt&&x.expiresAt>now)||null;}
  async consumeRecoveryToken(id,usedAt){const x=this.recoveryTokens.find(t=>t.id===id);if(x)x.usedAt=usedAt;}
}

async function loadWorker(){return import('../cloudflare/account/src/worker.mjs');}
function request(path,init={}){return new Request('https://account.example'+path,{headers:{'content-type':'application/json',...(init.headers||{})},...init});}
function env(){return {ACCOUNT_STORE:new MemoryStore(),ACTIVATION_PEPPER:'activation-test',RECOVERY_PEPPER:'recovery-test',ADMIN_TOKEN:'admin-test'};}
function adminHeaders(){return {authorization:'Bearer admin-test'};}

test('health and admin panel are exposed without exposing admin data',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  assert.equal((await handleRequest(request('/health'),e)).status,200);
  const panel=await handleRequest(request('/admin'),e);assert.equal(panel.status,200);assert.match(await panel.text(),/Painel de Licencas ArtiSys/);
  assert.equal((await handleRequest(request('/v1/admin/licenses'),e)).status,401);
});

test('admin releases license and displays a six digit code that activates exactly one installation',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  let response=await handleRequest(request('/v1/admin/licenses',{method:'POST',headers:adminHeaders(),body:JSON.stringify({email:'Owner@Example.com'})}),e);
  assert.equal(response.status,201);const released=await response.json();assert.equal(released.email,'owner@example.com');assert.match(released.code,/^\d{6}$/);
  assert.equal(e.ACCOUNT_STORE.tokens[0].installationId,'PENDING');assert.ok(e.ACCOUNT_STORE.tokens[0].tokenDigest);assert.equal('code' in e.ACCOUNT_STORE.tokens[0],false);

  response=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com',code:released.code})}),e);
  assert.equal(response.status,200);assert.equal((await response.json()).licenseId,released.licenseId);
  assert.equal((await e.ACCOUNT_STORE.findInstallation('install-001')).accountEmail,'owner@example.com');

  const replay=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-002',email:'owner@example.com',code:released.code})}),e);
  assert.equal(replay.status,400);
});

test('activation request no longer sends email or creates a code',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  const response=await handleRequest(request('/v1/activation/request',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com'})}),e);
  assert.equal(response.status,202);assert.equal(e.ACCOUNT_STORE.tokens.length,0);
});

test('recovery code can only be generated for the activated installation and is single-use',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  let response=await handleRequest(request('/v1/admin/licenses',{method:'POST',headers:adminHeaders(),body:JSON.stringify({email:'owner@example.com'})}),e);
  const released=await response.json();
  await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com',code:released.code})}),e);

  response=await handleRequest(request('/v1/admin/recovery',{method:'POST',headers:adminHeaders(),body:JSON.stringify({installationId:'install-001',email:'owner@example.com'})}),e);
  assert.equal(response.status,201);const recovery=await response.json();assert.match(recovery.code,/^\d{6}$/);
  assert.equal(e.ACCOUNT_STORE.recoveryTokens[0].installationId,'install-001');

  const wrongInstall=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({installationId:'install-002',email:'owner@example.com',code:recovery.code})}),e);
  assert.equal(wrongInstall.status,400);
  response=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com',code:recovery.code})}),e);
  assert.equal(response.status,200);assert.equal((await response.json()).verified,true);
  const replay=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com',code:recovery.code})}),e);
  assert.equal(replay.status,400);
});
