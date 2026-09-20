'use strict';
class EnterpriseDepthHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
async function body(req,limit=1024*1024){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new EnterpriseDepthHttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new EnterpriseDepthHttpError(400,'JSON invalido.');}}
function pathMatch(pathname,pattern){const p=pattern.split('/').filter(Boolean),a=pathname.split('/').filter(Boolean);if(p.length!==a.length)return null;const out={};for(let i=0;i<p.length;i++){if(p[i].startsWith(':'))out[p[i].slice(1)]=decodeURIComponent(a[i]);else if(p[i]!==a[i])return null;}return out;}

function createEnterpriseDepthRouter({runtime,installationToken='',requireTerminalAuth=false}={}){
  if(!runtime?.logistics||!runtime?.procurement||!runtime?.orders)throw new TypeError('enterprise depth runtime services are required.');
  function principal(req){if(requireTerminalAuth){const id=String(req.headers['x-terminal-id']||'').trim();const key=String(req.headers['x-terminal-key']||'');const auth=runtime.terminals.authenticateTerminal(id,key);if(!auth.ok)throw new EnterpriseDepthHttpError(401,'Terminal nao autorizado.');return{userId:null,role:'cashier',terminalId:id};}if(installationToken&&req.headers['x-pdv-token']!==installationToken)throw new EnterpriseDepthHttpError(401,'Token local invalido.');return{userId:null,role:'admin',terminalId:null};}
  return async function enterpriseDepthRouter(req,res){
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const pathname=url.pathname;if(!pathname.startsWith('/api/v1/stock-')&&!pathname.startsWith('/api/v1/purchase-')&&!pathname.startsWith('/api/v1/sales-orders'))return false;
    try{
      const actor=principal(req);let match;
      if(pathname==='/api/v1/stock-locations'){
        if(req.method==='GET'){json(res,200,runtime.logistics.listLocations({includeInactive:url.searchParams.get('includeInactive')==='true'}));return true;}
        if(req.method==='POST'){json(res,201,runtime.logistics.createLocation(await body(req),actor));return true;}
      }
      if(pathname==='/api/v1/stock-availability'&&req.method==='GET'){const productId=url.searchParams.get('productId');if(!productId)throw new EnterpriseDepthHttpError(400,'productId obrigatorio.');json(res,200,runtime.logistics.getAvailability(productId,url.searchParams.get('locationId')||'MAIN'));return true;}
      if(pathname==='/api/v1/stock-reservations'&&req.method==='GET'){json(res,200,runtime.logistics.listReservations({status:url.searchParams.get('status')||null,sourceType:url.searchParams.get('sourceType')||null,sourceId:url.searchParams.get('sourceId')||null,locationId:url.searchParams.get('locationId')||null}));return true;}
      if(pathname==='/api/v1/stock-transfers'){
        if(req.method==='GET'){json(res,200,runtime.logistics.listTransfers({status:url.searchParams.get('status')||null,locationId:url.searchParams.get('locationId')||null}));return true;}
        if(req.method==='POST'){json(res,201,runtime.logistics.createTransfer(await body(req),actor));return true;}
      }
      if((match=pathMatch(pathname,'/api/v1/stock-transfers/:id/dispatch'))&&req.method==='POST'){json(res,200,runtime.logistics.dispatchTransfer(match.id,await body(req),actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/stock-transfers/:id/receive'))&&req.method==='POST'){json(res,200,runtime.logistics.receiveTransfer(match.id,await body(req),actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/stock-transfers/:id/cancel'))&&req.method==='POST'){json(res,200,runtime.logistics.cancelTransfer(match.id,await body(req),actor));return true;}
      if(pathname==='/api/v1/purchase-orders'){
        if(req.method==='GET'){json(res,200,runtime.procurement.listPurchaseOrders({status:url.searchParams.get('status')||null,supplierId:url.searchParams.get('supplierId')||null,locationId:url.searchParams.get('locationId')||null}));return true;}
        if(req.method==='POST'){json(res,201,runtime.procurement.createPurchaseOrder(await body(req),actor));return true;}
      }
      if(pathname==='/api/v1/purchase-receipts'&&req.method==='GET'){json(res,200,runtime.procurement.listReceipts({purchaseOrderId:url.searchParams.get('purchaseOrderId')||null}));return true;}
      if((match=pathMatch(pathname,'/api/v1/purchase-orders/:id/submit'))&&req.method==='POST'){json(res,200,runtime.procurement.submitPurchaseOrder(match.id,actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/purchase-orders/:id/receive'))&&req.method==='POST'){json(res,201,runtime.procurement.receivePurchaseOrder(match.id,await body(req),actor));return true;}
      if(pathname==='/api/v1/sales-orders'){
        if(req.method==='GET'){json(res,200,runtime.orders.listOrders({status:url.searchParams.get('status')||null,customerId:url.searchParams.get('customerId')||null,locationId:url.searchParams.get('locationId')||null}));return true;}
        if(req.method==='POST'){json(res,201,runtime.orders.createQuote(await body(req),actor));return true;}
      }
      if((match=pathMatch(pathname,'/api/v1/sales-orders/:id'))&&req.method==='GET'){const order=runtime.orders.getOrder(match.id);if(!order)throw new EnterpriseDepthHttpError(404,'Pedido nao encontrado.');json(res,200,order);return true;}
      if((match=pathMatch(pathname,'/api/v1/sales-orders/:id/confirm'))&&req.method==='POST'){json(res,200,runtime.orders.confirmOrder(match.id,actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/sales-orders/:id/cancel'))&&req.method==='POST'){json(res,200,runtime.orders.cancelOrder(match.id,await body(req),actor));return true;}
      if((match=pathMatch(pathname,'/api/v1/sales-orders/:id/fulfill'))&&req.method==='POST'){const result=runtime.orders.fulfillOrder(match.id,await body(req),actor);await runtime.dispatchPending();json(res,201,result);return true;}
      throw new EnterpriseDepthHttpError(405,'Metodo nao permitido.');
    }catch(error){const status=error.statusCode||(/UNIQUE constraint failed/.test(error.message||'')?409:400);try{runtime.logger?.log({level:'warn',subsystem:'enterprise-depth-http',message:error.message||'Erro interno.',context:{method:req.method,path:pathname,status}});}catch{}json(res,status,{error:error.message||'Erro interno.'});return true;}
  };
}
module.exports={createEnterpriseDepthRouter,EnterpriseDepthHttpError};
