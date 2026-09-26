'use strict';

function sendJson(response,statusCode,payload){
  response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  response.end(JSON.stringify(payload));
}

async function readJson(request,limit=1024*1024){
  let size=0;const chunks=[];
  for await(const chunk of request){size+=chunk.length;if(size>limit){const error=new Error('Corpo da requisicao excede o limite permitido.');error.statusCode=413;throw error;}chunks.push(chunk);}
  if(!chunks.length)return{};
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{const error=new Error('JSON invalido.');error.statusCode=400;throw error;}
}

function createSetupAccountRouter({runtime,installationToken='',bodyLimitBytes=1024*1024}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  function checkInstallToken(request){if(installationToken&&request.headers['x-pdv-token']!==installationToken){const error=new Error('Token de instalacao invalido.');error.statusCode=401;throw error;}}
  function accountStatus(){return runtime.account?.status?.()||{configured:false,required:false,activated:false,activation:null};}
  return async function setupAccountRoute(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    try{
      if(request.method==='GET'&&pathname==='/api/v1/setup/status'){
        sendJson(response,200,{needsSetup:runtime.catalog.countUsers()===0,activation:accountStatus()});return true;
      }
      if(request.method==='POST'&&pathname==='/api/v1/setup/activation/request'){
        checkInstallToken(request);if(!runtime.account) {sendJson(response,409,{error:'Ativacao comercial nao configurada.'});return true;}
        const body=await readJson(request,bodyLimitBytes);const result=await runtime.account.requestActivation(body.email);sendJson(response,202,result);return true;
      }
      if(request.method==='POST'&&pathname==='/api/v1/setup/activation/verify'){
        checkInstallToken(request);if(!runtime.account) {sendJson(response,409,{error:'Ativacao comercial nao configurada.'});return true;}
        const body=await readJson(request,bodyLimitBytes);const result=await runtime.account.verifyActivation({email:body.email,code:body.code});sendJson(response,200,result);return true;
      }
      if(request.method==='POST'&&pathname==='/api/v1/setup/admin'){
        checkInstallToken(request);
        if(runtime.catalog.countUsers()!==0){sendJson(response,409,{error:'Configuracao inicial ja concluida.'});return true;}
        if(accountStatus().required){sendJson(response,409,{error:'Ativacao comercial pendente para esta nova instalacao.'});return true;}
        const body=await readJson(request,bodyLimitBytes);
        const user=runtime.catalog.createUser({...body,role:'admin',active:true},{userId:'setup',role:'system',terminalId:null});
        sendJson(response,201,user);return true;
      }
      return false;
    }catch(error){sendJson(response,Number(error.statusCode)||400,{error:error.message||'Falha no setup.'});return true;}
  };
}

module.exports={createSetupAccountRouter};
