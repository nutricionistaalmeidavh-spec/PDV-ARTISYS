'use strict';

function sendJson(res,status,payload){if(res.headersSent)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
async function readJson(req,maxBytes){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Object.assign(new Error('Corpo fiscal excede o limite permitido.'),{statusCode:413});chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('JSON fiscal invalido.'),{statusCode:400});}}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}

function createFiscalBlock5Router({runtime,sessionStore,bodyLimitBytes=1024*1024}={}){
  if(!runtime||!sessionStore)throw new TypeError('runtime e sessionStore sao obrigatorios no router fiscal.');
  function session(req){const token=bearer(req);const current=sessionStore.get(token);if(!current||current.expiresAt<=Date.now()){if(token)sessionStore.delete(token);throw Object.assign(new Error('Sessao invalida ou expirada.'),{statusCode:401});}if(!['admin','manager'].includes(current.role))throw Object.assign(new Error('Permissao insuficiente.'),{statusCode:403});return current;}
  function actor(current){return{userId:current.userId,role:current.role,terminalId:current.terminalId||null};}
  return async function route(req,res){
    const url=new URL(req.url||'/','http://localhost');const pathname=url.pathname;if(!pathname.startsWith('/api/v1/fiscal/documents/'))return false;
    const current=session(req);const currentActor=actor(current);const method=String(req.method||'GET').toUpperCase();
    try{
      let match=pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/monitor$/);if(method==='GET'&&match){sendJson(res,200,runtime.fiscal.getMonitorDocument(decodeURIComponent(match[1])));return true;}
      match=pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/events$/);if(method==='GET'&&match){sendJson(res,200,runtime.fiscal.listEvents(decodeURIComponent(match[1])));return true;}
      match=pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/xml$/);if(method==='GET'&&match){const kind=String(url.searchParams.get('kind')||'authorized');sendJson(res,200,{kind,xml:runtime.fiscal.readXml(decodeURIComponent(match[1]),kind)});return true;}
      match=pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/reconcile$/);if(method==='POST'&&match){const id=decodeURIComponent(match[1]);runtime.fiscal.requestReconcile(id,{actor:currentActor,mutationId:String(req.headers['x-mutation-id']||'')||null});const dispatch=await runtime.dispatchPending();sendJson(res,200,{document:runtime.fiscal.getDocument(id),dispatch});return true;}
      match=pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/cancel$/);if(method==='POST'&&match){const id=decodeURIComponent(match[1]);const body=await readJson(req,bodyLimitBytes);runtime.fiscal.requestCancel(id,{reason:body.reason,actor:currentActor,mutationId:String(req.headers['x-mutation-id']||'')||null});const dispatch=await runtime.dispatchPending();sendJson(res,200,{document:runtime.fiscal.getDocument(id),dispatch});return true;}
      match=pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/danfe$/);if(method==='POST'&&match){const id=decodeURIComponent(match[1]);const body=await readJson(req,bodyLimitBytes);sendJson(res,201,runtime.fiscal.queueDanfe(id,{actor:currentActor,width:body.width||42}));return true;}
      return false;
    }catch(error){sendJson(res,Number(error.statusCode||400),{error:error.message||'Falha fiscal.'});return true;}
  };
}

module.exports={createFiscalBlock5Router};
