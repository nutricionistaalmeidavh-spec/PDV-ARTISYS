'use strict';

class CheckoutDocumentHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function json(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function match(pathname,pattern){const p=pattern.split('/').filter(Boolean),a=pathname.split('/').filter(Boolean);if(p.length!==a.length)return null;const out={};for(let i=0;i<p.length;i++){if(p[i].startsWith(':'))out[p[i].slice(1)]=decodeURIComponent(a[i]);else if(p[i]!==a[i])return null;}return out;}

function createCheckoutDocumentRouter({runtime,sessionStore=null,requireTerminalAuth=false}={}){
  if(!runtime?.sales||!runtime?.orders||!runtime?.restaurant)throw new TypeError('checkout document runtime services are required.');
  const sessions=sessionStore||new Map();
  function principal(req){
    const token=bearer(req);const session=sessions.get(token);
    if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new CheckoutDocumentHttpError(401,'Sessao invalida ou expirada.');}
    if(requireTerminalAuth){const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);if(!terminal||terminal.status!=='ACTIVE')throw new CheckoutDocumentHttpError(401,'Terminal nao autorizado.');}
    return{userId:session.userId,role:session.role,terminalId:session.terminalId||null};
  }
  function search(query=''){
    const q=String(query||'').trim().toLowerCase();const rows=[];
    if(runtime.modules?.isEnabled('FOOD')){
      for(const table of runtime.restaurant.listTables()){
        if(!table.sessionId)continue;
        const session=runtime.restaurant.getSession(table.sessionId);if(!session||!['OPEN','CHECKOUT'].includes(session.status))continue;
        const hay=[table.label,table.id,session.id,'mesa','comanda'].join(' ').toLowerCase();if(q&&!hay.includes(q))continue;
        rows.push({type:'COMMAND',id:session.id,number:table.label,label:`${table.label} · Comanda`,status:session.status,totalCents:session.totalCents,customerName:null,saleId:session.checkoutSaleId||null,openedAt:session.openedAt});
      }
    }
    if(runtime.modules?.isEnabled('WHOLESALE')){
      for(const order of runtime.orders.listOrders({origin:'WHOLESALE'})){
        if(!['CONFIRMED','PARTIALLY_FULFILLED'].includes(order.status))continue;
        const hay=[order.orderNumber,order.id,order.customerName,'pedido','atacado','pedido atacado'].join(' ').toLowerCase();if(q&&!hay.includes(q))continue;
        rows.push({type:'ORDER',id:order.id,number:order.orderNumber||order.id,label:`${order.orderNumber||order.id} · Pedido Atacado`,status:order.status,totalCents:order.items.reduce((sum,item)=>sum+Math.round(Number(item.pendingQuantity||0)*Number(item.unitPriceCents||0)),0),customerName:order.customerName||null,saleId:null,openedAt:order.createdAt});
      }
    }
    return rows.sort((a,b)=>String(b.openedAt||'').localeCompare(String(a.openedAt||''))).slice(0,50);
  }
  return async function checkoutDocumentRouter(req,res){
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);const pathname=url.pathname;
    if(!pathname.startsWith('/api/v1/checkout/documents'))return false;
    try{
      const actor=principal(req);let m;
      if(pathname==='/api/v1/checkout/documents'&&req.method==='GET'){json(res,200,search(url.searchParams.get('query')||''));return true;}
      if((m=match(pathname,'/api/v1/checkout/documents/command/:id/open'))&&req.method==='POST'){
        if(!runtime.modules?.isEnabled('FOOD'))throw new CheckoutDocumentHttpError(409,'Alimentacao desativada.');
        const session=runtime.restaurant.getSession(m.id);if(!session||!['OPEN','CHECKOUT'].includes(session.status))throw new CheckoutDocumentHttpError(404,'Comanda nao encontrada ou ja encerrada.');
        if(session.checkoutSaleId){const existing=runtime.sales.getSale(session.checkoutSaleId);if(existing&&['OPEN','SUSPENDED'].includes(existing.status)){json(res,200,{type:'COMMAND',document:session,sale:existing});return true;}}
        const terminalId=actor.terminalId;if(!terminalId)throw new CheckoutDocumentHttpError(400,'Terminal obrigatorio.');
        const result=runtime.restaurant.checkoutToSale(session.id,{terminalId,operatorId:actor.userId,actor},runtime.sales);
        json(res,200,{type:'COMMAND',document:result.session,sale:result.sale});return true;
      }
      if((m=match(pathname,'/api/v1/checkout/documents/order/:id/open'))&&req.method==='POST'){
        if(!runtime.modules?.isEnabled('WHOLESALE'))throw new CheckoutDocumentHttpError(409,'Atacado desativado.');
        const terminalId=actor.terminalId;if(!terminalId)throw new CheckoutDocumentHttpError(400,'Terminal obrigatorio.');
        const result=runtime.orders.prepareCheckout(m.id,{terminalId,operatorId:actor.userId,sellerId:actor.userId},actor);
        json(res,200,{type:'ORDER',document:result.order,fulfillment:result.fulfillment,sale:result.sale});return true;
      }
      throw new CheckoutDocumentHttpError(405,'Metodo nao permitido.');
    }catch(error){
      let status=error.statusCode||400;if(!error.statusCode&&/Permissao insuficiente|Autorizacao/i.test(error.message||''))status=403;
      json(res,status,{error:error.message||'Erro interno.'});return true;
    }
  };
}
module.exports={createCheckoutDocumentRouter,CheckoutDocumentHttpError};
