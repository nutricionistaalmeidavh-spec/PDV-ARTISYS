'use strict';

const {createSaleReceiptService}=require('../js/domains/printing/sale-receipt-projection');

function sendJson(res,status,payload){if(res.headersSent)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}

function createReceiptRouter({runtime,sessionStore,env=process.env}={}) {
  if(!runtime||!sessionStore)throw new TypeError('runtime e sessionStore sao obrigatorios no router de comprovante.');
  const receipts=createSaleReceiptService({saleService:runtime.sales,settings:runtime.settings,env});
  function session(req){const token=bearer(req);const current=sessionStore.get(token);if(!current||current.expiresAt<=Date.now()){if(token)sessionStore.delete(token);throw Object.assign(new Error('Sessao invalida ou expirada.'),{statusCode:401});}return current;}
  return async function route(req,res){
    const url=new URL(req.url||'/','http://localhost');
    const match=url.pathname.match(/^\/api\/v1\/sales\/([^/]+)\/receipt$/);
    if(!match)return false;
    try{
      if(String(req.method||'GET').toUpperCase()!=='GET')throw Object.assign(new Error('Metodo nao permitido.'),{statusCode:405});
      session(req);
      sendJson(res,200,receipts.build(decodeURIComponent(match[1])));
      return true;
    }catch(error){sendJson(res,Number(error.statusCode||400),{error:error.message||'Falha ao gerar comprovante.'});return true;}
  };
}

module.exports={createReceiptRouter};
