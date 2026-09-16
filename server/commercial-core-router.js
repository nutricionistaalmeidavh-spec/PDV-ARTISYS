'use strict';

class CommercialCoreHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(response,statusCode,payload){response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});response.end(JSON.stringify(payload));}
async function body(request,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>limit)throw new CommercialCoreHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new CommercialCoreHttpError(400,'JSON invalido.');}}
function filters(url,names){const result={};for(const name of names){const value=url.searchParams.get(name);if(value!==null&&value!=='')result[name]=value;}return result;}

function createCommercialCoreRouter({runtime,installationToken='',requireTerminalAuth=false,bodyLimitBytes=1024*1024}={}){
  if(!runtime)throw new TypeError('runtime is required.');
  const prefixes=['/api/v1/purchase-orders','/api/v1/inventory/lots','/api/v1/pix','/api/v1/credits','/api/v1/reports/advanced','/api/v1/replenishment'];

  function principal(request){
    const suppliedToken=String(request.headers['x-pdv-token']||'');
    if(installationToken&&suppliedToken===installationToken)return{role:'system',userId:'system',terminalId:null};
    if(requireTerminalAuth){const id=String(request.headers['x-terminal-id']||'').trim();const key=String(request.headers['x-terminal-key']||'');const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new CommercialCoreHttpError(401,'Terminal nao autorizado.');return{role:'terminal',userId:null,terminalId:id};}
    if(!installationToken)return{role:'system',userId:'system',terminalId:null};
    throw new CommercialCoreHttpError(401,'Token local invalido.');
  }
  function privileged(actor){if(actor.role!=='system')throw new CommercialCoreHttpError(403,'Operacao gerencial requer o servidor principal/credencial da instalacao.');}

  return async function commercialCoreRouter(request,response){
    const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
    if(!prefixes.some(prefix=>pathname.startsWith(prefix)))return false;
    try{
      const actor=principal(request);

      if(request.method==='GET'&&pathname==='/api/v1/purchase-orders'){privileged(actor);json(response,200,runtime.purchasing.list(filters(url,['status','supplierId','from','to'])));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/purchase-orders'){privileged(actor);json(response,201,runtime.purchasing.createDraft(await body(request,bodyLimitBytes),actor));return true;}
      const poSubmit=pathname.match(/^\/api\/v1\/purchase-orders\/([^/]+)\/submit$/);if(request.method==='POST'&&poSubmit){privileged(actor);json(response,200,runtime.purchasing.submit(decodeURIComponent(poSubmit[1]),actor));return true;}
      const poReceive=pathname.match(/^\/api\/v1\/purchase-orders\/([^/]+)\/receive$/);if(request.method==='POST'&&poReceive){privileged(actor);json(response,201,runtime.purchasing.receive(decodeURIComponent(poReceive[1]),await body(request,bodyLimitBytes),actor));return true;}
      const poCancel=pathname.match(/^\/api\/v1\/purchase-orders\/([^/]+)\/cancel$/);if(request.method==='POST'&&poCancel){privileged(actor);const data=await body(request,bodyLimitBytes);json(response,200,runtime.purchasing.cancel(decodeURIComponent(poCancel[1]),{reason:data.reason,actor}));return true;}
      const poGet=pathname.match(/^\/api\/v1\/purchase-orders\/([^/]+)$/);if(request.method==='GET'&&poGet){privileged(actor);const order=runtime.purchasing.get(decodeURIComponent(poGet[1]));if(!order)throw new CommercialCoreHttpError(404,'Pedido de compra nao encontrado.');json(response,200,order);return true;}

      if(request.method==='GET'&&pathname==='/api/v1/inventory/lots'){json(response,200,runtime.lots.listLots({...filters(url,['productId','supplierId','expiringBefore']),available:url.searchParams.get('available')==='true'}));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/inventory/lots'){privileged(actor);const data=await body(request,bodyLimitBytes);const product=runtime.catalog.getProduct(data.productId);if(!product)throw new CommercialCoreHttpError(404,'Produto do lote nao encontrado.');if(!product.trackLots)runtime.catalog.upsertProduct({...product,trackLots:true},actor);json(response,201,runtime.lots.createLot(data,actor));return true;}
      const lotMove=pathname.match(/^\/api\/v1\/inventory\/lots\/([^/]+)\/movements$/);if(request.method==='POST'&&lotMove){privileged(actor);const data=await body(request,bodyLimitBytes);const lot=runtime.lots.getLot(decodeURIComponent(lotMove[1]));if(!lot)throw new CommercialCoreHttpError(404,'Lote nao encontrado.');json(response,201,runtime.lots.move({...data,lotId:lot.id,productId:lot.productId},actor));return true;}
      const lotGet=pathname.match(/^\/api\/v1\/inventory\/lots\/([^/]+)$/);if(request.method==='GET'&&lotGet){const lot=runtime.lots.getLot(decodeURIComponent(lotGet[1]));if(!lot)throw new CommercialCoreHttpError(404,'Lote nao encontrado.');json(response,200,lot);return true;}

      if(request.method==='GET'&&pathname==='/api/v1/pix/config'){json(response,200,runtime.pix.getConfiguration());return true;}
      if(request.method==='PUT'&&pathname==='/api/v1/pix/config'){privileged(actor);json(response,200,runtime.pix.saveConfiguration(await body(request,bodyLimitBytes),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/pix/charges'){json(response,201,runtime.pix.createCharge(await body(request,bodyLimitBytes),actor));return true;}
      if(request.method==='GET'&&pathname==='/api/v1/pix/charges'){json(response,200,runtime.pix.listCharges(filters(url,['saleId','status'])));return true;}
      const pixQr=pathname.match(/^\/api\/v1\/pix\/charges\/([^/]+)\/qr$/);if(request.method==='GET'&&pixQr){json(response,200,await runtime.pix.renderQr(decodeURIComponent(pixQr[1])));return true;}
      const pixConfirm=pathname.match(/^\/api\/v1\/pix\/charges\/([^/]+)\/confirm$/);if(request.method==='POST'&&pixConfirm){json(response,200,runtime.pix.confirmCharge(decodeURIComponent(pixConfirm[1]),actor));return true;}
      const pixCancel=pathname.match(/^\/api\/v1\/pix\/charges\/([^/]+)\/cancel$/);if(request.method==='POST'&&pixCancel){const data=await body(request,bodyLimitBytes);json(response,200,runtime.pix.cancelCharge(decodeURIComponent(pixCancel[1]),{reason:data.reason,actor}));return true;}
      const pixGet=pathname.match(/^\/api\/v1\/pix\/charges\/([^/]+)$/);if(request.method==='GET'&&pixGet){const charge=runtime.pix.getCharge(decodeURIComponent(pixGet[1]));if(!charge)throw new CommercialCoreHttpError(404,'Cobranca Pix nao encontrada.');json(response,200,charge);return true;}

      if(request.method==='POST'&&pathname==='/api/v1/credits/customer'){privileged(actor);json(response,201,runtime.credits.issueCustomerCredit(await body(request,bodyLimitBytes),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/credits/gift-cards'){privileged(actor);json(response,201,runtime.credits.createGiftCard(await body(request,bodyLimitBytes),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/credits/redeem'){json(response,200,runtime.credits.redeem(await body(request,bodyLimitBytes),actor));return true;}
      const creditReverse=pathname.match(/^\/api\/v1\/credits\/entries\/([^/]+)\/reverse$/);if(request.method==='POST'&&creditReverse){privileged(actor);const data=await body(request,bodyLimitBytes);json(response,200,runtime.credits.reverse(decodeURIComponent(creditReverse[1]),{reason:data.reason,actor}));return true;}
      const creditLedger=pathname.match(/^\/api\/v1\/credits\/accounts\/([^/]+)\/ledger$/);if(request.method==='GET'&&creditLedger){json(response,200,runtime.credits.listLedger(decodeURIComponent(creditLedger[1])));return true;}
      const creditBalance=pathname.match(/^\/api\/v1\/credits\/accounts\/([^/]+)\/balance$/);if(request.method==='GET'&&creditBalance){const accountId=decodeURIComponent(creditBalance[1]);const account=runtime.credits.getAccount(accountId);if(!account)throw new CommercialCoreHttpError(404,'Conta de credito nao encontrada.');json(response,200,{account,balanceCents:runtime.credits.getBalance(accountId)});return true;}

      if(request.method==='GET'&&pathname==='/api/v1/reports/advanced/sales'){privileged(actor);json(response,200,runtime.reports.buildAdvancedSalesAnalytics(filters(url,['from','to'])));return true;}
      if(request.method==='GET'&&pathname==='/api/v1/reports/advanced/inventory'){privileged(actor);json(response,200,runtime.reports.buildInventoryAnalytics(filters(url,['from','to','asOf'])));return true;}
      if(request.method==='GET'&&pathname==='/api/v1/reports/advanced/purchasing'){privileged(actor);json(response,200,runtime.reports.buildPurchasingAnalytics(filters(url,['from','to'])));return true;}
      const reportCsv=pathname.match(/^\/api\/v1\/reports\/advanced\/(sales|inventory|purchasing)\.csv$/);if(request.method==='GET'&&reportCsv){privileged(actor);json(response,200,{csv:runtime.reports.exportAdvancedCsv(reportCsv[1],filters(url,['from','to','asOf']))});return true;}

      if(request.method==='GET'&&pathname==='/api/v1/replenishment'){privileged(actor);json(response,200,runtime.replenishment.listSuggestions({...filters(url,['lookbackDays','asOf']),includeZero:url.searchParams.get('includeZero')==='true'}));return true;}
      const policy=pathname.match(/^\/api\/v1\/replenishment\/policies\/([^/]+)$/);if(request.method==='GET'&&policy){privileged(actor);json(response,200,runtime.replenishment.getPolicy(decodeURIComponent(policy[1])));return true;}if(request.method==='PUT'&&policy){privileged(actor);json(response,200,runtime.replenishment.saveProductPolicy(decodeURIComponent(policy[1]),await body(request,bodyLimitBytes),actor));return true;}
      if(request.method==='POST'&&pathname==='/api/v1/replenishment/draft-order'){privileged(actor);json(response,201,runtime.replenishment.createDraft(await body(request,bodyLimitBytes),actor));return true;}

      throw new CommercialCoreHttpError(404,'Rota comercial nao encontrada.');
    }catch(error){const status=error.statusCode||(/UNIQUE constraint failed/.test(error.message||'')?409:400);try{runtime.logger?.log({level:status>=500?'error':'warn',subsystem:'commercial-core-http',message:error.message||'Erro interno.',context:{method:request.method,path:pathname,status}});}catch{}json(response,status,{error:error.message||'Erro interno.'});return true;}
  };
}

module.exports={createCommercialCoreRouter,CommercialCoreHttpError};
