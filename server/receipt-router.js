'use strict';

const {createSaleReceiptService}=require('../js/domains/printing/sale-receipt-projection');
const {resolvePrintingPreferences,validatePrintingPreferences}=require('../js/domains/printing/printing-preferences');

function sendJson(res,status,payload){if(res.headersSent)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
async function readJson(req,maxBytes=64*1024){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Object.assign(new Error('Corpo excede o limite permitido.'),{statusCode:413});chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('JSON invalido.'),{statusCode:400});}}

function createReceiptRouter({runtime,sessionStore,env=process.env}={}) {
  if(!runtime||!sessionStore)throw new TypeError('runtime e sessionStore sao obrigatorios no router de comprovante.');
  const receipts=createSaleReceiptService({saleService:runtime.sales,settings:runtime.settings,env});
  function session(req){const token=bearer(req);const current=sessionStore.get(token);if(!current||current.expiresAt<=Date.now()){if(token)sessionStore.delete(token);throw Object.assign(new Error('Sessao invalida ou expirada.'),{statusCode:401});}return current;}
  function requireRole(current,roles){if(!roles.includes(String(current?.role||'')))throw Object.assign(new Error('Permissao insuficiente.'),{statusCode:403});}
  function printingPreferences(){return resolvePrintingPreferences({settings:runtime.settings,env,isExistingInstall:true});}
  function originalReceipt(saleId){
    const job=runtime.printing?.getOriginalSaleReceipt?.(saleId);
    if(!job)return null;
    const payload=job.payload&&typeof job.payload==='object'&&!Array.isArray(job.payload)?job.payload:{};
    const text=String(payload.text||'');
    const width=Number(job.width);
    const paperMm=Number(payload.paperMm);
    if(!text||![32,42,48].includes(width)||![58,80].includes(paperMm))return null;
    return Object.freeze({
      saleId:String(saleId),
      saleNumber:String(payload.saleNumber||saleId),
      width,
      paperMm,
      text,
      logoDataUrl:payload.logoDataUrl||null
    });
  }
  function saleReceipt(saleId){return originalReceipt(saleId)||receipts.build(saleId);}
  function savePrintingPreferences(input,current){
    requireRole(current,['admin','manager']);
    const normalized=validatePrintingPreferences({...printingPreferences(),...(input||{})});
    const actor={userId:current.userId,role:current.role,terminalId:current.terminalId||null};
    const values={
      'printing.deviceName':normalized.deviceName,
      'printing.paperMm':normalized.paperMm,
      'printing.columnsMode':normalized.columnsMode,
      'printing.columns':normalized.columns,
      'printing.autoPrint':normalized.autoPrint,
      'printing.showSystemDialog':normalized.showSystemDialog,
      'printing.cut':normalized.cut,
      'printing.openDrawerAfterPrint':normalized.openDrawerAfterPrint
    };
    for(const [key,value] of Object.entries(values))runtime.settings.set(key,value,{scope:'global',actor});
    return printingPreferences();
  }
  return async function route(req,res){
    const url=new URL(req.url||'/','http://localhost');
    const receiptMatch=url.pathname.match(/^\/api\/v1\/sales\/([^/]+)\/receipt$/);
    const isPreferences=url.pathname==='/api/v1/printing/preferences';
    if(!receiptMatch&&!isPreferences)return false;
    try{
      const current=session(req);
      const method=String(req.method||'GET').toUpperCase();
      if(isPreferences){
        if(method==='GET'){sendJson(res,200,printingPreferences());return true;}
        if(method==='PUT'){sendJson(res,200,savePrintingPreferences(await readJson(req),current));return true;}
        throw Object.assign(new Error('Metodo nao permitido.'),{statusCode:405});
      }
      if(method!=='GET')throw Object.assign(new Error('Metodo nao permitido.'),{statusCode:405});
      const saleId=decodeURIComponent(receiptMatch[1]);
      sendJson(res,200,saleReceipt(saleId));
      return true;
    }catch(error){sendJson(res,Number(error.statusCode||400),{error:error.message||'Falha ao processar comprovante/impressao.'});return true;}
  };
}

module.exports={createReceiptRouter};
