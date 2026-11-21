// PDV Nexus commercial trial. The MIT/self-hosted core never calls this service.
const PRODUCT='PDV_NEXUS_2',TRIAL_MS=72*60*60*1000,OTP_MS=15*60*1000,RESEND_MS=60*1000;
const RELAY='https://oficina-mail.artisys.dev/nexus';
const js=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});
const emailOf=x=>{const s=String(x||'').trim().toLowerCase();return s.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:null};
const installOf=x=>{const s=String(x||'').trim();return /^[a-zA-Z0-9._:-]{8,128}$/.test(s)?s:null};
function encoded(buffer){return btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}
function decoded(str){const s=str.replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(s+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0))}
const timestamp=()=>new Date().toISOString();
const later=ms=>new Date(Date.now()+ms).toISOString();
const uuid=prefix=>prefix+'-'+crypto.randomUUID();
async function sha(text){return encoded(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))}
async function hmac(secret,payload){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return encoded(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(payload))))}
async function codeDigest(secret,email,code){return hmac(secret+':otp',[email,code])}
function ticketData(p){return [p.purpose,p.email,p.installationId,p.code||'',p.licenseId||'',p.expiresAt||'',p.issuedAt]}
function signingKey(env){const raw=env.NEXUS_LICENSE_SIGNING_JWK;if(!raw)throw Error('NEXUS_LICENSE_SIGNING_JWK ausente');return typeof raw==='string'?JSON.parse(raw):raw}
export async function signNexusEntitlement(env,payload){
  const key=await crypto.subtle.importKey('jwk',signingKey(env),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const canonical=JSON.stringify(payload);
  const bytes=new TextEncoder().encode(canonical);
  return {payload,signature:encoded(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,bytes))};
}
export async function verifyNexusEntitlement(env,entitlement){
  if(!entitlement||entitlement.payload?.product!==PRODUCT||typeof entitlement.signature!=='string')return false;
  const privateJwk=signingKey(env);
  const publicJwk={kty:'EC',crv:'P-256',x:privateJwk.x,y:privateJwk.y,ext:true};
  const key=await crypto.subtle.importKey('jwk',publicJwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
  try{return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,decoded(entitlement.signature),new TextEncoder().encode(JSON.stringify(entitlement.payload)))}catch{return false}
}
export class D1NexusTrialStore {
  constructor(db){if(!db)throw Error('D1 ausente');this.db=db}
  async ensure(){
    await this.db.prepare("CREATE TABLE IF NOT EXISTS nexus_trial_requests (email TEXT PRIMARY KEY,installation_id TEXT NOT NULL UNIQUE,code_digest TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,last_sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,day_count INTEGER NOT NULL DEFAULT 1,consumed_at TEXT,license_id TEXT,welcome_status TEXT)").run();
    await this.db.prepare("CREATE TABLE IF NOT EXISTS nexus_trial_mail_tickets (ticket_digest TEXT PRIMARY KEY,created_at TEXT NOT NULL)").run();
    await this.db.prepare("CREATE TABLE IF NOT EXISTS nexus_trial_rate_limits (subject TEXT NOT NULL,bucket TEXT NOT NULL,hits INTEGER NOT NULL,PRIMARY KEY(subject,bucket))").run();
  }
  async takeRateLimit(subject,bucket){
    const result=await this.db.prepare("INSERT INTO nexus_trial_rate_limits(subject,bucket,hits) VALUES(?,?,1) ON CONFLICT(subject,bucket) DO UPDATE SET hits=hits+1 WHERE hits<12").bind(subject,bucket).run();
    return Number(result.meta?.changes||0)===1;
  }
  async get(email,installationId){
    return this.db.prepare('SELECT * FROM nexus_trial_requests WHERE email=? OR installation_id=? LIMIT 1').bind(email,installationId).first();
  }
  async saveChallenge({email,installationId,digest,now,expiresAt}){
    const row=await this.get(email,installationId);
    if(row){
      if(row.email!==email||row.installation_id!==installationId||row.consumed_at)return false;
      if(row.last_sent_at&&Date.parse(now)-Date.parse(row.last_sent_at)<RESEND_MS)return false;
      const sameDay=row.created_at.slice(0,10)===now.slice(0,10);
      if(sameDay&&row.day_count>=6)return false;
      const r=await this.db.prepare('UPDATE nexus_trial_requests SET code_digest=?,created_at=?,expires_at=?,last_sent_at=NULL,attempts=0,day_count=? WHERE email=? AND installation_id=? AND consumed_at IS NULL').bind(digest,now,expiresAt,sameDay?row.day_count+1:1,email,installationId).run();
      return Number(r.meta?.changes||0)===1;
    }
    try{
      await this.db.prepare('INSERT INTO nexus_trial_requests(email,installation_id,code_digest,created_at,expires_at,day_count) VALUES(?,?,?,?,?,1)').bind(email,installationId,digest,now,expiresAt).run();
      return true;
    }catch{return false}
  }
  async claimMail(p){
    const now=timestamp();
    const digest=await sha(JSON.stringify(ticketData(p)));
    const row=await this.get(p.email,p.installationId);
    if(!row||row.email!==p.email||row.installation_id!==p.installationId)return false;
    if(p.purpose==='verify'){
      if(row.consumed_at||row.expires_at<=now||row.code_digest!==await codeDigest(p.pepper,p.email,p.code))return false;
    }else if(p.purpose==='welcome'){
      if(!row.consumed_at||row.license_id!==p.licenseId||row.welcome_status==='sent')return false;
    }else return false;
    try{
      await this.db.prepare('INSERT INTO nexus_trial_mail_tickets(ticket_digest,created_at) VALUES(?,?)').bind(digest,now).run();
      return true;
    }catch{return false}
  }
  async delivery(email,installationId,purpose,status){
    if(purpose==='verify')await this.db.prepare('UPDATE nexus_trial_requests SET last_sent_at=? WHERE email=? AND installation_id=?').bind(timestamp(),email,installationId).run();
    else await this.db.prepare('UPDATE nexus_trial_requests SET welcome_status=? WHERE email=? AND installation_id=?').bind(status,email,installationId).run();
  }
  async wrong(email,installationId){
    await this.db.prepare('UPDATE nexus_trial_requests SET attempts=attempts+1 WHERE email=? AND installation_id=? AND consumed_at IS NULL').bind(email,installationId).run();
  }
  async activate({email,installationId,digest,now,expiresAt,licenseId}){
    const row=await this.get(email,installationId);
    if(!row||row.email!==email||row.installation_id!==installationId||row.consumed_at)return null;
    if(row.expires_at<=now||row.attempts>=5)return null;
    if(row.code_digest!==digest){await this.wrong(email,installationId);return null}
    const accountId=uuid('account');
    // D1 batch is atomic; only the first concurrent consumer changes the challenge.
    await this.db.batch([
      this.db.prepare('INSERT INTO accounts(id,email_normalized,created_at) VALUES(?,?,?) ON CONFLICT(email_normalized) DO NOTHING').bind(accountId,email,now),
      this.db.prepare('UPDATE nexus_trial_requests SET consumed_at=?,license_id=? WHERE email=? AND installation_id=? AND consumed_at IS NULL AND code_digest=? AND expires_at>? AND attempts<5').bind(now,licenseId,email,installationId,digest,now),
      this.db.prepare("INSERT INTO licenses(id,account_id,product,status,created_at,expires_at,max_devices,metadata_json) SELECT ?,a.id,?,'ACTIVE',?,?,1,? FROM accounts a JOIN nexus_trial_requests t ON t.email=a.email_normalized WHERE a.email_normalized=? AND t.license_id=? AND t.consumed_at=? AND NOT EXISTS(SELECT 1 FROM licenses l WHERE l.account_id=a.id AND l.product=?)").bind(licenseId,PRODUCT,now,expiresAt,JSON.stringify({kind:'TRIAL',source:'AUTO_SIGNUP'}),email,licenseId,now,PRODUCT),
      this.db.prepare("INSERT INTO installations(installation_id,account_id,license_id,activated_at,last_seen_at) SELECT ?,l.account_id,l.id,?,? FROM licenses l WHERE l.id=?").bind(installationId,now,now,licenseId)
    ]);
    const result=await this.db.prepare('SELECT l.id,l.expires_at AS expiresAt FROM licenses l JOIN nexus_trial_requests t ON t.license_id=l.id WHERE t.email=? AND t.installation_id=? AND l.id=?').bind(email,installationId,licenseId).first();
    return result||null;
  }
  async status(installationId){
    return this.db.prepare("SELECT a.email_normalized AS email,l.id AS licenseId,l.product,l.status,l.expires_at AS expiresAt,l.created_at AS createdAt,l.metadata_json,i.installation_id AS installationId FROM installations i JOIN licenses l ON l.id=i.license_id JOIN accounts a ON a.id=l.account_id WHERE i.installation_id=? AND l.product=? LIMIT 1").bind(installationId,PRODUCT).first();
  }
}
function trialStore(env){return env.NEXUS_TRIAL_STORE||new D1NexusTrialStore(env.DB||env.artisys)}
async function sendMail(env,pepper,p){
  const issuedAt=timestamp();
  const payload={...p,issuedAt};
  payload.signature=await hmac(pepper+':mail',ticketData(payload));
  try{
    const rsp=await (env.NEXUS_MAIL_FETCH||fetch)(RELAY,{method:'POST',redirect:'manual',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(8500)});
    return rsp.ok&&(await rsp.json())?.accepted===true?'sent':'failed';
  }catch{return 'failed'}
}
async function bodyOf(req){const raw=await req.text();if(raw.length>4096)throw Error('Corpo grande');return JSON.parse(raw)}
const responsePayload=record=>({licenseId:record.licenseId,email:record.email,installationId:record.installationId,product:PRODUCT,kind:(()=>{try{return JSON.parse(record.metadata_json||'{}').kind||'COMMERCIAL'}catch{return 'COMMERCIAL'}})(),issuedAt:timestamp(),expiresAt:record.expiresAt});
export async function handleNexusTrial(req,env,url,readyStore){
  if(!url.pathname.startsWith('/v1/nexus/'))return null;
  try{
    const isGet=req.method==='GET';
    const body=isGet?{}:await bodyOf(req);
    const pepper=String(env.NEXUS_TRIAL_PEPPER||'');
    if(pepper.length<20)return js({error:'Licenciamento Nexus nao configurado'},503);
    const store=trialStore(env);
    await readyStore(env);
    await store.ensure();
    const route=url.pathname;
    const email=emailOf(body.email),installationId=installOf(body.installationId);
    if(route==='/v1/nexus/trial/request'&&req.method==='POST'){
      if(!email||!installationId)return js({error:'E-mail ou instalacao invalidos'},400);
      const existing=await readyStore(env);
      if(await existing.findActiveLicense(email,PRODUCT))return js({accepted:true},202);
      const ip=req.headers.get('cf-connecting-ip');
      if(ip&&typeof store.takeRateLimit==='function'){
        const subject=await sha(pepper+':ip:'+ip);
        const bucket=new Date().toISOString().slice(0,13);
        if(!await store.takeRateLimit(subject,bucket))return js({accepted:true},202);
      }
      const now=timestamp(),code=String(crypto.getRandomValues(new Uint32Array(1))[0]%1000000).padStart(6,'0');
      const saved=await store.saveChallenge({email,installationId,digest:await codeDigest(pepper,email,code),now,expiresAt:later(OTP_MS)});
      if(!saved)return js({accepted:true},202);
      const delivery=await sendMail(env,pepper,{purpose:'verify',email,installationId,code,expiresAt:later(OTP_MS)});
      await store.delivery(email,installationId,'verify',delivery);
      return delivery==='sent'?js({accepted:true},202):js({error:'Envio temporariamente indisponivel. Tente novamente.'},503);
    }
    if(route==='/v1/nexus/trial/relay-authorize'&&req.method==='POST'){
      const age=Math.abs(Date.now()-Date.parse(body.issuedAt||''));
      if(!email||!installationId||!['verify','welcome'].includes(body.purpose)||!Number.isFinite(age)||age>65000)return js({authorized:false},403);
      const expected=await hmac(pepper+':mail',ticketData(body));
      if(typeof body.signature!=='string'||body.signature!==expected)return js({authorized:false},403);
      body.pepper=pepper;
      return js({authorized:await store.claimMail(body)},200);
    }
    if(route==='/v1/nexus/trial/confirm'&&req.method==='POST'){
      if(!email||!installationId||!/^\d{6}$/.test(String(body.code||'')))return js({error:'Dados invalidos'},400);
      signingKey(env); // fail closed before provisioning if commercial signing is unavailable
      const already=await store.status(installationId);
      if(already)return js({error:'Avaliacao ja utilizada'},409);
      const now=timestamp(),expiresAt=new Date(Date.parse(now)+TRIAL_MS).toISOString(),licenseId=uuid('license');
      // Sign before DB mutation to avoid issuing an unusable trial on invalid key configuration.
      const entitlement=await signNexusEntitlement(env,{licenseId,email,installationId,product:PRODUCT,kind:'TRIAL',issuedAt:now,expiresAt});
      const record=await store.activate({email,installationId,digest:await codeDigest(pepper,email,body.code),now,expiresAt,licenseId});
      if(!record)return js({error:'Codigo invalido, expirado ou avaliacao ja utilizada'},409);
      const delivery=await sendMail(env,pepper,{purpose:'welcome',email,installationId,licenseId,expiresAt});
      await store.delivery(email,installationId,'welcome',delivery);
      return js({entitlement,delivery:{status:delivery},expiresAt},201);
    }
    if(route==='/v1/nexus/entitlement/refresh'&&req.method==='POST'){
      if(!await verifyNexusEntitlement(env,body.entitlement))return js({error:'Licenca invalida'},403);
      const p=body.entitlement.payload,record=await store.status(p.installationId);
      if(!record||record.licenseId!==p.licenseId||record.email!==p.email||record.status!=='ACTIVE'||(record.expiresAt&&record.expiresAt<=timestamp()))return js({active:false},200);
      return js({active:true,entitlement:await signNexusEntitlement(env,responsePayload(record))},200);
    }
    return js({error:'Rota desconhecida'},404);
  }catch(e){return js({error:e.message==='NEXUS_LICENSE_SIGNING_JWK ausente'?'Assinatura comercial indisponivel':'Falha ao processar licenciamento Nexus'},e.message==='NEXUS_LICENSE_SIGNING_JWK ausente'?503:500)}
}
