'use strict';

const { writeAudit }=require('../js/core/audit-log');
const { normalizeEmail }=require('../js/core/account/account-activation');

const GENERIC_MESSAGE='Se este e-mail estiver cadastrado, enviaremos um codigo de recuperacao.';

function sendJson(response,statusCode,payload){
  response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  response.end(JSON.stringify(payload));
}

async function readJson(request,limit=1024*1024){
  let size=0;const chunks=[];
  for await(const chunk of request){
    size+=chunk.length;
    if(size>limit){const error=new Error('Corpo da requisicao excede o limite permitido.');error.statusCode=413;throw error;}
    chunks.push(chunk);
  }
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch{const error=new Error('JSON invalido.');error.statusCode=400;throw error;}
}

function createPasswordRecoveryRouter({runtime,sessionStore=new Map(),bodyLimitBytes=1024*1024}={}){
  if(!runtime)throw new TypeError('runtime is required.');

  function accountConfigured(){return Boolean(runtime.account?.status?.().configured);}

  function localUserByEmail(email){
    return runtime.db.prepare('SELECT * FROM users WHERE email_normalized=? AND active=1 LIMIT 1').get(email)||null;
  }

  function revokeUserSessions(userId){
    for(const [token,session] of sessionStore.entries()){
      if(String(session?.userId||'')===String(userId))sessionStore.delete(token);
    }
  }

  return async function passwordRecoveryRoute(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);
    const pathname=url.pathname;
    if(!pathname.startsWith('/api/v1/auth/password-recovery/'))return false;

    try{
      if(request.method==='POST'&&pathname==='/api/v1/auth/password-recovery/request'){
        if(!accountConfigured()){sendJson(response,409,{error:'Recuperacao por e-mail nao configurada.'});return true;}
        const body=await readJson(request,bodyLimitBytes);
        const email=normalizeEmail(body.email);
        if(!email||!/^\S+@\S+\.\S+$/.test(email)){sendJson(response,400,{error:'E-mail invalido.'});return true;}
        await runtime.account.requestPasswordRecovery(email);
        sendJson(response,202,{accepted:true,message:GENERIC_MESSAGE});return true;
      }

      if(request.method==='POST'&&pathname==='/api/v1/auth/password-recovery/confirm'){
        if(!accountConfigured()){sendJson(response,409,{error:'Recuperacao por e-mail nao configurada.'});return true;}
        const body=await readJson(request,bodyLimitBytes);
        const email=normalizeEmail(body.email);
        const code=String(body.code||'').trim();
        const password=String(body.password||'');
        if(!email||!code){sendJson(response,400,{error:'E-mail e codigo sao obrigatorios.'});return true;}
        if(password.length<10){sendJson(response,400,{error:'Senha deve possuir pelo menos 10 caracteres.'});return true;}

        const verified=await runtime.account.verifyPasswordRecovery({email,code});
        if(!verified?.verified||normalizeEmail(verified.accountEmail)!==email){sendJson(response,400,{error:'Codigo de recuperacao invalido ou expirado.'});return true;}
        const user=localUserByEmail(email);
        if(!user){sendJson(response,400,{error:'Codigo de recuperacao invalido ou expirado.'});return true;}

        runtime.catalog.upsertUser({
          id:user.id,
          username:user.username,
          name:user.name,
          role:user.role,
          email:user.email,
          active:Boolean(user.active),
          password
        },{userId:'password-recovery',role:'system',terminalId:null});
        writeAudit(runtime.db,{
          action:'user.password.reset',entity:'user',entityId:user.id,
          actor:{userId:'password-recovery',role:'system'},context:{method:'email-code'}
        });
        revokeUserSessions(user.id);
        sendJson(response,200,{reset:true});return true;
      }

      sendJson(response,405,{error:'Metodo nao permitido.'});return true;
    }catch(error){
      const message=String(error?.message||'Falha na recuperacao de senha.');
      const status=/indisponivel/i.test(message)?503:(Number(error?.statusCode)||400);
      sendJson(response,status,{error:message});return true;
    }
  };
}

module.exports={createPasswordRecoveryRouter,GENERIC_MESSAGE};