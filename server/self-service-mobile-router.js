'use strict';

class SelfServiceHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new SelfServiceHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SelfServiceHttpError(400,'JSON invalido.');}}

function createSelfServiceMobileRouter({runtime}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  function declaredDevice(request){const id=String(request.headers['x-device-id']||'').trim();return id?runtime.mobileDevices.getDevice(id):null;}
  function principal(request){const id=String(request.headers['x-device-id']||'').trim();const key=String(request.headers['x-device-key']||'');const auth=runtime.mobileDevices.authenticate(id,key);if(!auth.ok)throw new SelfServiceHttpError(401,'Dispositivo nao autorizado.');if(auth.device.deviceType!=='SELF_SERVICE')throw new SelfServiceHttpError(403,'Dispositivo sem permissao para autoatendimento.');return{device:auth.device,actor:{userId:null,role:'mobile-self-service',terminalId:null}};}
  async function mutate(request,pathname,statusCode,handler){const mutationId=String(request.headers['x-mutation-id']||'').trim();if(!mutationId||!runtime.mutations)return{statusCode,payload:await handler(mutationId||null)};return runtime.mutations.execute({mutationId,method:request.method,path:pathname},async()=>({statusCode,payload:await handler(mutationId)}));}
  return async function selfServiceMobileRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    const explicit=pathname.startsWith('/api/v1/mobile/self-service/');
    const contextPath=request.method==='GET'&&pathname==='/api/v1/mobile/context';
    if(!explicit&&!contextPath)return false;
    if(contextPath){const declared=declaredDevice(request);if(!declared||declared.deviceType!=='SELF_SERVICE')return false;}
    try{
      const p=principal(request);
      if(contextPath){json(response,200,runtime.selfService.context(p.device.id));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/mobile/self-service/orders'){
        const data=await body(request);const result=await mutate(request,pathname,201,async mutationId=>{const order=runtime.selfService.submitOrder(p.device.id,data,p.actor,mutationId);const dispatch=await runtime.dispatchPending();return{order,dispatch};});json(response,result.statusCode,result.payload);return true;
      }
      throw new SelfServiceHttpError(404,'Rota de autoatendimento nao encontrada.');
    }catch(error){const status=error.statusCode||(error.code==='MODULE_DISABLED'?409:400);json(response,status,{error:error.message||'Erro interno.',code:error.code||undefined});return true;}
  };
}

module.exports={createSelfServiceMobileRouter,SelfServiceHttpError};
