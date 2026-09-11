'use strict';

class FinalVerticalHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new FinalVerticalHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new FinalVerticalHttpError(400,'JSON invalido.');}}

function createE48E54Router({runtime,installationToken='',requireTerminalAuth=false}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  function principal(request){
    if(requireTerminalAuth){const id=String(request.headers['x-terminal-id']||'').trim();const key=String(request.headers['x-terminal-key']||'');const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new FinalVerticalHttpError(401,'Terminal nao autorizado.');return{actor:{userId:null,role:'terminal',terminalId:id},terminalId:id};}
    if(installationToken&&request.headers['x-pdv-token']!==installationToken)throw new FinalVerticalHttpError(401,'Token local invalido.');
    return{actor:{userId:null,role:'system',terminalId:null},terminalId:null};
  }
  async function mutate(request,pathname,statusCode,handler){const mutationId=String(request.headers['x-mutation-id']||'').trim();if(!mutationId||!runtime.mutations)return{statusCode,payload:await handler(mutationId||null)};return runtime.mutations.execute({mutationId,method:request.method,path:pathname},async()=>({statusCode,payload:await handler(mutationId)}));}

  return async function e48e54Router(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    const prefixes=['/api/v1/vertical/retail','/api/v1/vertical/services','/api/v1/vertical/workshop','/api/v1/vertical/self-service','/api/v1/vertical/onboarding','/api/v1/vertical/mobile-access','/api/v1/vertical/hardware-compatibility'];
    if(!prefixes.some(prefix=>pathname.startsWith(prefix)))return false;
    try{
      const p=principal(request);const actor=p.actor;
      if(request.method==='GET'&&pathname==='/api/v1/vertical/retail/variants'){json(response,200,runtime.retail.searchVariants(url.searchParams.get('query')||''));return true;}
      const retailStock=pathname.match(/^\/api\/v1\/vertical\/retail\/variants\/([^/]+)\/stock$/);
      if(request.method==='GET'&&retailStock){json(response,200,runtime.retail.getVariantStock(decodeURIComponent(retailStock[1])));return true;}
      if(request.method==='PUT'&&retailStock){const data=await body(request);json(response,200,runtime.retail.setVariantStock(decodeURIComponent(retailStock[1]),data.quantity,actor));return true;}
      const retailSale=pathname.match(/^\/api\/v1\/vertical\/retail\/sales\/([^/]+)\/variant$/);
      if(request.method==='POST'&&retailSale){json(response,200,runtime.retail.addVariantToSale(decodeURIComponent(retailSale[1]),await body(request),actor));return true;}

      if(request.method==='POST'&&pathname==='/api/v1/vertical/services/catalog'){json(response,201,runtime.services.upsertService(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/services/professionals'){json(response,201,runtime.services.upsertProfessional(await body(request),actor));return true;}
      const link=pathname.match(/^\/api\/v1\/vertical\/services\/catalog\/([^/]+)\/professionals\/([^/]+)$/);
      if(request.method==='PUT'&&link){json(response,200,runtime.services.linkProfessional(decodeURIComponent(link[1]),decodeURIComponent(link[2]),await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/services/appointments'){const result=await mutate(request,pathname,201,()=>runtime.services.scheduleAppointment(await body(request),actor));json(response,result.statusCode,result.payload);return true;}
      const appointmentStatus=pathname.match(/^\/api\/v1\/vertical\/services\/appointments\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&appointmentStatus){const data=await body(request);json(response,200,runtime.services.updateAppointmentStatus(decodeURIComponent(appointmentStatus[1]),data.status,actor));return true;}
      const appointmentSale=pathname.match(/^\/api\/v1\/vertical\/services\/appointments\/([^/]+)\/sale$/);
      if(request.method==='POST'&&appointmentSale){const data=await body(request);json(response,201,runtime.services.createSale(decodeURIComponent(appointmentSale[1]),{...data,terminalId:data.terminalId||p.terminalId},actor));return true;}
      if(request.method==='GET'&&pathname==='/api/v1/vertical/services/commissions'){json(response,200,runtime.services.commissionReport({from:url.searchParams.get('from')||null,to:url.searchParams.get('to')||null,professionalId:url.searchParams.get('professionalId')||null}));return true;}

      if(request.method==='POST'&&pathname==='/api/v1/vertical/workshop/assets'){json(response,201,runtime.workshop.upsertAsset(await body(request),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/workshop/orders'){const result=await mutate(request,pathname,201,()=>runtime.workshop.openWorkOrder(await body(request),actor));json(response,result.statusCode,result.payload);return true;}
      const workOrder=pathname.match(/^\/api\/v1\/vertical\/workshop\/orders\/([^/]+)$/);
      if(request.method==='GET'&&workOrder){json(response,200,runtime.workshop.getWorkOrder(decodeURIComponent(workOrder[1])));return true;}
      const workItems=pathname.match(/^\/api\/v1\/vertical\/workshop\/orders\/([^/]+)\/items$/);
      if(request.method==='POST'&&workItems){json(response,201,runtime.workshop.addItem(decodeURIComponent(workItems[1]),await body(request),actor));return true;}
      const workStatus=pathname.match(/^\/api\/v1\/vertical\/workshop\/orders\/([^/]+)\/status$/);
      if(request.method==='PATCH'&&workStatus){const data=await body(request);json(response,200,runtime.workshop.updateStatus(decodeURIComponent(workStatus[1]),data.status,data,actor));return true;}
      const workCancel=pathname.match(/^\/api\/v1\/vertical\/workshop\/orders\/([^/]+)\/cancel$/);
      if(request.method==='POST'&&workCancel){const data=await body(request);json(response,200,runtime.workshop.cancel(decodeURIComponent(workCancel[1]),data.reason,actor));return true;}
      const workSale=pathname.match(/^\/api\/v1\/vertical\/workshop\/orders\/([^/]+)\/sale$/);
      if(request.method==='POST'&&workSale){const data=await body(request);json(response,201,runtime.workshop.createSale(decodeURIComponent(workSale[1]),{...data,terminalId:data.terminalId||p.terminalId},actor));return true;}

      const selfConfig=pathname.match(/^\/api\/v1\/vertical\/self-service\/devices\/([^/]+)$/);
      if(request.method==='PUT'&&selfConfig){json(response,200,runtime.selfService.configureDevice(decodeURIComponent(selfConfig[1]),await body(request),actor));return true;}
      if(request.method==='GET'&&selfConfig){json(response,200,runtime.selfService.context(decodeURIComponent(selfConfig[1])));return true;}

      if(request.method==='GET'&&pathname==='/api/v1/vertical/onboarding'){json(response,200,runtime.onboarding.getState());return true;}
      if(request.method==='GET'&&pathname==='/api/v1/vertical/onboarding/recommend'){json(response,200,runtime.onboarding.recommend(url.searchParams.get('segment')||'GENERIC'));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/onboarding/complete'){json(response,200,runtime.onboarding.complete(await body(request),actor));return true;}

      if(request.method==='GET'&&pathname==='/api/v1/vertical/mobile-access'){
        const host=url.searchParams.get('host')||String(request.headers.host||'127.0.0.1').split(':')[0];const port=Number(url.searchParams.get('port')||String(request.headers.host||'').split(':')[1]||4174);json(response,200,runtime.mobileAccess.getLanAccess({host,port,path:url.searchParams.get('path')||'/mobile'}));return true;
      }

      if(request.method==='GET'&&pathname==='/api/v1/vertical/hardware-compatibility'){json(response,200,runtime.hardwareCompatibility.listEvidence({status:url.searchParams.get('status')||null,kind:url.searchParams.get('kind')||null}));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/vertical/hardware-compatibility'){json(response,201,runtime.hardwareCompatibility.recordEvidence(await body(request),actor));return true;}

      throw new FinalVerticalHttpError(404,'Rota E48-E54 nao encontrada.');
    }catch(error){const status=error.statusCode||(error.code==='MODULE_DISABLED'?409:/UNIQUE constraint failed/.test(error.message||'')?409:400);try{runtime.logger?.log({level:status>=500?'error':'warn',subsystem:'e48-e54-http',message:error.message||'Erro interno.',context:{method:request.method,path:pathname,status}});}catch{}json(response,status,{error:error.message||'Erro interno.',code:error.code||undefined});return true;}
  };
}

module.exports={createE48E54Router,FinalVerticalHttpError};
