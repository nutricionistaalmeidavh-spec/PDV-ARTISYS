'use strict';

class FinalVerticalHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new FinalVerticalHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new FinalVerticalHttpError(400,'JSON invalido.');}}
function bearer(request){const value=String(request.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}

function createE48E54Router({runtime,installationToken='',requireTerminalAuth=false,sessionStore=null}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  const sessions=sessionStore||null;
  function principal(request){
    if(sessions){
      const token=bearer(request);const session=sessions.get(token);
      if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new FinalVerticalHttpError(401,'Sessao invalida ou expirada.');}
      if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new FinalVerticalHttpError(401,'Terminal nao autorizado.');}
      return{actor:{kind:'human',userId:session.userId,terminalId:session.terminalId||null},terminalId:session.terminalId||null};
    }
    if(requireTerminalAuth){const id=String(request.headers['x-terminal-id']||'').trim();const key=String(request.headers['x-terminal-key']||'');const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new FinalVerticalHttpError(401,'Terminal nao autorizado.');return{actor:{kind:'device',id,surface:'terminal',userId:null,terminalId:id},terminalId:id};}
    if(installationToken&&request.headers['x-pdv-token']!==installationToken)throw new FinalVerticalHttpError(401,'Token local invalido.');
    return{actor:{kind:'system',id:'system',terminalId:null},terminalId:null};
  }
  async function mutate(request,pathname,statusCode,handler){const mutationId=String(request.headers['x-mutation-id']||'').trim();if(!mutationId||!runtime.mutations)return{statusCode,payload:await handler(mutationId||null)};return runtime.mutations.execute({mutationId,method:request.method,path:pathname},async()=>({statusCode,payload:await handler(mutationId)}));}
  function tableAccess(request,url,tableId,{rotate=false,input={}}={}){const p=principal(request);const ordering=runtime.publicOrdering;const access=rotate?ordering.rotateTableAccess(tableId,p.actor):ordering.issueTableAccess(tableId,p.actor);const host=String(input.host||url.searchParams.get('host')||String(request.headers.host||'127.0.0.1').split(':')[0]).trim();const port=Number(input.port||url.searchParams.get('port')||String(request.headers.host||'').split(':')[1]||4174);const lan=runtime.mobileAccess.getLanAccess({host,port,protocol:input.protocol||url.searchParams.get('protocol')||'http:',path:`/m/${access.token}`});return{tableId:access.tableId,url:lan.url,qrSvg:lan.qrSvg,security:lan.security,warning:lan.warning};}

  return async function e48e54Router(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    const prefixes=['/api/v1/vertical/retail','/api/v1/vertical/self-service','/api/v1/vertical/onboarding','/api/v1/vertical/mobile-access','/api/v1/vertical/hardware-compatibility'];
    if(!prefixes.some(prefix=>pathname.startsWith(prefix)))return false;
    try{
      const p=principal(request);const actor=p.actor;
      if(request.method==='GET'&&pathname==='/api/v1/vertical/retail/variants'){json(response,200,runtime.retail.searchVariants(url.searchParams.get('query')||''));return true;}
      const retailStock=pathname.match(/^\/api\/v1\/vertical\/retail\/variants\/([^/]+)\/stock$/);
      if(request.method==='GET'&&retailStock){json(response,200,runtime.retail.getVariantStock(decodeURIComponent(retailStock[1])));return true;}
      if(request.method==='PUT'&&retailStock){const data=await body(request);json(response,200,runtime.retail.setVariantStock(decodeURIComponent(retailStock[1]),data.quantity,actor));return true;}
      const retailSale=pathname.match(/^\/api\/v1\/vertical\/retail\/sales\/([^/]+)\/variant$/);
      if(request.method==='POST'&&retailSale){json(response,200,runtime.retail.addVariantToSale(decodeURIComponent(retailSale[1]),await body(request),actor));return true;}

      if(request.method==='POST'&&pathname==='/api/v1/vertical/self-service/devices'){json(response,201,runtime.selfService.createConfiguredDevice(await body(request),actor));return true;}
      if(request.method==='GET'&&pathname==='/api/v1/vertical/self-service/devices'){json(response,200,runtime.selfService.listConfiguredDevices());return true;}
      const selfConfig=pathname.match(/^\/api\/v1\/vertical\/self-service\/devices\/([^/]+)$/);
      if(request.method==='PUT'&&selfConfig){json(response,200,runtime.selfService.configureDevice(decodeURIComponent(selfConfig[1]),await body(request),actor));return true;}
      if(request.method==='GET'&&selfConfig){json(response,200,runtime.selfService.context(decodeURIComponent(selfConfig[1])));return true;}
      if(request.method==='GET'&&pathname==='/api/v1/vertical/self-service/public-ordering/config'){json(response,200,runtime.publicOrdering.getConfig());return true;}
      if(request.method==='PUT'&&pathname==='/api/v1/vertical/self-service/public-ordering/config'){json(response,200,runtime.publicOrdering.updateConfig(await body(request),actor));return true;}
      if(request.method==='GET'&&pathname==='/api/v1/vertical/self-service/public-ordering/menu'){json(response,200,runtime.publicOrdering.listMenu({includeHidden:true}));return true;}
      const publicMenuProduct=pathname.match(/^\/api\/v1\/vertical\/self-service\/public-ordering\/menu\/([^/]+)$/);
      if(request.method==='PATCH'&&publicMenuProduct){json(response,200,runtime.publicOrdering.updateMenuProduct(decodeURIComponent(publicMenuProduct[1]),await body(request),actor));return true;}
      const publicTableQr=pathname.match(/^\/api\/v1\/vertical\/self-service\/public-ordering\/tables\/([^/]+)\/qr$/);
      if(request.method==='GET'&&publicTableQr){json(response,200,tableAccess(request,url,decodeURIComponent(publicTableQr[1])));return true;}
      const publicTableQrRotate=pathname.match(/^\/api\/v1\/vertical\/self-service\/public-ordering\/tables\/([^/]+)\/qr\/rotate$/);
      if(request.method==='POST'&&publicTableQrRotate){json(response,200,tableAccess(request,url,decodeURIComponent(publicTableQrRotate[1]),{rotate:true,input:await body(request)}));return true;}

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
