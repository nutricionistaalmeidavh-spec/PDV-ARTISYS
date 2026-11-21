'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const crypto=webcrypto;
class FakeTrialStore {
  constructor(){this.record=null;this.sent=new Set();this.licenses=[]}
  async ensure(){}
  async get(email,installationId){return this.record&&(this.record.email===email||this.record.installation_id===installationId)?this.record:null}
  async saveChallenge({email,installationId,digest,now,expiresAt}){
    const p=this.record;
    if(p&&(p.email!==email||p.installation_id!==installationId||p.consumed_at||Date.now()-Date.parse(p.last_sent_at||p.created_at)<60_000))return false;
    this.record={email,installation_id:installationId,code_digest:digest,created_at:now,expires_at:expiresAt,last_sent_at:null,attempts:0,consumed_at:null,license_id:null,welcome_status:null};
    return true;
  }
  async claimMail(p){
    const row=await this.get(p.email,p.installationId);
    if(!row||p.email!==row.email||p.installationId!==row.installation_id)return false;
    if(p.purpose==='verify'&&(!p.code||row.consumed_at))return false;
    if(p.purpose==='welcome'&&(!row.consumed_at||row.license_id!==p.licenseId))return false;
    const key=JSON.stringify(p);
    if(this.sent.has(key))return false;this.sent.add(key);return true;
  }
  async delivery(email,id,purpose,status){if(purpose==='verify')this.record.last_sent_at=new Date().toISOString();else this.record.welcome_status=status}
  async wrong(){this.record.attempts++}
  async status(installationId){return this.licenses.find(l=>l.installationId===installationId)||null}
  async activate({email,installationId,digest,now,expiresAt,licenseId}){
    const p=await this.get(email,installationId);
    if(!p||p.email!==email||p.installation_id!==installationId||p.consumed_at||p.expires_at<=now||p.attempts>=5)return null;
    if(p.code_digest!==digest){await this.wrong();return null}
    p.consumed_at=now;p.license_id=licenseId;
    this.licenses.push({email,installationId,licenseId,product:'PDV_NEXUS_2',status:'ACTIVE',expiresAt,createdAt:now,metadata_json:'{"kind":"TRIAL"}'});
    return {id:licenseId,expiresAt};
  }
}
function req(path,body){return new Request('https://license.example'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}
test('Nexus trial: email challenge, signed 72h entitlement, welcome and no repeat',async()=>{
  const {handleRequest}=await import('../cloudflare/account/src/worker.mjs');
  const {verifyNexusEntitlement}=await import('../cloudflare/account/src/nexus-trial.mjs');
  const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const jwk=await crypto.subtle.exportKey('jwk',pair.privateKey);
  const env={
    NEXUS_TRIAL_PEPPER:'a-test-pepper-with-at-least-twenty-characters',
    NEXUS_LICENSE_SIGNING_JWK:JSON.stringify(jwk),
    NEXUS_TRIAL_STORE:new FakeTrialStore(),
    ACCOUNT_STORE:{findActiveLicense:async()=>null},
  };
  const mail=[];
  env.NEXUS_MAIL_FETCH=async(url,opts)=>{
    assert.match(url,/\/nexus$/);
    const payload=JSON.parse(opts.body);
    const auth=await handleRequest(req('/v1/nexus/trial/relay-authorize',payload),env);
    assert.equal((await auth.json()).authorized,true);
    mail.push(payload);
    return Response.json({accepted:true});
  };
  const email='store@example.com',installationId='unit-abc1234567';
  const request=await handleRequest(req('/v1/nexus/trial/request',{email,installationId}),env);
  assert.equal(request.status,202);
  assert.equal(mail.length,1);
  assert.equal(mail[0].purpose,'verify');
  const wrong=await handleRequest(req('/v1/nexus/trial/confirm',{email,installationId,code:'000000'}),env);
  assert.equal(wrong.status,409);
  const confirm=await handleRequest(req('/v1/nexus/trial/confirm',{email,installationId,code:mail[0].code}),env);
  assert.equal(confirm.status,201);
  const output=await confirm.json();
  assert.equal(output.entitlement.payload.product,'PDV_NEXUS_2');
  assert.equal(output.entitlement.payload.kind,'TRIAL');
  assert.equal(Date.parse(output.expiresAt)-Date.parse(output.entitlement.payload.issuedAt),72*60*60*1000);
  assert.equal(await verifyNexusEntitlement(env,output.entitlement),true);
  assert.equal(mail.length,2);
  assert.equal(mail[1].purpose,'welcome');
  const repeated=await handleRequest(req('/v1/nexus/trial/confirm',{email,installationId,code:mail[0].code}),env);
  assert.equal(repeated.status,409);
  const retry=await handleRequest(req('/v1/nexus/trial/request',{email,installationId}),env);
  assert.equal(retry.status,202);
  assert.equal(mail.length,2);
  const invalidInstall=await handleRequest(req('/v1/nexus/entitlement/refresh',{entitlement:{...output.entitlement,payload:{...output.entitlement.payload,installationId:'unit-other12345'}}}),env);
  assert.equal(invalidInstall.status,403);
});
test('Nexus never provisions commercial access without signer',async()=>{
  const {handleRequest}=await import('../cloudflare/account/src/worker.mjs');
  const env={NEXUS_TRIAL_PEPPER:'another-long-nexus-pepper-for-testing',NEXUS_TRIAL_STORE:new FakeTrialStore(),ACCOUNT_STORE:{findActiveLicense:async()=>null}};
  let otp='';
  env.NEXUS_MAIL_FETCH=async(_url,opts)=>{
    const p=JSON.parse(opts.body);otp=p.code;
    const auth=await handleRequest(req('/v1/nexus/trial/relay-authorize',p),env);
    assert.equal((await auth.json()).authorized,true);
    return Response.json({accepted:true});
  };
  const email='zero@example.com',installationId='unit-test99999';
  assert.equal((await handleRequest(req('/v1/nexus/trial/request',{email,installationId}),env)).status,202);
  assert.equal((await handleRequest(req('/v1/nexus/trial/confirm',{email,installationId,code:otp}),env)).status,503);
  assert.equal(env.NEXUS_TRIAL_STORE.licenses.length,0);
});
