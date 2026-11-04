'use strict';
const {readJson}=require('./router');
function createPaymentIntentRouter({runtime,sessionStore,bodyLimitBytes=1024*1024,requireTerminalAuth=false}={}){
  if(!runtime?.paymentIntents||!sessionStore)throw new TypeError('Servico de pagamento e sessoes sao obrigatorios.');
  function json(res,status,payload){res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
  function sessionFor(req){
    const token=String(req.headers.authorization||'').replace(/^Bearer\s+/,'').trim();
    const session=sessionStore.get(token);
    if(!token||!session||session.expiresAt<=Date.now())throw Object.assign(new Error('Sessao invalida ou expirada.'),{statusCode:401});
    if(requireTerminalAuth){
      const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);
      if(!terminal||terminal.status!=='ACTIVE')throw Object.assign(new Error('Terminal nao autorizado.'),{statusCode:401});
    }
    return session;
  }
  function requireCapability(session,capability){
    try{runtime.authorization.require({principal:{kind:'human',id:session.userId},capability});}
    catch(err){throw Object.assign(new Error(err.message||'Permissao insuficiente.'),{statusCode:err.statusCode||403});}
  }
  return async function paymentIntentRoute(req,res){
    const pathname=new URL(req.url||'/', 'http://localhost').pathname;
    if(!/^\/api\/v1\/payment-intents(?:\/|$)/.test(pathname))return false;
    try{
      const session=sessionFor(req);
      const actorId=session.userId;
      const service=runtime.paymentIntents;
      const idMatch=pathname.match(/^\/api\/v1\/payment-intents\/([^/]+)(?:\/(start|reconcile|confirm-manual|cancel))?$/);
      if(req.method==='POST'&&pathname==='/api/v1/payment-intents'){
        requireCapability(session,'sales.create');
        const body=await readJson(req,bodyLimitBytes);
        json(res,201,service.create(body));return true;
      }
      if(req.method==='GET'&&pathname==='/api/v1/payment-intents'){
        requireCapability(session,'sales.view');
        const saleId=new URL(req.url,'http://localhost').searchParams.get('saleId');
        if(!saleId)throw new Error('saleId obrigatorio.');
        json(res,200,service.listBySale(saleId));return true;
      }
      if(idMatch){
        const id=decodeURIComponent(idMatch[1]),action=idMatch[2];
        if(req.method==='GET'&&!action){
          requireCapability(session,'sales.view');const intent=service.get(id);
          if(!intent)throw Object.assign(new Error('Tentativa nao encontrada.'),{statusCode:404});
          json(res,200,intent);return true;
        }
        if(req.method==='POST'&&action){
          requireCapability(session,action==='confirm-manual'?'sales.cancel':'sales.create');
          let payload;
          if(action==='start')payload=await service.start(id);
          if(action==='reconcile')payload=await service.reconcile(id);
          if(action==='cancel')payload=service.cancel(id);
          if(action==='confirm-manual'){
            const body=await readJson(req,bodyLimitBytes);
            payload=service.confirmManual(id,{checkedAccountCredit:body.checkedAccountCredit===true,actorId});
          }
          json(res,200,payload);return true;
        }
      }
      json(res,404,{error:'Rota de pagamento nao encontrada.'});
    }catch(error){json(res,error.statusCode||400,{error:error.message||'Falha no pagamento.'});}
    return true;
  };
}
module.exports={createPaymentIntentRouter};
