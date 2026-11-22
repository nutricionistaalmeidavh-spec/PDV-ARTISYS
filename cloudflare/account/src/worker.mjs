import {handleNexusTrial,signNexusEntitlement,logNexusLicenseEvent,nexusLicenseDashboard,nexusLicenseHistory,resendNexusWelcome} from './nexus-trial.mjs';
const ACTIVATION_TOKEN_TTL_MS=48*60*60*1000;
const RECOVERY_TTL_MS=15*60*1000;
const OFICINA_RECOVERY_TTL_MS=48*60*60*1000;
const RECOVERY_RESEND_MS=60*1000;
const ACTIVATION_MAX_ATTEMPTS=5;
const RECOVERY_MAX_ATTEMPTS=5;
const ADMIN_SESSION_TTL_MS=8*60*60*1000;
const ADMIN_SESSION_COOKIE='__Host-artisys_admin_session';

function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function normalizeEmail(value){const email=String(value||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;}
function normalizeProduct(value){const product=String(value||'PDV').trim().toUpperCase();return ['PDV','OFICINA','WPPPROSPECTOR','LOJA_ROUPAS','PDV_NEXUS_2','ALMOXARIFADO'].includes(product)?product:null;}
function normalizeInstallationId(value){const id=String(value||'').trim();return /^[A-Za-z0-9._:-]{8,128}$/.test(id)?id:null;}
function newId(prefix){return `${prefix}-${crypto.randomUUID()}`;}
function randomCode(){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return String(bytes[0]%1000000).padStart(6,'0');}
async function digestToken({pepper,email,code}){const data=new TextEncoder().encode(`${pepper}:${email}:${code}`);const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
const MAIL_RELAY_URL='https://oficina-mail.artisys.dev/send';
const WELCOME_RELAY_URL='https://oficina-mail.artisys.dev/welcome';
const WELCOME_ALMOX_RELAY_URL='https://oficina-mail.artisys.dev/welcome-almoxarifado';
async function signMailRelay(pepper,{email,installationId,code,issuedAt}){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode('oficina-mail-relay-v1:'+pepper),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,enc.encode(JSON.stringify([email,installationId,code,issuedAt])));
  return Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join('');
}
async function signWelcome(pepper,{email,licenseId,code,codeExpiresAt,issuedAt,product='LOJA_ROUPAS'}){
  const enc=new TextEncoder();
  // Preserva o ticket assinado das mensagens Loja Roupas que já foram emitidas.
  const almox=product==='ALMOXARIFADO';
  const key=await crypto.subtle.importKey('raw',enc.encode((almox?'almoxarifado-welcome-v1:':'loja-roupas-welcome-v1:')+pepper),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signedFields=almox?[email,licenseId,code,codeExpiresAt,issuedAt,product]:
    [email,licenseId,code,codeExpiresAt,issuedAt];
  const sig=await crypto.subtle.sign('HMAC',key,enc.encode(JSON.stringify(signedFields)));
  return Array.from(new Uint8Array(sig),x=>x.toString(16).padStart(2,'0')).join('');
}
async function readBody(request){const text=await request.text();if(text.length>32768)throw Object.assign(new Error('Corpo da requisicao excede o limite permitido.'),{statusCode:413});if(!text)return{};try{return JSON.parse(text);}catch{throw Object.assign(new Error('JSON invalido.'),{statusCode:400});}}
async function runDdl(db,sqlText){for(const sql of String(sqlText||'').split(';').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();}
function randomSessionToken(){const bytes=new Uint8Array(32);crypto.getRandomValues(bytes);return Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');}
async function sha256Hex(value){const data=new TextEncoder().encode(String(value));const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function secureEqual(a,b){const [left,right]=await Promise.all([sha256Hex(String(a||'')),sha256Hex(String(b||''))]);let diff=0;for(let i=0;i<left.length;i++)diff|=left.charCodeAt(i)^right.charCodeAt(i);return diff===0&&String(a||'').length===String(b||'').length;}
async function adminSessionDigest(env,token){const secret=String(env.ADMIN_TOKEN||'').trim();if(!secret)return null;return sha256Hex(`${secret}:admin-session:${String(token||'')}`);}
function cookieValue(request,name){const raw=String(request.headers.get('cookie')||'');for(const part of raw.split(';')){const index=part.indexOf('=');if(index<0)continue;const key=part.slice(0,index).trim();if(key===name)return part.slice(index+1).trim();}return '';}
function sessionCookie(token,maxAgeSeconds){const value=token||'';return `${ADMIN_SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAgeSeconds}`;}


class D1AccountStore{
  constructor(db){if(!db)throw new Error('D1 DB binding ausente.');this.db=db;this.schemaReady=false;}
  async ensureSchema(){
    if(this.schemaReady)return;
    await runDdl(this.db,`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      email_normalized TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      product TEXT NOT NULL DEFAULT 'PDV',
      status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUSPENDED','CANCELLED','EXPIRED')),
      created_at TEXT NOT NULL,
      expires_at TEXT,
      max_devices INTEGER,
      metadata_json TEXT,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
    CREATE TABLE IF NOT EXISTS activation_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      license_id TEXT NOT NULL,
      installation_id TEXT NOT NULL,
      token_digest TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id),
      FOREIGN KEY(license_id) REFERENCES licenses(id)
    );
    CREATE TABLE IF NOT EXISTS installations (
      installation_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      license_id TEXT NOT NULL,
      activated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id),
      FOREIGN KEY(license_id) REFERENCES licenses(id)
    );
    CREATE TABLE IF NOT EXISTS password_recovery_tokens (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      email_normalized TEXT NOT NULL,
      installation_id TEXT,
      token_digest TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(account_id) REFERENCES accounts(id)
    );
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_digest TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT
    );`);
    const licenseColumns=new Set(((await this.db.prepare('PRAGMA table_info(licenses)').all()).results||[]).map(row=>row.name));
    if(!licenseColumns.has('product'))await this.db.prepare("ALTER TABLE licenses ADD COLUMN product TEXT NOT NULL DEFAULT 'PDV'").run();
    if(!licenseColumns.has('max_devices'))await this.db.prepare('ALTER TABLE licenses ADD COLUMN max_devices INTEGER').run();
    const activationColumns=new Set(((await this.db.prepare('PRAGMA table_info(activation_tokens)').all()).results||[]).map(row=>row.name));
    if(!activationColumns.has('attempts'))await this.db.prepare('ALTER TABLE activation_tokens ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0').run();
    if(!activationColumns.has('welcomed_at'))await this.db.prepare('ALTER TABLE activation_tokens ADD COLUMN welcomed_at TEXT').run();
    const recoveryColumns=new Set(((await this.db.prepare('PRAGMA table_info(password_recovery_tokens)').all()).results||[]).map(row=>row.name));
    if(!recoveryColumns.has('installation_id'))await this.db.prepare('ALTER TABLE password_recovery_tokens ADD COLUMN installation_id TEXT').run();
    if(!recoveryColumns.has('relayed_at'))await this.db.prepare('ALTER TABLE password_recovery_tokens ADD COLUMN relayed_at TEXT').run();
    await runDdl(this.db,`CREATE INDEX IF NOT EXISTS idx_licenses_account_status ON licenses(account_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_activation_tokens_lookup ON activation_tokens(account_id,token_digest,expires_at,used_at);
    CREATE INDEX IF NOT EXISTS idx_activation_tokens_installation ON activation_tokens(installation_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_activation_tokens_attempts ON activation_tokens(account_id,expires_at,used_at,attempts);
    CREATE INDEX IF NOT EXISTS idx_installations_license ON installations(license_id);
    CREATE INDEX IF NOT EXISTS idx_password_recovery_email_created ON password_recovery_tokens(email_normalized,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_password_recovery_expiry ON password_recovery_tokens(expires_at,used_at);
    CREATE INDEX IF NOT EXISTS idx_password_recovery_installation ON password_recovery_tokens(installation_id,email_normalized,expires_at,used_at);
    CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at,revoked_at);`);
    this.schemaReady=true;
  }
  async findAccount(email){
    const row=await this.db.prepare('SELECT id,email_normalized AS email FROM accounts WHERE email_normalized=? LIMIT 1').bind(email).first();
    return row?{id:row.id,email:row.email}:null;
  }
  async findActiveLicense(email,product='PDV'){
    const row=await this.db.prepare(`SELECT l.id,a.id AS account_id,a.email_normalized AS email,l.product,l.status,l.expires_at,l.max_devices
      FROM licenses l JOIN accounts a ON a.id=l.account_id
      WHERE a.email_normalized=? AND l.product=? AND l.status='ACTIVE' AND (l.expires_at IS NULL OR l.expires_at>?)
      ORDER BY l.created_at DESC LIMIT 1`).bind(email,product,new Date().toISOString()).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,product:row.product||'PDV',status:row.status,expiresAt:row.expires_at||null,maxDevices:row.max_devices??null}:null;
  }
  async saveActivationToken(token){await this.db.prepare(`INSERT INTO activation_tokens(id,account_id,license_id,installation_id,token_digest,attempts,expires_at,used_at,created_at)
    VALUES(?,?,?,?,?,0,?,NULL,?)`).bind(token.id,token.accountId,token.licenseId,token.installationId,token.tokenDigest,token.expiresAt,token.createdAt).run();}
  async authorizeWelcomeRelay({tokenId,at}){
    const r=await this.db.prepare('UPDATE activation_tokens SET welcomed_at=? WHERE id=? AND welcomed_at IS NULL AND used_at IS NULL AND expires_at>?')
      .bind(at,tokenId,at).run();
    return Number(r.meta?.changes||0)===1;
  }
  async findActivationToken({email,digest,now,product='PDV'}){
    const row=await this.db.prepare(`SELECT t.id,t.account_id,t.license_id,t.installation_id,t.token_digest,t.attempts,t.expires_at,t.used_at,a.email_normalized AS email
      FROM activation_tokens t JOIN accounts a ON a.id=t.account_id JOIN licenses l ON l.id=t.license_id
      WHERE a.email_normalized=? AND l.product=? AND t.token_digest=? AND t.used_at IS NULL AND t.expires_at>? AND t.attempts<?
      ORDER BY t.created_at DESC LIMIT 1`).bind(email,product,digest,now,ACTIVATION_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,licenseId:row.license_id,installationId:row.installation_id,email:row.email,tokenDigest:row.token_digest,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at}:null;
  }
  async findActivationCandidate({email,now,product='PDV'}){
    const row=await this.db.prepare(`SELECT t.id,t.account_id,t.license_id,t.installation_id,t.token_digest,t.attempts,t.expires_at,t.used_at,a.email_normalized AS email
      FROM activation_tokens t JOIN accounts a ON a.id=t.account_id JOIN licenses l ON l.id=t.license_id
      WHERE a.email_normalized=? AND l.product=? AND t.used_at IS NULL AND t.expires_at>? AND t.attempts<?
      ORDER BY t.created_at DESC LIMIT 1`).bind(email,product,now,ACTIVATION_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,licenseId:row.license_id,installationId:row.installation_id,email:row.email,tokenDigest:row.token_digest,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at}:null;
  }
  async incrementActivationAttempts(id){await this.db.prepare('UPDATE activation_tokens SET attempts=attempts+1 WHERE id=? AND used_at IS NULL').bind(id).run();}
  async provisionLicense({email,product='PDV',expiresAt=null,maxDevices=null,codeDigest,codeExpiresAt,createdAt}){
    let account=await this.findAccount(email);
    if(!account){account={id:newId('account'),email};await this.db.prepare('INSERT INTO accounts(id,email_normalized,created_at) VALUES(?,?,?)').bind(account.id,email,createdAt).run();}
    await this.db.prepare("UPDATE licenses SET status='CANCELLED' WHERE account_id=? AND product=? AND status='ACTIVE'").bind(account.id,product).run();
    const licenseId=newId('license');
    await this.db.prepare(`INSERT INTO licenses(id,account_id,product,status,created_at,expires_at,max_devices,metadata_json) VALUES(?,?,?,'ACTIVE',?,?,?,?)`).bind(licenseId,account.id,product,createdAt,expiresAt,maxDevices,JSON.stringify({source:'admin-panel'})).run();
    await this.saveActivationToken({id:newId('token'),accountId:account.id,licenseId,installationId:'PENDING',tokenDigest:codeDigest,expiresAt:codeExpiresAt,createdAt});
    return {accountId:account.id,licenseId};
  }

  async findLicenseById(id){
    const row=await this.db.prepare(`SELECT l.id,l.account_id,a.email_normalized AS email,l.product,l.status,l.expires_at,l.max_devices
      FROM licenses l JOIN accounts a ON a.id=l.account_id WHERE l.id=? LIMIT 1`).bind(id).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,product:row.product||'PDV',status:row.status,expiresAt:row.expires_at||null,maxDevices:row.max_devices??null}:null;
  }
  async rotateActivationTokenForLicense({licenseId,codeDigest,codeExpiresAt,createdAt}){
    const license=await this.findLicenseById(licenseId);
    if(!license||license.status!=='ACTIVE'||(license.expiresAt&&license.expiresAt<=createdAt))return null;
    await this.db.batch([
      this.db.prepare('UPDATE activation_tokens SET used_at=? WHERE license_id=? AND used_at IS NULL').bind(createdAt,licenseId),
      this.db.prepare(`INSERT INTO activation_tokens(id,account_id,license_id,installation_id,token_digest,attempts,expires_at,used_at,created_at)
        VALUES(?,?,?,?,?,0,?,NULL,?)`).bind(newId('token'),license.accountId,licenseId,'PENDING',codeDigest,codeExpiresAt,createdAt)
    ]);
    return {accountId:license.accountId,licenseId,email:license.email,product:license.product};
  }
  async listLicenses(){const rows=(await this.db.prepare(`SELECT l.id,a.email_normalized AS email,l.product,l.status,l.created_at,l.expires_at,l.max_devices,l.metadata_json,
    (SELECT COUNT(*) FROM installations i WHERE i.license_id=l.id) AS device_count,
    (SELECT GROUP_CONCAT(installation_id,'|') FROM installations i WHERE i.license_id=l.id) AS device_ids,
    (SELECT installation_id FROM installations i WHERE i.license_id=l.id ORDER BY activated_at ASC LIMIT 1) AS installation_id
    FROM licenses l JOIN accounts a ON a.id=l.account_id ORDER BY l.created_at DESC LIMIT 200`).all()).results||[];
    let mailStatus=new Map();
    try{const receipts=(await this.db.prepare('SELECT license_id,welcome_status FROM nexus_trial_requests WHERE license_id IS NOT NULL').all()).results||[];
      mailStatus=new Map(receipts.map(x=>[x.license_id,x.welcome_status||'pending']));
    }catch{ /* older D1 before any Nexus registrations */ }
    return rows.map(row=>({...row,welcome_status:mailStatus.get(row.id)||null,kind:(()=>{try{return JSON.parse(row.metadata_json||'{}').kind||'COMMERCIAL'}catch{return 'COMMERCIAL'}})(),source:(()=>{try{const source=JSON.parse(row.metadata_json||'{}').source||'MANUAL';return source==='admin-panel'?'MANUAL':source}catch{return 'MANUAL'}})(),device_ids:row.device_ids?row.device_ids.split('|'):[]}));}
  async setLicenseStatus(id,status){await this.db.prepare('UPDATE licenses SET status=? WHERE id=?').bind(status,id).run();}
  async convertNexusTrial(id,expiresAt){
    const row=await this.db.prepare('SELECT product,metadata_json FROM licenses WHERE id=?').bind(id).first();
    let metadata={};try{metadata=JSON.parse(row?.metadata_json||'{}')}catch{}
    if(row?.product!=='PDV_NEXUS_2'||metadata.kind!=='TRIAL')return false;
    const r=await this.db.prepare("UPDATE licenses SET status='ACTIVE',expires_at=?,metadata_json=? WHERE id=? AND product='PDV_NEXUS_2'").bind(expiresAt,JSON.stringify({...metadata,kind:'COMMERCIAL',source:'ADMIN_CONVERSION'}),id).run();
    return Number(r.meta?.changes||0)===1;
  }
  async createAdminSession({tokenDigest,createdAt,expiresAt}){await this.db.prepare('INSERT INTO admin_sessions(token_digest,created_at,expires_at,revoked_at) VALUES(?,?,?,NULL)').bind(tokenDigest,createdAt,expiresAt).run();}
  async findAdminSession({digest,now}){const row=await this.db.prepare('SELECT token_digest,expires_at FROM admin_sessions WHERE token_digest=? AND revoked_at IS NULL AND expires_at>? LIMIT 1').bind(digest,now).first();return row?{tokenDigest:row.token_digest,expiresAt:row.expires_at}:null;}
  async deleteAdminSession(digest){await this.db.prepare('DELETE FROM admin_sessions WHERE token_digest=?').bind(digest).run();}
  async createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt}){
    const row=await this.db.prepare(`SELECT i.account_id,a.email_normalized AS email,l.status,l.expires_at FROM installations i JOIN accounts a ON a.id=i.account_id JOIN licenses l ON l.id=i.license_id WHERE i.installation_id=? LIMIT 1`).bind(installationId).first();
    if(!row||row.email!==email||row.status!=='ACTIVE'||(row.expires_at&&row.expires_at<=createdAt))return null;
    // Reissue invalidates any older active OTP for the same email and installation.
    await this.db.prepare('UPDATE password_recovery_tokens SET used_at=? WHERE email_normalized=? AND installation_id=? AND used_at IS NULL').bind(createdAt,email,installationId).run();
    const tokenId=newId('recovery');
    await this.saveRecoveryToken({id:tokenId,accountId:row.account_id,email,installationId,tokenDigest:codeDigest,attempts:0,createdAt,expiresAt});
    return {accountId:row.account_id,tokenId};
  }
  async consumeActivationToken(id,usedAt){await this.db.prepare('UPDATE activation_tokens SET used_at=? WHERE id=? AND used_at IS NULL').bind(usedAt,id).run();}
  async saveRecoveryToken(token){
    await this.db.prepare(`INSERT INTO password_recovery_tokens(id,account_id,email_normalized,installation_id,token_digest,attempts,expires_at,used_at,created_at)
      VALUES(?,?,?,?,?,0,?,NULL,?)`).bind(token.id,token.accountId,token.email,token.installationId||null,token.tokenDigest,token.expiresAt,token.createdAt).run();
  }
  async findRecoveryToken({email,installationId,digest,now}){
    const row=await this.db.prepare(`SELECT id,account_id,email_normalized AS email,installation_id,token_digest,attempts,expires_at,used_at,created_at
      FROM password_recovery_tokens WHERE email_normalized=? AND installation_id=? AND token_digest=? AND used_at IS NULL AND expires_at>? AND attempts<?
      ORDER BY created_at DESC LIMIT 1`).bind(email,installationId,digest,now,RECOVERY_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,installationId:row.installation_id,tokenDigest:row.token_digest,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at,createdAt:row.created_at}:null;
  }
  async findRecoveryCandidate({email,installationId,now}){
    const row=await this.db.prepare(`SELECT id,account_id,email_normalized AS email,installation_id,token_digest,attempts,expires_at,used_at,created_at
      FROM password_recovery_tokens WHERE email_normalized=? AND installation_id=? AND used_at IS NULL AND expires_at>? AND attempts<?
      ORDER BY created_at DESC LIMIT 1`).bind(email,installationId,now,RECOVERY_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,installationId:row.installation_id,tokenDigest:row.token_digest,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at,createdAt:row.created_at}:null;
  }
  async findLatestRecoveryToken({email,now}){
    const row=await this.db.prepare(`SELECT id,account_id,email_normalized AS email,attempts,expires_at,used_at,created_at
      FROM password_recovery_tokens WHERE email_normalized=? AND used_at IS NULL AND expires_at>? AND attempts<?
      ORDER BY created_at DESC LIMIT 1`).bind(email,now,RECOVERY_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at,createdAt:row.created_at}:null;
  }
  async consumeRecoveryToken(id,usedAt){
    const answer=await this.db.prepare('UPDATE password_recovery_tokens SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>? AND attempts<?').bind(usedAt,id,usedAt,RECOVERY_MAX_ATTEMPTS).run();
    return Number(answer.meta?.changes||0)===1;
  }
  async authorizeRecoveryRelay({tokenId,at}){
    const answer=await this.db.prepare('UPDATE password_recovery_tokens SET relayed_at=? WHERE id=? AND relayed_at IS NULL AND used_at IS NULL AND expires_at>? AND attempts<?')
      .bind(at,tokenId,at,RECOVERY_MAX_ATTEMPTS).run();
    return Number(answer.meta?.changes||0)===1;
  }
  async incrementRecoveryAttempts(id){await this.db.prepare('UPDATE password_recovery_tokens SET attempts=attempts+1 WHERE id=? AND used_at IS NULL').bind(id).run();}
  async saveInstallation(record){await this.db.prepare(`INSERT INTO installations(installation_id,account_id,license_id,activated_at,last_seen_at)
    VALUES(?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET account_id=excluded.account_id,license_id=excluded.license_id,last_seen_at=excluded.last_seen_at`).bind(record.installationId,record.accountId,record.licenseId,record.activatedAt,record.activatedAt).run();}
  async registerCRMInstallation(record,maxDevices){
    // Uma única instrução atômica garante o teto mesmo com ativações concorrentes.
    // Não altera a política de dispositivos dos produtos legados.
    const result=await this.db.prepare(`INSERT INTO installations(installation_id,account_id,license_id,activated_at,last_seen_at)
      SELECT ?,?,?,?,? WHERE (
        (SELECT COUNT(*) FROM installations WHERE license_id=? AND installation_id<>?) < ?
        OR EXISTS (SELECT 1 FROM installations WHERE installation_id=? AND license_id=?)
      )
      ON CONFLICT(installation_id) DO UPDATE SET last_seen_at=excluded.last_seen_at
      WHERE installations.license_id=excluded.license_id`)
      .bind(record.installationId,record.accountId,record.licenseId,record.activatedAt,record.activatedAt,
        record.licenseId,record.installationId,maxDevices,record.installationId,record.licenseId).run();
    return Number(result.meta?.changes||0)>0;
  }
  async setCRMDeviceLimit(id,maxDevices){
    const result=await this.db.prepare("UPDATE licenses SET max_devices=? WHERE id=? AND product='WPPPROSPECTOR' AND (SELECT COUNT(*) FROM installations WHERE license_id=?)<=?")
      .bind(maxDevices,id,id,maxDevices).run();
    return Number(result.meta?.changes||0)>0;
  }
  async removeInstallation(licenseId,installationId){
    const result=await this.db.prepare('DELETE FROM installations WHERE license_id=? AND installation_id=?')
      .bind(licenseId,installationId).run();
    return Number(result.meta?.changes||0)>0;
  }
  async findInstallation(id){
    const row=await this.db.prepare(`SELECT i.installation_id,i.license_id,i.activated_at,a.email_normalized AS account_email,l.product,l.status,l.expires_at
      FROM installations i JOIN accounts a ON a.id=i.account_id JOIN licenses l ON l.id=i.license_id WHERE i.installation_id=? LIMIT 1`).bind(id).first();
    return row?{installationId:row.installation_id,licenseId:row.license_id,activatedAt:row.activated_at,accountEmail:row.account_email,product:row.product||'PDV',status:row.status,expiresAt:row.expires_at||null}:null;
  }
  async logEmail(record){await this.db.prepare(`INSERT INTO email_delivery_log(id,account_id,email_normalized,template,status,error,created_at) VALUES(?,?,?,?,?,?,?)`).bind(record.id,record.accountId||null,record.email,record.template,record.status,record.error||null,record.createdAt).run();}
}

function resolveStore(env){return env.ACCOUNT_STORE||new D1AccountStore(env.DB||env.artisys);}
async function readyStore(env){const store=resolveStore(env);if(typeof store.ensureSchema==='function')await store.ensureSchema();return store;}
function activeInstallation(record,now){if(!record)return false;if(record.status&&record.status!=='ACTIVE')return false;if(record.expiresAt&&record.expiresAt<=now)return false;return true;}
function recoveryPepper(env){return String(env.RECOVERY_PEPPER||env.ACTIVATION_PEPPER||'').trim();}

async function deliverCommercialWelcome({email,licenseId,code,codeExpiresAt,issuedAt,product},env){
  const pepper=String(env.ACTIVATION_PEPPER||'').trim();
  if(!pepper)return {status:'failed',reason:'activation_pepper_missing'};
  if(product!=='ALMOXARIFADO'&&product!=='LOJA_ROUPAS')
    return {status:'failed',reason:'product_not_supported'};
  const payload={email,licenseId,code,codeExpiresAt,issuedAt,...(product==='ALMOXARIFADO'?{product}:{})};
  payload.signature=await signWelcome(pepper,{...payload,product});
  try{
    const sender=env.MAIL_RELAY_FETCH||fetch;
    const response=await sender(product==='ALMOXARIFADO'?WELCOME_ALMOX_RELAY_URL:WELCOME_RELAY_URL,{
      method:'POST',redirect:'manual',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),
      signal:AbortSignal.timeout(8500)
    });
    if(!response.ok)return {status:'failed',reason:'welcome_relay_unavailable'};
    const result=await response.json();
    if(result?.accepted!==true)return {status:'failed',reason:'welcome_relay_unconfirmed'};
    return {status:'sent'};
  }catch{
    return {status:'failed',reason:'welcome_relay_unavailable'};
  }
}
async function authorizeWelcomeRelay(request,env){
  const body=await readBody(request);
  const email=normalizeEmail(body.email),licenseId=String(body.licenseId||''),
    code=String(body.code||''),codeExpiresAt=String(body.codeExpiresAt||''),
    issuedAt=String(body.issuedAt||''),signature=String(body.signature||'');
  const product=body.product==null?'LOJA_ROUPAS':String(body.product||'');
  if(!['LOJA_ROUPAS','ALMOXARIFADO'].includes(product))return json({authorized:false},403);
  const age=Date.now()-Date.parse(issuedAt);
  if(!email||!/^[A-Za-z0-9_-]{3,128}$/.test(licenseId)||!/^[0-9]{6}$/.test(code)||
    !/^[a-f0-9]{64}$/i.test(signature)||!Number.isFinite(age)||Math.abs(age)>65000||
    !Number.isFinite(Date.parse(codeExpiresAt)))return json({authorized:false},403);
  const pepper=String(env.ACTIVATION_PEPPER||'').trim();
  if(!pepper)return json({authorized:false},503);
  const expected=await signWelcome(pepper,{email,licenseId,code,codeExpiresAt,issuedAt,product});
  if(!await secureEqual(expected,signature))return json({authorized:false},403);
  const store=await readyStore(env),at=new Date().toISOString();
  const digest=await digestToken({pepper,email,code});
  const [token,license]=await Promise.all([
    store.findActivationToken({email,digest,now:at,product}),
    store.findLicenseById(licenseId)
  ]);
  if(!token||token.licenseId!==licenseId||token.expiresAt!==codeExpiresAt||
     !license||license.product!==product||license.status!=='ACTIVE'||license.email!==email||
     (license.expiresAt&&license.expiresAt<=at))return json({authorized:false},403);
  if(!await store.authorizeWelcomeRelay({tokenId:token.id,at}))return json({authorized:false},403);
  return json({authorized:true,product});
}
async function requestActivation(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);
  if(!email||!installationId)return json({error:'Dados de ativacao invalidos.'},400);
  return json({accepted:true,message:'Use o codigo de ativacao fornecido pelo administrador ArtiSys.'},202);
}

async function verifyActivation(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);const product=normalizeProduct(body.product);const code=String(body.code||'').trim();
  if(!email||!installationId||!product||!/^\d{6}$/.test(code))return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'Servico de ativacao indisponivel.'},503);
  const store=await readyStore(env);const now=new Date().toISOString();const digest=await digestToken({pepper,email,code});
  const token=typeof store.findActivationCandidate==='function'
    ? await store.findActivationCandidate({email,now,product})
    : await store.findActivationToken({email,digest,now,product});
  if(!token)return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  if(token.tokenDigest&&token.tokenDigest!==digest){
    if(typeof store.incrementActivationAttempts==='function')await store.incrementActivationAttempts(token.id);
    return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  }
  if(token.installationId!=='PENDING'&&token.installationId!==installationId){
    if(typeof store.incrementActivationAttempts==='function')await store.incrementActivationAttempts(token.id);
    return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  }
  const license=await store.findActiveLicense(email,product);if(!license||license.id!==token.licenseId)return json({error:'Licenca indisponivel para ativacao.'},409);
  const entitlement=product==='PDV_NEXUS_2'?await signNexusEntitlement(env,{licenseId:license.id,email,installationId,product,kind:'COMMERCIAL',issuedAt:now,expiresAt:license.expiresAt||null}):undefined;
  const prior=await store.findInstallation(installationId);
  if(prior&&String(prior.product||'PDV')!==product)return json({error:'Instalacao ja vinculada a outro produto.'},409);
  const installation={installationId,accountId:token.accountId||license.accountId||null,licenseId:license.id,accountEmail:email,product,status:'ACTIVE',activatedAt:now};
  if(product==='WPPPROSPECTOR'){
    if(!await store.registerCRMInstallation(installation,Number(license.maxDevices||3)))return json({error:'Limite de computadores desta licenca atingido. Desative um dispositivo na Central antes de ativar outro.'},409);
  }else await store.saveInstallation(installation);
  await store.consumeActivationToken(token.id,now);
  return json({licenseId:license.id,accountEmail:email,product,expiresAt:license.expiresAt||null,activatedAt:now,...(entitlement?{entitlement}:{})});
}

async function requestPasswordRecovery(request,env){
  const body=await readBody(request);
  const email=normalizeEmail(body.email),installationId=normalizeInstallationId(body.installationId);
  if(!email||!installationId)return json({accepted:true},202);
  const store=await readyStore(env);
  const record=await store.findInstallation(installationId),now=new Date().toISOString();
  if(!activeInstallation(record,now)||normalizeEmail(record.accountEmail)!==email)
    return json({accepted:true},202);
  if(record.product!=='OFICINA')
    return json({accepted:true,message:'Solicite o codigo de recuperacao ao administrador ArtiSys.'},202);
  const previous=typeof store.findLatestRecoveryToken==='function'
    ?await store.findLatestRecoveryToken({email,now}):null;
  if(previous&&Date.now()-Date.parse(previous.createdAt)<RECOVERY_RESEND_MS)
    return json({accepted:true},202);
  const pepper=recoveryPepper(env);
  if(!pepper)return json({error:'Recuperacao temporariamente indisponivel.'},503);
  const code=randomCode(),createdAt=now,expiresAt=new Date(Date.parse(createdAt)+OFICINA_RECOVERY_TTL_MS).toISOString();
  const codeDigest=await digestToken({pepper,email,code});
  const saved=await store.createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt});
  if(!saved)return json({accepted:true},202);
  try{
    const payload={email,installationId,code,issuedAt:createdAt};
    payload.signature=await signMailRelay(pepper,payload);
    const deliver=await (env.MAIL_RELAY_FETCH||fetch)(MAIL_RELAY_URL,{
      method:'POST',redirect:'manual',headers:{'content-type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)
    });
    if(!deliver.ok||(await deliver.json())?.accepted!==true)throw Error('Relay failed');
  }catch{
    if(saved.tokenId)await store.consumeRecoveryToken(saved.tokenId,new Date().toISOString());
    return json({error:'Envio de recuperacao temporariamente indisponivel. Contate o suporte ArtiSys.'},503);
  }
  return json({accepted:true},202);
}
async function authorizeMailRelay(request,env){
  const body=await readBody(request);
  const email=normalizeEmail(body.email),installationId=normalizeInstallationId(body.installationId);
  const code=String(body.code||''),issuedAt=String(body.issuedAt||''),signature=String(body.signature||'');
  const issuedMs=Date.parse(issuedAt);
  if(!email||!installationId||!/^[0-9]{6}$/.test(code)||!/^[a-f0-9]{64}$/i.test(signature)||
      !Number.isFinite(issuedMs)||Math.abs(Date.now()-issuedMs)>65000)
    return json({authorized:false},403);
  const pepper=recoveryPepper(env);
  if(!pepper)return json({authorized:false},503);
  const expected=await signMailRelay(pepper,{email,installationId,code,issuedAt});
  if(!(await secureEqual(expected,signature)))return json({authorized:false},403);
  const store=await readyStore(env),now=new Date().toISOString();
  const installation=await store.findInstallation(installationId);
  if(!activeInstallation(installation,now)||installation.product!=='OFICINA'||
     normalizeEmail(installation.accountEmail)!==email)return json({authorized:false},403);
  const digest=await digestToken({pepper,email,code});
  const token=await store.findRecoveryToken({email,installationId,digest,now});
  if(!token||token.createdAt!==issuedAt)return json({authorized:false},403);
  if(!await store.authorizeRecoveryRelay({tokenId:token.id,at:now}))
    return json({authorized:false},403);
  return json({authorized:true});
}

async function verifyPasswordRecovery(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);const code=String(body.code||'').trim();
  if(!email||!installationId||!/^[0-9]{6}$/.test(code))return json({error:'Codigo de recuperacao invalido ou expirado.'},400);
  const pepper=recoveryPepper(env);if(!pepper)return json({error:'Servico de recuperacao indisponivel.'},503);
  const store=await readyStore(env);const now=new Date().toISOString();const digest=await digestToken({pepper,email,code});
  const token=typeof store.findRecoveryCandidate==='function'
    ? await store.findRecoveryCandidate({email,installationId,now})
    : await store.findRecoveryToken({email,installationId,digest,now});
  if(!token)return json({error:'Codigo de recuperacao invalido ou expirado.'},400);
  if(token.tokenDigest&&token.tokenDigest!==digest){
    if(typeof store.incrementRecoveryAttempts==='function')await store.incrementRecoveryAttempts(token.id);
    return json({error:'Codigo de recuperacao invalido ou expirado.'},400);
  }
  const consumed=await store.consumeRecoveryToken(token.id,now);
  if(consumed===false)return json({error:'Codigo ja utilizado ou expirado.'},400);
  return json({verified:true,accountEmail:email,installationId});
}


async function createAdminSession(request,env){
  const expected=String(env.ADMIN_TOKEN||'').trim();
  if(!expected)return json({error:'ADMIN_TOKEN ausente.'},503);
  const body=await readBody(request);
  const provided=String(body.token||'');
  if(!provided||!(await secureEqual(provided,expected)))return json({error:'Credencial administrativa invalida.'},401);
  const store=await readyStore(env);
  const token=randomSessionToken();
  const tokenDigest=await adminSessionDigest(env,token);
  const createdAt=new Date().toISOString();
  const expiresAt=new Date(Date.now()+ADMIN_SESSION_TTL_MS).toISOString();
  await store.createAdminSession({tokenDigest,createdAt,expiresAt});
  return new Response(null,{status:204,headers:{
    'cache-control':'no-store',
    'set-cookie':sessionCookie(token,Math.floor(ADMIN_SESSION_TTL_MS/1000))
  }});
}

async function adminSessionAuthorized(request,env){
  const token=cookieValue(request,ADMIN_SESSION_COOKIE);
  if(!token)return false;
  const digest=await adminSessionDigest(env,token);
  if(!digest)return false;
  const store=await readyStore(env);
  return Boolean(await store.findAdminSession({digest,now:new Date().toISOString()}));
}

async function revokeAdminSession(request,env){
  const token=cookieValue(request,ADMIN_SESSION_COOKIE);
  if(token){
    const digest=await adminSessionDigest(env,token);
    if(digest){const store=await readyStore(env);await store.deleteAdminSession(digest);}
  }
  return new Response(null,{status:204,headers:{
    'cache-control':'no-store',
    'set-cookie':sessionCookie('',0)
  }});
}

function loginHtml(){return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar | Central de Licenças ArtiSys</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18181b;background:#f4f5f7}
*{box-sizing:border-box}body{margin:0}.wrap{min-height:100vh;display:grid;place-items:center;padding:20px}.card{width:min(440px,100%);background:#fff;border:1px solid #dddfe4;border-radius:18px;padding:24px;box-shadow:0 8px 30px rgba(0,0,0,.06)}
h1{margin:0 0 8px;font-size:26px}.sub{margin:0 0 22px;color:#64646f}.field{display:flex;flex-direction:column;gap:7px}label{font-weight:700;font-size:14px}
input,button{font:inherit;border-radius:10px;border:1px solid #c9cbd1;padding:12px}button{cursor:pointer;font-weight:750;background:#18181b;color:#fff;border-color:#18181b;margin-top:12px;width:100%}
.error{min-height:20px;margin-top:12px;color:#b42318;font-size:14px}.hint{font-size:12px;color:#71717a;margin-top:14px}
</style>
</head>
<body>
<div class="wrap"><div class="card">
  <h1>Entrar na Central</h1>
  <p class="sub">Acesso restrito à administração de licenças ArtiSys.</p>
  <div class="field"><label for="token">Senha administrativa</label><input id="token" type="password" autocomplete="current-password" autofocus></div>
  <button id="login" type="button" onclick="login()">Entrar</button>
  <div id="error" class="error"></div>
  <div class="hint">A credencial é usada somente para criar a sessão segura e não fica armazenada nesta página.</div>
</div></div>
<script>
async function login(){
  const input=document.querySelector('#token'),button=document.querySelector('#login'),error=document.querySelector('#error');
  error.textContent='';button.disabled=true;
  try{
    const r=await fetch('/v1/admin/session',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json'},body:JSON.stringify({token:input.value})});
    input.value='';
    if(!r.ok){let j={};try{j=await r.json()}catch{}throw Error(j.error||'Falha ao entrar.');}
    location.reload();
  }catch(e){error.textContent=e.message;}finally{button.disabled=false;}
}
document.querySelector('#token').addEventListener('keydown',event=>{if(event.key==='Enter')login();});
</script>
</body>
</html>`;}

function adminHtml(){return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Central de Licenças ArtiSys</title>
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#18181b;background:#f4f5f7}
*{box-sizing:border-box}body{margin:0}.wrap{max-width:1080px;margin:0 auto;padding:28px 16px 48px}.top{display:flex;gap:14px;justify-content:space-between;align-items:flex-start}
h1{margin:0 0 6px;font-size:30px}h2{margin:0 0 14px;font-size:18px}.sub{margin:0 0 22px;color:#64646f}
.card{background:#fff;border:1px solid #dddfe4;border-radius:16px;padding:20px;margin:14px 0;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:end}.field{display:flex;flex-direction:column;gap:6px;min-width:220px;flex:1}#crm-device-field[hidden]{display:none}
label{font-weight:650;font-size:14px}input,select,button{font:inherit;border-radius:10px;border:1px solid #c9cbd1;padding:11px 12px}
button{cursor:pointer;font-weight:700;background:#18181b;color:#fff;border-color:#18181b}.secondary{background:#fff;color:#18181b}
.hint{font-size:13px;color:#70707b}.result{margin-top:16px;padding:16px;background:#f7f7f8;border-radius:12px;display:none}
.code{font-size:34px;letter-spacing:7px;font-weight:850;margin:8px 0}.manual{font-weight:700;margin:4px 0}
.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:700px}td,th{padding:10px;border-bottom:1px solid #ececf0;text-align:left;white-space:nowrap}
th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#71717a}.muted{color:#71717a}.actions{display:flex;gap:6px;flex-wrap:wrap}.actions button{padding:7px 9px;font-size:12px}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-top:12px}
.kpi{border:1px solid #e4e4e7;border-radius:12px;padding:14px;background:#fafafa}
.kpi strong{display:block;font-size:25px;line-height:1.3;font-variant-numeric:tabular-nums}
.kpi span{display:block;font-size:12px;color:#62626d;margin-top:5px}
#nexus-history-dialog{width:min(680px,calc(100vw - 30px));max-height:80vh;overflow:auto;border:1px solid #e4e4e7;border-radius:16px;padding:24px;color:#18181b;background:white}
#nexus-history-dialog::backdrop{background:#11182799}
.event{border-bottom:1px solid #eee;padding:11px 0}.event strong{display:block}.event small{color:#71717a}
@media(max-width:640px){.wrap{padding:18px 12px}.card{padding:16px}.field{min-width:100%}.code{font-size:30px}.top{align-items:center}.top h1{font-size:25px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div><h1>Central de Licenças ArtiSys</h1><p class="sub">Libere o acesso do cliente manualmente. A Central gera o código e você envia o código ao cliente.</p></div><button type="button" class="secondary" onclick="logout()">Sair</button></div>

  <div class="card" aria-labelledby="nexus-overview-title">
    <h2 id="nexus-overview-title">Painel comercial · PDV Nexus 2.0</h2>
    <p class="hint">Avaliações de 72 horas, conversões e entregas de boas-vindas. Dados agregados somente do Nexus.</p>
    <div id="nexus-kpis" class="kpi-grid" aria-live="polite">Carregando indicadores…</div>
  </div>
  <div class="card">
    <h2>Liberar novo acesso</h2>
    <div class="row">
      <div class="field"><label for="product">Produto</label><select id="product"><option value="PDV">PDV ArtiSys</option><option value="OFICINA">ArtiSys Oficina</option><option value="ALMOXARIFADO">ArtiSys Almoxarifado</option><option value="WPPPROSPECTOR">ArtiSys CRM WhatsApp Prospector</option><option value="LOJA_ROUPAS">Loja Roupas</option><option value="PDV_NEXUS_2">PDV Nexus 2.0</option></select></div>
      <div class="field"><label for="email">E-mail do cliente</label><input id="email" type="email" autocomplete="email" placeholder="cliente@empresa.com"></div>
      <div class="field"><label for="expires">Validade da licença <span class="hint">(vazio = vitalícia)</span></label><input id="expires" type="date"></div>
       <div class="field" id="crm-device-field" hidden><label for="maxDevices">Computadores por loja (CRM)</label><input id="maxDevices" type="number" min="1" max="20" value="3"></div>
      <button type="button" onclick="release()">Gerar código</button>
    </div>
    <div id="released" class="result">
      <div class="hint">Código de ativação</div>
      <div id="released-code" class="code"></div>
      <div class="manual">Você envia o código ao cliente.</div>
      <div id="released-expiry" class="hint"></div>
      <p><button type="button" class="secondary" onclick="copyCode()">Copiar código</button></p>
    </div>
  </div>

  <div class="card">
    <h2>Licenças</h2><div class="row"><label class="field">Filtrar por produto<select id="filter-product"><option value="all">Todos os produtos</option><option value="PDV_NEXUS_2">PDV Nexus 2.0</option><option value="PDV">PDV ArtiSys</option><option value="OFICINA">ArtiSys Oficina</option><option value="ALMOXARIFADO">ArtiSys Almoxarifado</option><option value="WPPPROSPECTOR">CRM Prospector</option><option value="LOJA_ROUPAS">Loja Roupas</option></select></label><label class="field">Modalidade<select id="filter-kind"><option value="all">Todas</option><option value="TRIAL">Avaliação</option><option value="COMMERCIAL">Comercial</option></select></label><label class="field">Origem<select id="filter-source"><option value="all">Todas</option><option value="AUTO_SIGNUP">Automática</option><option value="MANUAL">Manual</option><option value="ADMIN_CONVERSION">Conversão administrativa</option></select></label><label class="field">Buscar e-mail<input id="filter-email" type="search" placeholder="cliente@empresa.com" autocomplete="off" maxlength="254"></label></div><p class='hint'>Se o cliente formatou ou reinstalou o computador, use Reativar instalação na licença ativa. O novo código não cancela a licença; os dados locais exigem backup.</p>
    <div id="list" class="muted">Carregando...</div>
  </div>
  <dialog id="nexus-history-dialog" aria-labelledby="nexus-history-title">
    <div class="row" style="justify-content:space-between;align-items:center">
      <h2 id="nexus-history-title">Histórico da licença</h2>
      <button type="button" class="secondary" onclick="document.querySelector('#nexus-history-dialog').close()">Fechar</button>
    </div>
    <div id="nexus-history-events">Carregando…</div>
  </dialog>
</div>
<script>
async function api(p,o={}){
  const r=await fetch(p,{...o,credentials:'same-origin',headers:{'content-type':'application/json',...(o.headers||{})}});
  if(r.status===401){location.reload();throw Error('Sessão expirada.');}
  let j={};try{j=await r.json()}catch{}
  if(!r.ok)throw Error(j.error||'Falha');
  return j;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
async function loadNexusOverview(){
 const target=document.querySelector('#nexus-kpis');if(!target)return;
 try{
  const j=await api('/v1/admin/nexus/overview');const s=j.summary||{};
  const cards=[
   ['Avaliações iniciadas',s.totalTrials||0],['Avaliações ativas',s.activeTrials||0],
   ['Vencem em 24h',s.expiring24h||0],['Testes expirados',s.expiredTrials||0],
   ['Convertidas',s.converted||0],['Taxa de conversão',String(s.conversionRatePct||0)+'%'],
   ['Falhas de boas-vindas',s.failedWelcomeEmails||0],['Novos testes (7 dias)',s.trialStartsLast7Days||0]
  ];
  target.innerHTML=cards.map(x=>'<div class="kpi"><strong>'+esc(x[1])+'</strong><span>'+esc(x[0])+'</span></div>').join('');
 }catch(e){target.textContent='Indicadores indisponíveis: '+e.message}
}
async function showNexusHistory(id){
 const dialog=document.querySelector('#nexus-history-dialog'),content=document.querySelector('#nexus-history-events');
 content.textContent='Carregando histórico…';dialog.showModal();
 try{
  const j=await api('/v1/admin/nexus/licenses/'+encodeURIComponent(id)+'/events');
  const names={TRIAL_ACTIVATED:'Avaliação iniciada',TRIAL_CONVERTED:'Convertida em comercial',WELCOME_RESEND:'Boas-vindas reenviadas',
   LICENSE_STATUS_CHANGED:'Status alterado',COMMERCIAL_ISSUED:'Licença comercial emitida',ACTIVATION_CODE_REISSUED:'Código reemitido'};
  content.innerHTML=j.events.length?j.events.map(x=>'<div class="event"><strong>'+esc(names[x.eventType]||x.eventType)+'</strong><small>'+
   esc(new Date(x.createdAt).toLocaleString('pt-BR'))+' · '+esc(x.actor)+'</small>'+
   (x.details&&Object.keys(x.details).length?'<p class="hint">'+esc(Object.entries(x.details).map(([k,v])=>k+': '+v).join(' · '))+'</p>':'')+
   '</div>').join(''):'<p class="hint">Nenhuma ocorrência registrada.</p>';
 }catch(e){content.textContent='Falha ao consultar histórico: '+e.message}
}
async function resendNexusWelcome(id){
 if(!confirm('Reenviar agora o e-mail de boas-vindas desta licença Nexus?'))return;
 try{
  const j=await api('/v1/admin/nexus/licenses/'+encodeURIComponent(id)+'/resend-welcome',{method:'POST',body:'{}'});
  alert(j.delivery.status==='sent'?'E-mail enviado.':'Envio falhou. Verifique a configuração de e-mail e tente novamente depois.');
  await load();
 }catch(e){alert(e.message)}
}
async function load(){try{void loadNexusOverview();const j=await api('/v1/admin/licenses');const visible=j.licenses.filter(x=>(document.querySelector('#filter-product').value==='all'||x.product===document.querySelector('#filter-product').value)&&(document.querySelector('#filter-kind').value==='all'||x.kind===document.querySelector('#filter-kind').value)&&(document.querySelector('#filter-source').value==='all'||x.source===document.querySelector('#filter-source').value)&&(String(x.email||'').toLowerCase().includes(document.querySelector('#filter-email').value.trim().toLowerCase())));document.querySelector('#list').innerHTML='<div class="table-wrap"><table><tr><th>Produto</th><th>E-mail</th><th>Tipo</th><th>Origem</th><th>Boas-vindas</th><th>Status</th><th>Validade</th><th>Dispositivos</th><th>Instalação</th><th>Ações</th></tr>'+visible.map(x=>'<tr><td>'+esc(x.product||'PDV')+'</td><td>'+esc(x.email)+'</td><td>'+esc(x.kind||'COMMERCIAL')+'</td><td>'+esc(x.source||'MANUAL')+'</td><td>'+esc(x.welcome_status||'-')+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.expires_at||'Vitalícia')+'</td><td>'+esc(x.product==='WPPPROSPECTOR'?(String(x.device_count||0)+' / '+String(x.max_devices||3)):'-')+'</td><td>'+esc(x.installation_id||'-')+'</td><td><div class="actions">'+(x.installation_id?'<button onclick="recovery(decodeURIComponent(\\''+encodeURIComponent(x.installation_id)+'\\'),decodeURIComponent(\\''+encodeURIComponent(x.email)+'\\'))">Recuperação</button>':'')+'<button onclick="status(\\''+encodeURIComponent(x.id)+'\\',\\'SUSPENDED\\')">Suspender</button><button onclick="status(\\''+encodeURIComponent(x.id)+'\\',\\'CANCELLED\\')">Cancelar</button></div></td></tr>').join('')+'</table></div>';
  document.querySelectorAll('#list table tr').forEach((row,i)=>{
    const license=visible[i-1];if(!license)return;
    const actions=row.querySelector('.actions');if(!actions)return;
    if(license.product==='PDV_NEXUS_2'){
      const history=document.createElement('button');history.type='button';history.className='secondary';history.textContent='Histórico';
      history.addEventListener('click',()=>showNexusHistory(license.id));actions.prepend(history);
      if(license.status==='ACTIVE'&&(!license.expires_at||license.expires_at>new Date().toISOString())){
        const resend=document.createElement('button');resend.type='button';resend.className='secondary';resend.textContent='Reenviar boas-vindas';
        resend.addEventListener('click',()=>resendNexusWelcome(license.id));actions.append(resend);
      }
    }
    if(license.status!=='ACTIVE')return;
    const button=document.createElement('button');button.type='button';button.textContent='Reativar instalação';
    button.addEventListener('click',()=>reactivate(license.id));actions.prepend(button);
    if(license.product==='PDV_NEXUS_2'&&license.kind==='TRIAL'){const convert=document.createElement('button');convert.type='button';convert.className='secondary';convert.textContent='Converter em comercial';convert.addEventListener('click',()=>convertTrial(license.id));actions.prepend(convert);}
    if(license.product==='WPPPROSPECTOR'){const limit=document.createElement('button');limit.type='button';limit.className='secondary';limit.textContent='Alterar limite';limit.addEventListener('click',()=>changeDeviceLimit(license.id,license.max_devices||3));actions.append(limit);}
    if(license.product==='WPPPROSPECTOR')for(const id of license.device_ids||[]){const remove=document.createElement('button');remove.type='button';remove.className='secondary';remove.textContent='Desativar PC: '+id.slice(0,12);remove.title=id;remove.addEventListener('click',()=>removeDevice(license.id,id));actions.append(remove);}
  });
}catch(e){alert(e.message)}}
async function release(){try{const product=document.querySelector('#product').value,email=document.querySelector('#email').value,expiresAt=document.querySelector('#expires').value||null;const j=await api('/v1/admin/licenses',{method:'POST',body:JSON.stringify({email,product,expiresAt,...(product==='WPPPROSPECTOR'?{maxDevices:Number(document.querySelector('#maxDevices').value)}:{})})});document.querySelector('#released-code').textContent=j.code;document.querySelector('#released-expiry').textContent='Código válido até '+j.codeExpiresAt+(j.delivery?' · E-mail: '+(j.delivery.status==='sent'?'enviado':'falhou — envie o código manualmente ou reemita'):'');document.querySelector('#released').style.display='block';await load()}catch(e){alert(e.message)}}
async function reactivate(id){
  try{
    const j=await api('/v1/admin/licenses/'+encodeURIComponent(id)+'/activation-code',{method:'POST'});
    document.querySelector('#released-code').textContent=j.code;
    document.querySelector('#released-expiry').textContent='Código de reativação válido até '+j.codeExpiresAt+(j.delivery?' · E-mail: '+(j.delivery.status==='sent'?'enviado':'falhou — envie o código manualmente'):'');
    document.querySelector('#released').style.display='block';
    document.querySelector('#released').scrollIntoView({behavior:'smooth',block:'nearest'});
    await load();
  }catch(e){alert(e.message)}
}
async function convertTrial(id){const input=prompt('Validade da licença comercial (AAAA-MM-DD). Deixe vazio para vitalícia.','');if(input===null)return;if(input&&!/^\\d{4}-\\d{2}-\\d{2}$/.test(input)){alert('Data inválida');return;}try{await api('/v1/admin/licenses/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({convertToCommercial:true,expiresAt:input||null})});await load()}catch(e){alert(e.message)}}
async function changeDeviceLimit(licenseId,current){const raw=prompt('Quantos computadores esta licença CRM permite? (1 a 20)',String(current));if(raw===null)return;const maxDevices=Number(raw);if(!Number.isInteger(maxDevices)||maxDevices<1||maxDevices>20){alert('Informe um número inteiro entre 1 e 20.');return;}try{await api('/v1/admin/licenses/'+encodeURIComponent(licenseId),{method:'PATCH',body:JSON.stringify({maxDevices})});await load()}catch(e){alert(e.message)}}
async function removeDevice(licenseId,installationId){if(!confirm('Desativar este computador da licença CRM? Ele perderá o acesso quando consultar novamente a Central.'))return;try{await api('/v1/admin/licenses/'+encodeURIComponent(licenseId)+'/installations/'+encodeURIComponent(installationId),{method:'DELETE'});await load()}catch(e){alert(e.message)}}
function toggleCRMDevices(){document.querySelector('#crm-device-field').hidden=document.querySelector('#product').value!=='WPPPROSPECTOR'}
document.querySelector('#product').addEventListener('change',toggleCRMDevices);toggleCRMDevices();
async function copyCode(){const code=document.querySelector('#released-code').textContent.trim();if(!code)return;try{await navigator.clipboard.writeText(code)}catch{const el=document.createElement('textarea');el.value=code;document.body.appendChild(el);el.select();document.execCommand('copy');el.remove()}}
async function recovery(installationId,email){try{const j=await api('/v1/admin/recovery',{method:'POST',body:JSON.stringify({installationId,email})});alert('Código de recuperação: '+j.code+' (15 min). Você envia esse código ao cliente.')}catch(e){alert(e.message)}}
async function status(id,status){try{await api('/v1/admin/licenses/'+decodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status})});await load()}catch(e){alert(e.message)}}
async function logout(){try{await fetch('/v1/admin/session',{method:'DELETE',credentials:'same-origin'});}finally{location.reload();}}
document.querySelectorAll('#filter-product,#filter-kind,#filter-source').forEach(el=>el.addEventListener('change',load));
let filterTimer;
document.querySelector('#filter-email').addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(load,250)});
load();
</script>
</body>
</html>`;}

async function adminRoute(request,env,url){
  if(request.method==='POST'&&url.pathname==='/v1/admin/session')return createAdminSession(request,env);
  if(request.method==='DELETE'&&url.pathname==='/v1/admin/session')return revokeAdminSession(request,env);
  if(request.method==='GET'&&url.pathname==='/admin'){
    const authorized=await adminSessionAuthorized(request,env);
    return new Response(authorized?adminHtml():loginHtml(),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  }
  if(!url.pathname.startsWith('/v1/admin/'))return null;
  if(!(await adminSessionAuthorized(request,env)))return json({error:'Nao autorizado.'},401);
  const store=await readyStore(env);
  if(request.method==='GET'&&url.pathname==='/v1/admin/nexus/overview')return json({summary:await nexusLicenseDashboard(env)});
  const nexusEvents=url.pathname.match(/^\/v1\/admin\/nexus\/licenses\/([^/]+)\/events$/);
  if(request.method==='GET'&&nexusEvents){
    const id=decodeURIComponent(nexusEvents[1]);
    if(!/^[A-Za-z0-9_-]{3,128}$/.test(id))return json({error:'Licenca invalida.'},400);
    const record=await store.findLicenseById(id);
    if(!record||record.product!=='PDV_NEXUS_2')return json({error:'Licenca Nexus nao encontrada.'},404);
    return json({events:await nexusLicenseHistory(env,id)});
  }
  const nexusResend=url.pathname.match(/^\/v1\/admin\/nexus\/licenses\/([^/]+)\/resend-welcome$/);
  if(request.method==='POST'&&nexusResend){
    const id=decodeURIComponent(nexusResend[1]);
    if(!/^[A-Za-z0-9_-]{3,128}$/.test(id))return json({error:'Licenca invalida.'},400);
    const record=await store.findLicenseById(id);
    if(!record||record.product!=='PDV_NEXUS_2')return json({error:'Licenca Nexus nao encontrada.'},404);
    const delivery=await resendNexusWelcome(env,id);
    if(delivery.status==='rate_limited')return json({error:'Aguarde 5 minutos antes de reenviar este e-mail.'},429);
    if(delivery.status==='unavailable')return json({error:'Licenca ativa nao elegivel para reenvio.'},409);
    return json({delivery});
  }
  if(request.method==='GET'&&url.pathname==='/v1/admin/licenses')return json({licenses:await store.listLicenses()});
  if(request.method==='POST'&&url.pathname==='/v1/admin/licenses'){
    const body=await readBody(request),email=normalizeEmail(body.email),product=normalizeProduct(body.product);if(!email||!product)return json({error:'E-mail ou produto invalido.'},400);
    const maxDevices=product==='WPPPROSPECTOR'?(body.maxDevices===undefined?3:body.maxDevices):null;
    if(product==='WPPPROSPECTOR'&&(!Number.isInteger(maxDevices)||maxDevices<1||maxDevices>20))return json({error:'Limite de dispositivos invalido (1 a 20).'},400);
    if(await store.findActiveLicense(email,product))return json({error:'Este e-mail ja possui licenca ativa. Use Reativar instalacao na lista para emitir outro codigo sem cancelar a licenca.'},409);
    const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'ACTIVATION_PEPPER ausente.'},503);
    let expiresAt=null;if(body.expiresAt){const d=new Date(body.expiresAt+'T23:59:59.999Z');if(Number.isNaN(d.getTime()))return json({error:'Validade invalida.'},400);expiresAt=d.toISOString();}
    const code=randomCode(),createdAt=new Date().toISOString(),codeExpiresAt=new Date(Date.parse(createdAt)+ACTIVATION_TOKEN_TTL_MS).toISOString(),codeDigest=await digestToken({pepper,email,code});
    const provisioned=await store.provisionLicense({email,product,expiresAt,maxDevices,codeDigest,codeExpiresAt,createdAt});
    if(product==='PDV_NEXUS_2')await logNexusLicenseEvent(env,provisioned.licenseId,'COMMERCIAL_ISSUED','admin',{expiresAt});
     const delivery=['LOJA_ROUPAS','ALMOXARIFADO'].includes(product)
       ?await deliverCommercialWelcome({email,licenseId:provisioned.licenseId,code,codeExpiresAt,issuedAt:createdAt,product},env)
       :undefined;
     return json({...provisioned,email,product,code,codeExpiresAt,expiresAt,maxDevices,...(delivery?{delivery}:{})},201);
  }

  if(request.method==='POST'&&url.pathname.startsWith('/v1/admin/licenses/')&&url.pathname.endsWith('/activation-code')){
    const id=decodeURIComponent(url.pathname.slice('/v1/admin/licenses/'.length,-'/activation-code'.length));
    if(!id||id.includes('/')||id.length>128)return json({error:'Licenca invalida.'},400);
    const license=await store.findLicenseById(id);
    const now=new Date().toISOString();
    if(!license||license.status!=='ACTIVE'||(license.expiresAt&&license.expiresAt<=now))return json({error:'Licenca ativa nao encontrada para reativacao.'},409);
    const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'ACTIVATION_PEPPER ausente.'},503);
    const code=randomCode(),codeExpiresAt=new Date(Date.parse(now)+ACTIVATION_TOKEN_TTL_MS).toISOString();
    const rotated=await store.rotateActivationTokenForLicense({licenseId:id,codeDigest:await digestToken({pepper,email:license.email,code}),codeExpiresAt,createdAt:now});
    if(rotated&&license.product==='PDV_NEXUS_2')await logNexusLicenseEvent(env,id,'ACTIVATION_CODE_REISSUED','admin',{codeExpiresAt});
    if(!rotated)return json({error:'Licenca ativa nao encontrada para reativacao.'},409);
    const delivery=['LOJA_ROUPAS','ALMOXARIFADO'].includes(license.product)
       ?await deliverCommercialWelcome({email:license.email,licenseId:id,code,codeExpiresAt,issuedAt:now,product:license.product},env)
       :undefined;
     return json({...rotated,code,codeExpiresAt,...(delivery?{delivery}:{})},201);
  }
  if(request.method==='DELETE'&&/^\/v1\/admin\/licenses\/[^/]+\/installations\/[^/]+$/.test(url.pathname)){
    const parts=url.pathname.split('/'),id=decodeURIComponent(parts[4]),installationId=normalizeInstallationId(decodeURIComponent(parts[6]));
    if(!id||id.length>128||!installationId)return json({error:'Licenca ou instalacao invalida.'},400);
    const license=await store.findLicenseById(id);
    if(!license||license.product!=='WPPPROSPECTOR')return json({error:'Licenca CRM nao encontrada.'},404);
    const removed=await store.removeInstallation(id,installationId);
    return removed?json({removed:true,id,installationId}):json({error:'Dispositivo nao encontrado na licenca.'},404);
  }
  if(request.method==='PATCH'&&url.pathname.startsWith('/v1/admin/licenses/')){
    const id=decodeURIComponent(url.pathname.slice('/v1/admin/licenses/'.length));
    if(!id||id.includes('/')||id.length>128)return json({error:'Licenca invalida.'},400);
    const body=await readBody(request);
    if(body.convertToCommercial===true){
      let expiresAt=null;
      if(body.expiresAt!==null&&body.expiresAt!==undefined&&body.expiresAt!==''){
        const date=new Date(body.expiresAt+'T23:59:59.999Z');if(Number.isNaN(date.getTime())||date.getTime()<=Date.now())return json({error:'Validade invalida.'},400);
        expiresAt=date.toISOString();
      }
      if(typeof store.convertNexusTrial!=='function'||!await store.convertNexusTrial(id,expiresAt))return json({error:'Licenca de avaliacao Nexus nao encontrada.'},409);
      await logNexusLicenseEvent(env,id,'TRIAL_CONVERTED','admin',{expiresAt});
      return json({updated:true,id,kind:'COMMERCIAL',expiresAt});
    }
    if(Object.hasOwn(body,'maxDevices')){
      if(!Number.isInteger(body.maxDevices)||body.maxDevices<1||body.maxDevices>20)return json({error:'Limite de dispositivos invalido (1 a 20).'},400);
      if(!await store.setCRMDeviceLimit(id,body.maxDevices))return json({error:'Nao e possivel diminuir o limite abaixo dos dispositivos ativos, ou esta licenca nao e do CRM.'},409);
      return json({updated:true,id,maxDevices:body.maxDevices});
    }
    const status=String(body.status||'').toUpperCase();
    if(!['ACTIVE','SUSPENDED','CANCELLED','EXPIRED'].includes(status))return json({error:'Status invalido.'},400);
    const existingLicense=await store.findLicenseById(id);
    await store.setLicenseStatus(id,status);
    if(existingLicense?.product==='PDV_NEXUS_2')await logNexusLicenseEvent(env,id,'LICENSE_STATUS_CHANGED','admin',{status,previousStatus:existingLicense.status});
    return json({updated:true,id,status});
  }
  if(request.method==='POST'&&url.pathname==='/v1/admin/recovery'){
    const body=await readBody(request),email=normalizeEmail(body.email),installationId=normalizeInstallationId(body.installationId);if(!email||!installationId)return json({error:'E-mail ou instalacao invalidos.'},400);
    const pepper=recoveryPepper(env);if(!pepper)return json({error:'RECOVERY_PEPPER ausente.'},503);
    const code=randomCode(),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+RECOVERY_TTL_MS).toISOString(),codeDigest=await digestToken({pepper,email,code});
    const result=await store.createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt});if(!result)return json({error:'Instalacao ativa nao encontrada para este e-mail.'},404);return json({email,installationId,code,expiresAt},201);
  }
  return json({error:'Rota administrativa nao encontrada.'},404);
}

async function licenseStatus(url,env){
  const installationId=normalizeInstallationId(url.searchParams.get('installationId')),product=normalizeProduct(url.searchParams.get('product'));if(!installationId||!product)return json({error:'Instalacao invalida.'},400);
  const store=await readyStore(env);const record=await store.findInstallation(installationId);const now=new Date().toISOString();
  const active=String(record?.product||'PDV')===product&&activeInstallation(record,now);
  // Contrato público antigo do PDV: somente {active}. Sem regressão dos clientes instalados.
  if(product==='PDV')return json({active});
  return json({active,product,expiresAt:active?record.expiresAt||null:null});
}


// Endpoints públicos estáveis: redirecionam apenas para os artefatos comerciais
// publicados na release oficial. Não substituem por edição livre se ausentes.
const ALMOX_LATEST_RELEASE='https://api.github.com/repos/nutricionistaalmeidavh-spec/Almoxarifado/releases/latest';
const ALMOX_RELEASE_PREFIX='https://github.com/nutricionistaalmeidavh-spec/Almoxarifado/releases/download/';
async function almoxarifadoPublishedAsset(env,{manual=false}={}){
  try{
    const sender=env.ALMOX_RELEASE_FETCH||fetch;
    const response=await sender(ALMOX_LATEST_RELEASE,{
      headers:{accept:'application/vnd.github+json','user-agent':'ArtiSys-License-Center'},
      redirect:'manual',signal:AbortSignal.timeout(6500),
      cf:{cacheTtl:300,cacheEverything:true}
    });
    if(!response.ok)return json({error:'Download comercial ainda indisponível.'},503);
    const release=await response.json();
    if(release.draft||release.prerelease||!/^v?\d+\.\d+\.\d+$/.test(String(release.tag_name||'')))
      return json({error:'Release comercial ainda indisponível.'},503);
    const version=release.tag_name.replace(/^v/,'');
    const expectedName=manual?'Manual-ArtiSys-Almoxarifado.pdf':
      'ArtiSys-Almoxarifado-Setup-'+version+'-Commercial.exe';
    const asset=Array.isArray(release.assets)?release.assets.find(item=>item.name===expectedName):null;
    const download=String(asset?.browser_download_url||'');
    const expectedUrl=ALMOX_RELEASE_PREFIX+encodeURIComponent(release.tag_name)+'/'+expectedName;
    if(download!==expectedUrl)return json({error:'Artefato comercial não publicado.'},503);
    return new Response(null,{status:302,headers:{
      location:download,'cache-control':'public, max-age=300','x-content-type-options':'nosniff'
    }});
  }catch{return json({error:'Não foi possível consultar a distribuição oficial.'},503);}
}

export async function handleRequest(request,env={}){
  const url=new URL(request.url);try{
    const adminResponse=await adminRoute(request,env,url);if(adminResponse)return adminResponse;
    const nexus=await handleNexusTrial(request,env,url,readyStore);if(nexus)return nexus;
    if((request.method==='GET'||request.method==='HEAD')&&url.pathname==='/download/almoxarifado')return await almoxarifadoPublishedAsset(env);
    if((request.method==='GET'||request.method==='HEAD')&&url.pathname==='/manual/almoxarifado.pdf')return await almoxarifadoPublishedAsset(env,{manual:true});
    if(request.method==='GET'&&url.pathname==='/health')return json({ok:true,service:'artisys-account'});
    if(request.method==='POST'&&url.pathname==='/v1/activation/request')return await requestActivation(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/activation/verify')return await verifyActivation(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/password-recovery/relay-authorize')return await authorizeMailRelay(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/license-welcome/relay-authorize')return await authorizeWelcomeRelay(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/password-recovery/request')return await requestPasswordRecovery(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/password-recovery/verify')return await verifyPasswordRecovery(request,env);
    if(request.method==='GET'&&url.pathname==='/v1/license/status')return await licenseStatus(url,env);
    return json({error:'Rota nao encontrada.'},404);
  }catch(error){return json({error:error?.message||'Falha interna.'},Number(error?.statusCode)||500);}
}

export default {fetch:handleRequest};
export {D1AccountStore,digestToken,normalizeEmail};