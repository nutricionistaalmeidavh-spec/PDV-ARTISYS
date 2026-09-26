const TOKEN_TTL_MS=10*60*1000;

function json(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}});}
function normalizeEmail(value){const email=String(value||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:null;}
function normalizeInstallationId(value){const id=String(value||'').trim();return /^[A-Za-z0-9._:-]{8,128}$/.test(id)?id:null;}
function newId(prefix){return `${prefix}-${crypto.randomUUID()}`;}
function randomCode(){const bytes=new Uint32Array(1);crypto.getRandomValues(bytes);return String(bytes[0]%1000000).padStart(6,'0');}
async function digestToken({pepper,email,code}){const data=new TextEncoder().encode(`${pepper}:${email}:${code}`);const hash=await crypto.subtle.digest('SHA-256',data);return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');}
async function readBody(request){const text=await request.text();if(text.length>32768)throw Object.assign(new Error('Corpo da requisicao excede o limite permitido.'),{statusCode:413});if(!text)return{};try{return JSON.parse(text);}catch{throw Object.assign(new Error('JSON invalido.'),{statusCode:400});}}

class D1AccountStore{
  constructor(db){if(!db)throw new Error('D1 DB binding ausente.');this.db=db;}
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
  async consumeActivationToken(id,usedAt){await this.db.prepare('UPDATE activation_tokens SET used_at=? WHERE id=? AND used_at IS NULL').bind(usedAt,id).run();}
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

async function requestActivation(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);
  if(!email||!installationId)return json({error:'Dados de ativacao invalidos.'},400);
  const store=resolveStore(env);const license=await store.findActiveLicense(email);if(!license)return json({accepted:true},202);
  const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'Servico de ativacao indisponivel.'},503);
  const code=randomCode();const tokenDigest=await digestToken({pepper,email,code});const createdAt=new Date().toISOString();const expiresAt=new Date(Date.now()+TOKEN_TTL_MS).toISOString();
  await store.saveActivationToken({id:newId('token'),accountId:license.accountId||null,licenseId:license.id,installationId,email,tokenDigest,createdAt,expiresAt});
  const delivery={id:newId('email'),accountId:license.accountId||null,email,template:'activation-code',createdAt};
  try{
    if(!env.EMAIL?.send)throw new Error('EMAIL binding ausente.');
    await env.EMAIL.send({to:email,subject:'Código de ativação ArtiSys',text:`Seu código de ativação ArtiSys é ${code}. Ele expira em 10 minutos.`,code});
    await store.logEmail({...delivery,status:'SENT'});
  }catch(error){await store.logEmail({...delivery,status:'FAILED',error:String(error?.message||error).slice(0,240)});return json({error:'Falha ao enviar codigo de ativacao.'},503);}
  return json({accepted:true},202);
}

async function verifyActivation(request,env){
  const body=await readBody(request);const email=normalizeEmail(body.email);const installationId=normalizeInstallationId(body.installationId);const code=String(body.code||'').trim();
  if(!email||!installationId||!/^\d{6}$/.test(code))return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  const pepper=String(env.ACTIVATION_PEPPER||'').trim();if(!pepper)return json({error:'Servico de ativacao indisponivel.'},503);
  const store=resolveStore(env);const now=new Date().toISOString();const digest=await digestToken({pepper,email,code});const token=await store.findActivationToken({email,digest,now});
  if(!token||token.installationId!==installationId)return json({error:'Codigo de ativacao invalido ou expirado.'},400);
  const license=await store.findActiveLicense(email);if(!license||license.id!==token.licenseId)return json({error:'Licenca indisponivel para ativacao.'},409);
  await store.consumeActivationToken(token.id,now);
  await store.saveInstallation({installationId,accountId:token.accountId||license.accountId||null,licenseId:license.id,accountEmail:email,status:'ACTIVE',activatedAt:now});
  return json({licenseId:license.id,accountEmail:email,activatedAt:now});
}

async function licenseStatus(url,env){
  const installationId=normalizeInstallationId(url.searchParams.get('installationId'));if(!installationId)return json({error:'Instalacao invalida.'},400);
  const record=await resolveStore(env).findInstallation(installationId);const now=new Date().toISOString();
  return json({active:activeInstallation(record,now),installationId,licenseId:record?.licenseId||null,accountEmail:record?.accountEmail||null,activatedAt:record?.activatedAt||null});
}

export async function handleRequest(request,env={}){
  const url=new URL(request.url);try{
    if(request.method==='GET'&&url.pathname==='/health')return json({ok:true,service:'artisys-account'});
    if(request.method==='POST'&&url.pathname==='/v1/activation/request')return await requestActivation(request,env);
    if(request.method==='POST'&&url.pathname==='/v1/activation/verify')return await verifyActivation(request,env);
    if(request.method==='GET'&&url.pathname==='/v1/license/status')return await licenseStatus(url,env);
    return json({error:'Rota nao encontrada.'},404);
  }catch(error){return json({error:error?.message||'Falha interna.'},Number(error?.statusCode)||500);}
}

export default {fetch:handleRequest};
export {D1AccountStore,digestToken,normalizeEmail};
