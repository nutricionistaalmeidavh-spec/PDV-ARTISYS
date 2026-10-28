'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');

class MemoryStore {
  constructor(){this.accounts=new Map();this.licenses=[];this.tokens=[];this.recoveryTokens=[];this.installations=new Map();this.adminSessions=[];}
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

  async rotateActivationTokenForLicense({licenseId,codeDigest,codeExpiresAt,createdAt}){
    const license=this.licenses.find(x=>x.id===licenseId&&x.status==='ACTIVE'&&(!x.expiresAt||x.expiresAt>createdAt));
    if(!license)return null;
    for(const token of this.tokens.filter(x=>x.licenseId===licenseId&&!x.usedAt))token.usedAt=createdAt;
    this.tokens.push({id:'tok-'+(this.tokens.length+1),accountId:license.accountId,licenseId,installationId:'PENDING',email:license.email,tokenDigest:codeDigest,expiresAt:codeExpiresAt,createdAt});
    return {accountId:license.accountId,licenseId,email:license.email};
  }
  async listLicenses(){return this.licenses.map(x=>({id:x.id,email:x.email,status:x.status,expires_at:x.expiresAt,installation_id:[...this.installations.values()].find(i=>i.licenseId===x.id)?.installationId||null}));}
  async setLicenseStatus(id,status){const x=this.licenses.find(l=>l.id===id);if(x)x.status=status;}
  async createAdminSession(record){this.adminSessions.push({...record});}
  async findAdminSession({digest,now}){return this.adminSessions.find(x=>x.tokenDigest===digest&&!x.revokedAt&&x.expiresAt>now)||null;}
  async deleteAdminSession(digest){const x=this.adminSessions.find(x=>x.tokenDigest===digest);if(x)x.revokedAt=new Date().toISOString();}
  async saveRecoveryToken(token){this.recoveryTokens.push({...token});}
  async createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt}){const i=this.installations.get(installationId);if(!i||i.accountEmail!==email||i.status!=='ACTIVE')return null;this.recoveryTokens.push({id:'rec-'+(this.recoveryTokens.length+1),accountId:i.accountId,email,installationId,tokenDigest:codeDigest,attempts:0,createdAt,expiresAt});return {accountId:i.accountId};}
  async findRecoveryToken({email,installationId,digest,now}){return [...this.recoveryTokens].reverse().find(x=>x.email===email&&x.installationId===installationId&&x.tokenDigest===digest&&!x.usedAt&&x.expiresAt>now)||null;}
  async consumeRecoveryToken(id,usedAt){const x=this.recoveryTokens.find(t=>t.id===id);if(x)x.usedAt=usedAt;}
}

async function loadWorker(){return import('../cloudflare/account/src/worker.mjs');}
function request(path,init={}){return new Request('https://account.example'+path,{headers:{'content-type':'application/json',...(init.headers||{})},...init});}
function env(){return {ACCOUNT_STORE:new MemoryStore(),ACTIVATION_PEPPER:'activation-test',RECOVERY_PEPPER:'recovery-test',ADMIN_TOKEN:'admin-test'};}
async function login(handleRequest,e,token='admin-test'){
  const response=await handleRequest(request('/v1/admin/session',{method:'POST',body:JSON.stringify({token})}),e);
  return {response,cookie:String(response.headers.get('set-cookie')||'').split(';')[0]};
}
function cookieHeaders(cookie){return {cookie};}

test('admin area shows only login until a secure session exists',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  assert.equal((await handleRequest(request('/health'),e)).status,200);
  const loginPage=await handleRequest(request('/admin'),e);
  assert.equal(loginPage.status,200);
  const loginHtml=await loginPage.text();
  assert.match(loginHtml,/Entrar na Central/i);
  assert.doesNotMatch(loginHtml,/Liberar novo acesso/i);
  assert.equal((await handleRequest(request('/v1/admin/licenses'),e)).status,401);
});

test('valid ADMIN_TOKEN creates HttpOnly secure same-site session and reveals the Central',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  const {response,cookie}=await login(handleRequest,e);
  assert.equal(response.status,204);
  const setCookie=response.headers.get('set-cookie');
  assert.match(setCookie,/__Host-artisys_admin_session=/);
  assert.match(setCookie,/HttpOnly/i);
  assert.match(setCookie,/Secure/i);
  assert.match(setCookie,/SameSite=Strict/i);
  assert.match(setCookie,/Path=\//i);
  assert.doesNotMatch(setCookie,/admin-test/);
  assert.ok(cookie);

  const panel=await handleRequest(request('/admin',{headers:cookieHeaders(cookie)}),e);
  const html=await panel.text();
  assert.match(html,/Central de Licenças ArtiSys/);
  assert.match(html,/Liberar novo acesso/i);
  assert.match(html,/Voc[eê] envia o c[oó]digo ao cliente/i);
  assert.match(html,/Copiar c[oó]digo/i);
  assert.match(html,/Sair/i);
  assert.doesNotMatch(html,/id="token"|Bearer\s*['"+]/i);
});

test('invalid ADMIN_TOKEN cannot create an admin session',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  const {response}=await login(handleRequest,e,'wrong-token');
  assert.equal(response.status,401);
  assert.equal(response.headers.get('set-cookie'),null);
});

test('logout revokes the D1-backed session and clears the cookie',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  const {cookie}=await login(handleRequest,e);
  assert.equal((await handleRequest(request('/v1/admin/licenses',{headers:cookieHeaders(cookie)}),e)).status,200);
  const logout=await handleRequest(request('/v1/admin/session',{method:'DELETE',headers:cookieHeaders(cookie)}),e);
  assert.equal(logout.status,204);
  assert.match(logout.headers.get('set-cookie'),/Max-Age=0/i);
  assert.equal((await handleRequest(request('/v1/admin/licenses',{headers:cookieHeaders(cookie)}),e)).status,401);
});

test('worker accepts the existing Cloudflare D1 binding named artisys',()=>{
  const fs=require('node:fs');
  const source=fs.readFileSync(require.resolve('../cloudflare/account/src/worker.mjs'),'utf8');
  assert.match(source,/env\.DB\s*\|\|\s*env\.artisys/);
});

test('admin releases license and displays a six digit code that activates exactly one installation',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  const {cookie}=await login(handleRequest,e);
  let response=await handleRequest(request('/v1/admin/licenses',{method:'POST',headers:cookieHeaders(cookie),body:JSON.stringify({email:'Owner@Example.com'})}),e);
  assert.equal(response.status,201);const released=await response.json();assert.equal(released.email,'owner@example.com');assert.match(released.code,/^\d{6}$/);
  assert.equal(e.ACCOUNT_STORE.tokens[0].installationId,'PENDING');assert.ok(e.ACCOUNT_STORE.tokens[0].tokenDigest);assert.equal('code' in e.ACCOUNT_STORE.tokens[0],false);

  response=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com',code:released.code})}),e);
  assert.equal(response.status,200);assert.equal((await response.json()).licenseId,released.licenseId);
  assert.equal((await e.ACCOUNT_STORE.findInstallation('install-001')).accountEmail,'owner@example.com');

  const replay=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-002',email:'owner@example.com',code:released.code})}),e);
  assert.equal(replay.status,400);
});

test('activation code lasts 48 hours, then expires without cancelling its license',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  const {cookie}=await login(handleRequest,e);
  const response=await handleRequest(request('/v1/admin/licenses',{method:'POST',headers:cookieHeaders(cookie),body:JSON.stringify({email:'owner@example.com'})}),e);
  assert.equal(response.status,201);
  const released=await response.json();
  const token=e.ACCOUNT_STORE.tokens[0];
  assert.equal(Date.parse(released.codeExpiresAt)-Date.parse(token.createdAt),48*60*60*1000);
  assert.equal(token.expiresAt,released.codeExpiresAt);
  assert.equal(e.ACCOUNT_STORE.licenses[0].expiresAt,null);

  token.expiresAt=new Date(Date.now()-1000).toISOString();
  const expired=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-after-expiry',email:'owner@example.com',code:released.code})}),e);
  assert.equal(expired.status,400);
  assert.match((await expired.json()).error,/expirado/i);
  assert.equal(e.ACCOUNT_STORE.licenses[0].status,'ACTIVE');
});

test('activation request no longer sends email or creates a code',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  const response=await handleRequest(request('/v1/activation/request',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com'})}),e);
  assert.equal(response.status,202);assert.equal(e.ACCOUNT_STORE.tokens.length,0);
});

test('recovery code can only be generated for the activated installation and is single-use',async()=>{
  const {handleRequest}=await loadWorker();const e=env();
  const {cookie}=await login(handleRequest,e);
  let response=await handleRequest(request('/v1/admin/licenses',{method:'POST',headers:cookieHeaders(cookie),body:JSON.stringify({email:'owner@example.com'})}),e);
  const released=await response.json();
  await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com',code:released.code})}),e);

  response=await handleRequest(request('/v1/admin/recovery',{method:'POST',headers:cookieHeaders(cookie),body:JSON.stringify({installationId:'install-001',email:'owner@example.com'})}),e);
  assert.equal(response.status,201);const recovery=await response.json();assert.match(recovery.code,/^\d{6}$/);
  assert.equal(e.ACCOUNT_STORE.recoveryTokens[0].installationId,'install-001');

  const wrongInstall=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({installationId:'install-002',email:'owner@example.com',code:recovery.code})}),e);
  assert.equal(wrongInstall.status,400);
  response=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com',code:recovery.code})}),e);
  assert.equal(response.status,200);assert.equal((await response.json()).verified,true);
  const replay=await handleRequest(request('/v1/password-recovery/verify',{method:'POST',body:JSON.stringify({installationId:'install-001',email:'owner@example.com',code:recovery.code})}),e);
  assert.equal(replay.status,400);
});

test('D1 schema bootstrap executes each DDL statement individually',async()=>{
  const {D1AccountStore}=await loadWorker();
  const prepared=[];
  const db={
    exec(){throw new Error('multi-statement exec must not be used for schema bootstrap');},
    prepare(sql){
      prepared.push(sql);
      return {
        bind(){return this;},
        async run(){return {success:true};},
        async all(){
          if(sql.includes('activation_tokens'))return {results:[{name:'attempts'}]};
          if(sql.includes('password_recovery_tokens'))return {results:[{name:'installation_id'}]};
          return {results:[]};
        },
        async first(){return null;}
      };
    }
  };
  await new D1AccountStore(db).ensureSchema();
  assert.ok(prepared.some(sql=>/^CREATE TABLE IF NOT EXISTS accounts/i.test(sql)));
  assert.ok(prepared.some(sql=>/^CREATE INDEX IF NOT EXISTS idx_licenses_account_status/i.test(sql)));
  assert.equal(prepared.filter(sql=>/^CREATE TABLE/i.test(sql)).length,6);
  assert.equal(prepared.filter(sql=>/^CREATE INDEX/i.test(sql)).length,9);
});


test('administrator can reissue a 48-hour activation code after formatting without cancelling the existing license',async()=>{
  const {handleRequest}=await loadWorker();const e=env();const {cookie}=await login(handleRequest,e);
  const headers=cookieHeaders(cookie);
  const firstResponse=await handleRequest(request('/v1/admin/licenses',{method:'POST',headers,body:JSON.stringify({email:'owner@example.com'})}),e);
  assert.equal(firstResponse.status,201);const original=await firstResponse.json();
  const firstActivation=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'old-pc-001',email:original.email,code:original.code})}),e);
  assert.equal(firstActivation.status,200);
  const route='/v1/admin/licenses/'+encodeURIComponent(original.licenseId)+'/activation-code';
  const unauthorized=await handleRequest(request(route,{method:'POST'}),e);
  assert.equal(unauthorized.status,401);
  const reissuedResponse=await handleRequest(request(route,{method:'POST',headers}),e);
  assert.equal(reissuedResponse.status,201);
  const reissued=await reissuedResponse.json();
  assert.match(reissued.code,/^\\d{6}$/);
  assert.equal(reissued.licenseId,original.licenseId);
  assert.equal(reissued.email,original.email);
  assert.equal(Date.parse(reissued.codeExpiresAt)-Date.parse(e.ACCOUNT_STORE.tokens.at(-1).createdAt),48*60*60*1000);
  assert.equal(e.ACCOUNT_STORE.licenses.length,1);
  assert.equal(e.ACCOUNT_STORE.licenses[0].status,'ACTIVE');
  assert.equal((await e.ACCOUNT_STORE.findInstallation('old-pc-001')).licenseId,original.licenseId);
  const nextActivation=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'formatted-pc-002',email:original.email,code:reissued.code})}),e);
  assert.equal(nextActivation.status,200);
  assert.equal((await e.ACCOUNT_STORE.findInstallation('formatted-pc-002')).licenseId,original.licenseId);
  const replay=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'third-pc-003',email:original.email,code:reissued.code})}),e);
  assert.equal(replay.status,400);
});

test('reissuing a pending code invalidates the previous code without revoking the license',async()=>{
  const {handleRequest}=await loadWorker();const e=env();const {cookie}=await login(handleRequest,e);
  const headers=cookieHeaders(cookie);
  let r=await handleRequest(request('/v1/admin/licenses',{method:'POST',headers,body:JSON.stringify({email:'owner@example.com'})}),e);
  const initial=await r.json();
  r=await handleRequest(request('/v1/admin/licenses/'+initial.licenseId+'/activation-code',{method:'POST',headers}),e);
  assert.equal(r.status,201);const renewed=await r.json();
  assert.equal(e.ACCOUNT_STORE.tokens[0].usedAt!==undefined,true);
  const old=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'old-code-pc',email:initial.email,code:initial.code})}),e);
  assert.equal(old.status,400);
  const accepted=await handleRequest(request('/v1/activation/verify',{method:'POST',body:JSON.stringify({installationId:'new-code-pc',email:initial.email,code:renewed.code})}),e);
  assert.equal(accepted.status,200);
  const duplicateRelease=await handleRequest(request('/v1/admin/licenses',{method:'POST',headers,body:JSON.stringify({email:initial.email})}),e);
  assert.equal(duplicateRelease.status,409);
  assert.equal(e.ACCOUNT_STORE.licenses.length,1);
  assert.equal(e.ACCOUNT_STORE.licenses[0].status,'ACTIVE');
  await e.ACCOUNT_STORE.setLicenseStatus(initial.licenseId,'SUSPENDED');
  const suspended=await handleRequest(request('/v1/admin/licenses/'+initial.licenseId+'/activation-code',{method:'POST',headers}),e);
  assert.equal(suspended.status,409);
});
