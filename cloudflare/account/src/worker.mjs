const TOKEN_TTL_MS=10*60*1000;
const RECOVERY_TTL_MS=15*60*1000;
const RECOVERY_RESEND_MS=60*1000;
const ADMIN_ACTIVATION_TTL_MS=30*24*60*60*1000;
const RECOVERY_MAX_ATTEMPTS=5;

function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function normalizeEmail(value){const email=String(value||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;}
function normalizeInstallationId(value){const id=String(value||'').trim();return /^[A-Za-z0-9._:-]{8,128}$/.test(id)?id:null;}
function newId(prefix){return `${prefix}-${crypto.randomUUID()}`;}
function randomCode(){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return String(bytes[0]%1000000).padStart(6,'0');}
async function digestToken({pepper,email,code}){const data=new TextEncoder().encode(`${pepper}:${email}:${code}`);const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function readBody(request){const text=await request.text();if(text.length>32768)throw Object.assign(new Error('Corpo da requisicao excede o limite permitido.'),{statusCode:413});if(!text)return{};try{return JSON.parse(text);}catch{throw Object.assign(new Error('JSON invalido.'),{statusCode:400});}}

class D1AccountStore{
  constructor(db){if(!db)throw new Error('D1 DB binding ausente.');this.db=db;}
  async findAccount(email){
    const row=await this.db.prepare('SELECT id,email_normalized AS email FROM accounts WHERE email_normalized=? LIMIT 1').bind(email).first();
    return row?{id:row.id,email:row.email}:null;
  }
  async findActiveLicense(email){
    const row=await this.db.prepare(`SELECT l.id,a.id AS account_id,a.email_normalized AS email,l.status,l.expires_at
      FROM licenses l JOIN accounts a ON a.id=l.account_id
      WHERE a.email_normalized=? AND l.status='ACTIVE' AND (l.expires_at IS NULL OR l.expires_at>?)
      ORDER BY l.created_at DESC LIMIT 1`).bind(email,new Date().toISOString()).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,status:row.status,expiresAt:row.expires_at||null}:null;
  }
  async saveActivationToken(token){await this.db.prepare(`INSERT INTO activation_tokens(id,account_id,license_id,installation_id,token_digest,expires_at,used_at,created_at)
    VALUES(?,?,?,?,?,?,NULL,?)`).bind(token.id,token.accountId,token.licenseId,token.installationId,token.tokenDigest,token.expiresAt,token.createdAt).run();}
  async findActivationToken({email,digest,now}){
    const row=await this.db.prepare(`SELECT t.id,t.account_id,t.license_id,t.installation_id,t.expires_at,t.used_at,a.email_normalized AS email
      FROM activation_tokens t JOIN accounts a ON a.id=t.account_id
      WHERE a.email_normalized=? AND t.token_digest=? AND t.used_at IS NULL AND t.expires_at>? ORDER BY t.created_at DESC LIMIT 1`).bind(email,digest,now).first();
    return row?{id:row.id,accountId:row.account_id,licenseId:row.license_id,installationId:row.installation_id,email:row.email,expiresAt:row.expires_at,usedAt:row.used_at}:null;
  }
  async provisionLicense({email,expiresAt=null,codeDigest,codeExpiresAt,createdAt}){
    let account=await this.findAccount(email);
    if(!account){account={id:newId('account'),email};await this.db.prepare('INSERT INTO accounts(id,email_normalized,created_at) VALUES(?,?,?)').bind(account.id,email,createdAt).run();}
    await this.db.prepare("UPDATE licenses SET status='CANCELLED' WHERE account_id=? AND status='ACTIVE'").bind(account.id).run();
    const licenseId=newId('license');
    await this.db.prepare(`INSERT INTO licenses(id,account_id,status,created_at,expires_at,metadata_json) VALUES(?,?,'ACTIVE',?,?,?)`).bind(licenseId,account.id,createdAt,expiresAt,JSON.stringify({source:'admin-panel'})).run();
    await this.saveActivationToken({id:newId('token'),accountId:account.id,licenseId,installationId:'PENDING',tokenDigest:codeDigest,expiresAt:codeExpiresAt,createdAt});
    return {accountId:account.id,licenseId};
  }
  async listLicenses(){return (await this.db.prepare(`SELECT l.id,a.email_normalized AS email,l.status,l.created_at,l.expires_at,i.installation_id,i.activated_at FROM licenses l JOIN accounts a ON a.id=l.account_id LEFT JOIN installations i ON i.license_id=l.id ORDER BY l.created_at DESC LIMIT 200`).all()).results||[];}
  async setLicenseStatus(id,status){await this.db.prepare('UPDATE licenses SET status=? WHERE id=?').bind(status,id).run();}
  async createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt}){
    const row=await this.db.prepare(`SELECT i.account_id,a.email_normalized AS email,l.status,l.expires_at FROM installations i JOIN accounts a ON a.id=i.account_id JOIN licenses l ON l.id=i.license_id WHERE i.installation_id=? LIMIT 1`).bind(installationId).first();
    if(!row||row.email!==email||row.status!=='ACTIVE'||(row.expires_at&&row.expires_at<=createdAt))return null;
    await this.saveRecoveryToken({id:newId('recovery'),accountId:row.account_id,email,installationId,tokenDigest:codeDigest,attempts:0,createdAt,expiresAt});return {accountId:row.account_id};
  }
  async consumeActivationToken(id,usedAt){await this.db.prepare('UPDATE activation_tokens SET used_at=? WHERE id=? AND used_at IS NULL').bind(usedAt,id).run();}
  async saveRecoveryToken(token){
    await this.db.prepare(`INSERT INTO password_recovery_tokens(id,account_id,email_normalized,installation_id,token_digest,attempts,expires_at,used_at,created_at)
      VALUES(?,?,?,?,?,0,?,NULL,?)`).bind(token.id,token.accountId,token.email,token.installationId||null,token.tokenDigest,token.expiresAt,token.createdAt).run();
  }
  async findRecoveryToken({email,installationId,digest,now}){
    const row=await this.db.prepare(`SELECT id,account_id,email_normalized AS email,installation_id,attempts,expires_at,used_at,created_at
      FROM password_recovery_tokens WHERE email_normalized=? AND installation_id=? AND token_digest=? AND used_at IS NULL AND expires_at>? AND attempts<?
      ORDER BY created_at DESC LIMIT 1`).bind(email,installationId,digest,now,RECOVERY_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,installationId:row.installation_id,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at,createdAt:row.created_at}:null;
  }
  async findLatestRecoveryToken({email,now}){
    const row=await this.db.prepare(`SELECT id,account_id,email_normalized AS email,attempts,expires_at,used_at,created_at
      FROM password_recovery_tokens WHERE email_normalized=? AND used_at IS NULL AND expires_at>? AND attempts<?
      ORDER BY created_at DESC LIMIT 1`).bind(email,now,RECOVERY_MAX_ATTEMPTS).first();
    return row?{id:row.id,accountId:row.account_id,email:row.email,attempts:Number(row.attempts||0),expiresAt:row.expires_at,usedAt:row.used_at,createdAt:row.created_at}:null;
  }
  async consumeRecoveryToken(id,usedAt){await this.db.prepare('UPDATE password_recovery_tokens SET used_at=? WHERE id=? AND used_at IS NULL').bind(usedAt,id).run();}
  async incrementRecoveryAttempts(id){await this.db.prepare('UPDATE password_recovery_tokens SET attempts=attempts+1 WHERE id=? AND used_at IS NULL').bind(id).run();}
  async saveInstallation(record){await this.db.prepare(`INSERT INTO installations(installation_id,account_id,license_id,activated_at,last_seen_at)
    VALUES(?,?,?,?,?) ON CONFLICT(installation_id) DO UPDATE SET account_id=excluded.account_id,license_id=excluded.license_id,last_seen_at=excluded.last_seen_at`).bind(record.installationId,record.accountId,record.licenseId,record.activatedAt,record.activatedAt).run();}
  async findInstallation(id){
    const row=await this.db.prepare(`SELECT i.installation_id,i.license_id,i.activated_at,a.email_normalized AS account_email,l.status,l.expires_at
      FROM installations i JOIN accounts a ON a.id=i.account_id JOIN licenses l ON l.id=i.license_id WHERE i.installation_id=? LIMIT 1`).bind(id).first();
    return row?{installationId:row.installation_id,licenseId:row.license_id,activatedAt:row.activated_at,accountEmail:row.account_email,status:row.status,expiresAt:row.expires_at||null}:null;
  }
  async logEmail(record){await this.db.prepare(`INSERT INTO email_delivery_log(id,account_id,email_normalized,template,status,error,created_at) VALUES(?,?,?,?,?,?,?)`).bind(record.id,record.accountId||null,record.email,record.template,record.status,record.error||null,record.createdAt).run();}
}

function resolveStore(env){return env.ACCOUNT_STORE||new D1AccountStore(env.DB);}
function activeInstallation(record,now){if(!record)return false;if(record.status&&record.status!=='ACTIVE')return false;if(record.expiresAt&&record.expiresAt<=now)return false;return true;}
function recoveryPepper(env){return String(env.RECOVERY_PEPPER||env.ACTIVATION_PEPPER||'').trim();}

async function requestActivation(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);
  if(!email||!installationId)return json({error:'Dados de ativacao invalidos.'},400);
  const store=resolveStore(env);const license=await store.findActiveLicense(email);if(!license)return json({accepted:true},202);
  const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'Servico de ativacao indisponivel.'},503);
  const from=normalizeEmail(env.EMAIL_FROM);if(!from)return json({error:'Servico de ativacao indisponivel.'},503);
  const code=randomCode();const tokenDigest=await digestToken({pepper,email,code});const createdAt=new Date().toISOString();const expiresAt=new Date(Date.now()+TOKEN_TTL_MS).toISOString();
  await store.saveActivationToken({id:newId('token'),accountId:license.accountId||null,licenseId:license.id,installationId,email,tokenDigest,createdAt,expiresAt});
  const delivery={id:newId('email'),accountId:license.accountId||null,email,template:'activation-code',createdAt};
  try{
    if(!env.EMAIL?.send)throw new Error('EMAIL binding ausente.');
    await env.EMAIL.send({to:email,from,subject:'Código de ativação ArtiSys',text:`Seu código de ativação ArtiSys é ${code}. Ele expira em 10 minutos.`});
    await store.logEmail({...delivery,status:'SENT'});
  }catch(error){await store.logEmail({...delivery,status:'FAILED',error:String(error?.message||error).slice(0,240)});return json({error:'Falha ao enviar codigo de ativacao.'},503);}
  return json({accepted:true},202);
}

async function verifyActivation(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);const code=String(body.code||'').trim();
  if(!email||!installationId||!/^\d{6}$/.test(code))return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'Servico de ativacao indisponivel.'},503);
  const store=resolveStore(env);const now=new Date().toISOString();const digest=await digestToken({pepper,email,code});const token=await store.findActivationToken({email,digest,now});
  if(!token||(token.installationId!=='PENDING'&&token.installationId!==installationId))return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  const license=await store.findActiveLicense(email);if(!license||license.id!==token.licenseId)return json({error:'Licenca indisponivel para ativacao.'},409);
  await store.consumeActivationToken(token.id,now);
  await store.saveInstallation({installationId,accountId:token.accountId||license.accountId||null,licenseId:license.id,accountEmail:email,status:'ACTIVE',activatedAt:now});
  return json({licenseId:license.id,accountEmail:email,activatedAt:now});
}

async function requestPasswordRecovery(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);
  if(!email||!installationId)return json({accepted:true},202);
  const record=await resolveStore(env).findInstallation(installationId);const now=new Date().toISOString();
  if(!activeInstallation(record,now)||normalizeEmail(record.accountEmail)!==email)return json({accepted:true},202);
  return json({accepted:true,message:'Solicite o codigo de recuperacao ao administrador ArtiSys.'},202);
}

async function verifyPasswordRecovery(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);const code=String(body.code||'').trim();
  if(!email||!installationId||!/^[0-9]{6}$/.test(code))return json({error:'Codigo de recuperacao invalido ou expirado.'},400);
  const pepper=recoveryPepper(env);if(!pepper)return json({error:'Servico de recuperacao indisponivel.'},503);
  const store=resolveStore(env);const now=new Date().toISOString();const digest=await digestToken({pepper,email,code});
  const token=await store.findRecoveryToken({email,installationId,digest,now});
  if(!token){return json({error:'Codigo de recuperacao invalido ou expirado.'},400);}
  await store.consumeRecoveryToken(token.id,now);
  return json({verified:true,accountEmail:email,installationId});
}

function adminAuthorized(request,env){const expected=String(env.ADMIN_TOKEN||'').trim();const provided=String(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();return Boolean(expected)&&provided===expected;}
function adminHtml(){return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ArtiSys Licencas</title><style>body{font:15px system-ui;background:#f5f6f8;color:#18181b;margin:0}.wrap{max-width:980px;margin:32px auto;padding:0 16px}.card{background:white;border:1px solid #ddd;border-radius:14px;padding:20px;margin:16px 0}input,select,button{padding:10px;border:1px solid #bbb;border-radius:8px;margin:4px}button{cursor:pointer;font-weight:600}.code{font-size:32px;letter-spacing:6px;font-weight:800}table{width:100%;border-collapse:collapse}td,th{padding:9px;border-bottom:1px solid #eee;text-align:left}.muted{color:#666}</style><div class="wrap"><h1>Painel de Licencas ArtiSys</h1><div class="card"><label>Token administrativo <input id="token" type="password"></label><button onclick="load()">Entrar</button></div><div class="card"><h2>Liberar licenca</h2><input id="email" type="email" placeholder="cliente@empresa.com"><input id="expires" type="date"><button onclick="release()">Liberar</button><div id="released"></div></div><div class="card"><h2>Licencas</h2><div id="list" class="muted">Informe o token.</div></div></div><script>const h=()=>({'content-type':'application/json','authorization':'Bearer '+document.querySelector('#token').value});async function api(p,o={}){const r=await fetch(p,{...o,headers:{...h(),...(o.headers||{})}});const j=await r.json();if(!r.ok)throw Error(j.error||'Falha');return j}async function load(){try{const j=await api('/v1/admin/licenses');document.querySelector('#list').innerHTML='<table><tr><th>E-mail</th><th>Status</th><th>Instalacao</th><th>Acoes</th></tr>'+j.licenses.map(x=>'<tr><td>'+x.email+'</td><td>'+x.status+'</td><td>'+(x.installation_id||'-')+'</td><td><button onclick="recovery(\''+(x.installation_id||'')+'\',\''+x.email+'\')">Recuperacao</button><button onclick="status(\''+x.id+'\',\'SUSPENDED\')">Suspender</button><button onclick="status(\''+x.id+'\',\'CANCELLED\')">Cancelar</button></td></tr>').join('')+'</table>'}catch(e){alert(e.message)}}async function release(){try{const email=document.querySelector('#email').value,expiresAt=document.querySelector('#expires').value||null;const j=await api('/v1/admin/licenses',{method:'POST',body:JSON.stringify({email,expiresAt})});document.querySelector('#released').innerHTML='<p>Codigo de ativacao:</p><div class="code">'+j.code+'</div><p>Valido ate '+j.codeExpiresAt+'</p>';load()}catch(e){alert(e.message)}}async function recovery(installationId,email){if(!installationId)return alert('Licenca ainda nao possui instalacao ativada.');try{const j=await api('/v1/admin/recovery',{method:'POST',body:JSON.stringify({installationId,email})});alert('Codigo de recuperacao: '+j.code+' (15 min)')}catch(e){alert(e.message)}}async function status(id,status){try{await api('/v1/admin/licenses/'+encodeURIComponent(id),{method:'PATCH',body:JSON.stringify({status})});load()}catch(e){alert(e.message)}}</script></html>`;}
async function adminRoute(request,env,url){
  if(request.method==='GET'&&url.pathname==='/admin')return new Response(adminHtml(),{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
  if(!url.pathname.startsWith('/v1/admin/'))return null;
  if(!adminAuthorized(request,env))return json({error:'Nao autorizado.'},401);
  const store=resolveStore(env);
  if(request.method==='GET'&&url.pathname==='/v1/admin/licenses')return json({licenses:await store.listLicenses()});
  if(request.method==='POST'&&url.pathname==='/v1/admin/licenses'){
    const body=await readBody(request),email=normalizeEmail(body.email);if(!email)return json({error:'E-mail invalido.'},400);
    const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'ACTIVATION_PEPPER ausente.'},503);
    let expiresAt=null;if(body.expiresAt){const d=new Date(body.expiresAt+'T23:59:59.999Z');if(Number.isNaN(d.getTime()))return json({error:'Validade invalida.'},400);expiresAt=d.toISOString();}
    const code=randomCode(),createdAt=new Date().toISOString(),codeExpiresAt=new Date(Date.now()+ADMIN_ACTIVATION_TTL_MS).toISOString(),codeDigest=await digestToken({pepper,email,code});
    const provisioned=await store.provisionLicense({email,expiresAt,codeDigest,codeExpiresAt,createdAt});return json({...provisioned,email,code,codeExpiresAt,expiresAt},201);
  }
  if(request.method==='PATCH'&&url.pathname.startsWith('/v1/admin/licenses/')){const id=decodeURIComponent(url.pathname.slice('/v1/admin/licenses/'.length));const body=await readBody(request),status=String(body.status||'').toUpperCase();if(!['ACTIVE','SUSPENDED','CANCELLED','EXPIRED'].includes(status))return json({error:'Status invalido.'},400);await store.setLicenseStatus(id,status);return json({updated:true,id,status});}
  if(request.method==='POST'&&url.pathname==='/v1/admin/recovery'){
    const body=await readBody(request),email=normalizeEmail(body.email),installationId=normalizeInstallationId(body.installationId);if(!email||!installationId)return json({error:'E-mail ou instalacao invalidos.'},400);
    const pepper=recoveryPepper(env);if(!pepper)return json({error:'RECOVERY_PEPPER ausente.'},503);
    const code=randomCode(),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+RECOVERY_TTL_MS).toISOString(),codeDigest=await digestToken({pepper,email,code});
    const result=await store.createRecoveryForInstallation({installationId,email,codeDigest,createdAt,expiresAt});if(!result)return json({error:'Instalacao ativa nao encontrada para este e-mail.'},404);return json({email,installationId,code,expiresAt},201);
  }
  return json({error:'Rota administrativa nao encontrada.'},404);
}

async function licenseStatus(url,env){
  const installationId=normalizeInstallationId(url.searchParams.get('installationId'));if(!installationId)return json({error:'Instalacao invalida.'},400);
  const record=await resolveStore(env).findInstallation(installationId);const now=new Date().toISOString();
  return json({active:activeInstallation(record,now),installationId,licenseId:record?.licenseId||null,accountEmail:record?.accountEmail||null,activatedAt:record?.activatedAt||null});
}

export async function handleRequest(request,env={}){
  const url=new URL(request.url);try{
    const adminResponse=await adminRoute(request,env,url);if(adminResponse)return adminResponse;
    if(request.method==='GET'&&url.pathname==='/health')return json({ok:true,service:'artisys-account'});
    if(request.method==='POST'&&url.pathname==='/v1/activation/request')return await requestActivation(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/activation/verify')return await verifyActivation(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/password-recovery/request')return await requestPasswordRecovery(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/password-recovery/verify')return await verifyPasswordRecovery(request,env);
    if(request.method==='GET'&&url.pathname==='/v1/license/status')return await licenseStatus(url,env);
    return json({error:'Rota nao encontrada.'},404);
  }catch(error){return json({error:error?.message||'Falha interna.'},Number(error?.statusCode)||500);}
}

export default {fetch:handleRequest};
export {D1AccountStore,digestToken,normalizeEmail};