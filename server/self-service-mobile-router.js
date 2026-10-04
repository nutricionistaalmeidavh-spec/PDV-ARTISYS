'use strict';

const {createPublicOrderingRouter}=require('./public-ordering-router');
const {createMobileAssetsRouter}=require('./mobile-assets-router');

class SelfServiceHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new SelfServiceHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new SelfServiceHttpError(400,'JSON invalido.');}}

function createSelfServiceMobileRouter({runtime}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  const publicOrderingRouter=createPublicOrderingRouter({runtime});
  const mobileAssetsRouter=createMobileAssetsRouter();
  function declaredDevice(request){const id=String(request.headers['x-device-id']||'').trim();return id?runtime.mobileDevices.getDevice(id):null;}
  function principal(request){const id=String(request.headers['x-device-id']||'').trim();const key=String(request.headers['x-device-key']||'');const auth=runtime.deviceAccess?.authenticate?runtime.deviceAccess.authenticate(id,key):runtime.mobileDevices.authenticate(id,key);if(!auth.ok)throw new SelfServiceHttpError(401,'Dispositivo nao autorizado.');if(auth.device.deviceType!=='SELF_SERVICE')throw new SelfServiceHttpError(403,'Dispositivo sem permissao para autoatendimento.');return{device:auth.device,principal:auth.principal||null,scope:auth.scope||auth.device.scope||null,actor:{...(auth.principal||{}),terminalId:null}};}
  async function mutate(request,pathname,statusCode,handler){const mutationId=String(request.headers['x-mutation-id']||'').trim();if(!mutationId||!runtime.mutations)return{statusCode,payload:await handler(mutationId||null)};return runtime.mutations.execute({mutationId,method:request.method,path:pathname},async()=>({statusCode,payload:await handler(mutationId)}));}
  return async function selfServiceMobileRouter(request,response){
    if(await mobileAssetsRouter(request,response))return true;
    if(await publicOrderingRouter(request,response))return true;
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    const explicit=pathname.startsWith('/api/v1/mobile/self-service/');
    const contextPath=request.method==='GET'&&pathname==='/api/v1/mobile/context';
    if(!explicit&&!contextPath)return false;
    if(contextPath){const declared=declaredDevice(request);if(!declared||declared.deviceType!=='SELF_SERVICE')return false;}
    try{
      const p=principal(request);
      if(contextPath){json(response,200,runtime.selfService.context(p.device.id));return true;}
      const photoMatch=pathname.match(/^\/api\/v1\/mobile\/self-service\/products\/([^/]+)\/photo$/);
      if(request.method==='GET'&&photoMatch){
        const productId=decodeURIComponent(photoMatch[1]);
        const product=runtime.publicOrdering.listMenu().find(item=>String(item.id)===String(productId));
        if(!product?.photo)throw new SelfServiceHttpError(404,'Foto nao encontrada.');
        const photo=runtime.productPhotos.read(productId,'thumbnail');const etag=`"${photo.sha256}"`;
        if(request.headers['if-none-match']===etag){response.writeHead(304,{etag,'cache-control':'private, max-age=86400'});response.end();return true;}
        response.writeHead(200,{'content-type':photo.mimeType,'content-length':photo.bytes.length,'cache-control':'private, max-age=86400',etag});response.end(photo.bytes);return true;
      }
      if(request.method==='POST'&&pathname==='/api/v1/mobile/self-service/orders'){
        const data=await body(request);const result=await mutate(request,pathname,201,async mutationId=>{const order=runtime.selfService.submitOrder(p.device.id,data,p.actor,mutationId);const dispatch=await runtime.dispatchPending();return{order,dispatch};});json(response,result.statusCode,result.payload);return true;
      }
      if(request.method==='POST'&&pathname==='/api/v1/mobile/self-service/service'){
        const data=await body(request);const result=await mutate(request,pathname,201,mutationId=>runtime.selfService.requestService(p.device.id,data.requestType,p.actor,mutationId));json(response,result.statusCode,result.payload);return true;
      }
      throw new SelfServiceHttpError(404,'Rota de autoatendimento nao encontrada.');
    }catch(error){const status=error.statusCode||(error.code==='MODULE_DISABLED'?409:400);json(response,status,{error:error.message||'Erro interno.',code:error.code||undefined});return true;}
  };
}

module.exports={createSelfServiceMobileRouter,SelfServiceHttpError};
