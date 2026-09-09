'use strict';
const { randomBytes }=require('node:crypto');

class HttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function sendJson(response,statusCode,payload,request,allowedOrigins=[]){const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};const origin=request?.headers?.origin;if(origin&&allowedOrigins.includes(origin)){headers['access-control-allow-origin']=origin;headers.vary='Origin';}response.writeHead(statusCode,headers);response.end(JSON.stringify(payload));}
async function readJson(request,limit){let total=0;const chunks=[];for await(const chunk of request){total+=chunk.length;if(total>limit)throw new HttpError(413,'Corpo da requisicao excede o limite permitido.');chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'JSON invalido.');}}
function bearer(request){const value=String(request.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
function createRouter({runtime,installationToken='',bodyLimitBytes=1024*1024,allowedOrigins=[],sessionTtlMs=12*60*60*1000}={}){
  if(!runtime)throw new TypeError('runtime is required.');const sessions=new Map();
  function authenticate(request){const token=bearer(request);const session=sessions.get(token);if(!session||session.expiresAt<=Date.now()){if(token)sessions.delete(token);throw new HttpError(401,'Sessao invalida ou expirada.');}return session;}
  function requireRole(session,roles){if(!roles.includes(session.role))throw new HttpError(403,'Permissao insuficiente.');}
  function actor(session){return{userId:session.userId,role:session.role,terminalId:session.terminalId||null};}
  async function dispatch(){return runtime.dispatchPending();}

  return async function route(request,response){
    try{
      const url=new URL(request.url||'/',`http://${request.headers.host||'localhost'}`);const pathname=url.pathname;
      if(request.method==='OPTIONS'){sendJson(response,204,{},request,allowedOrigins);return;}
      if(request.method==='GET'&&pathname==='/api/v1/health'){sendJson(response,200,{ok:true,status:'ready',schemaVersion:runtime.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version},request,allowedOrigins);return;}
      if(request.method==='POST'&&pathname==='/api/v1/auth/login'){
        if(installationToken&&request.headers['x-pdv-token']!==installationToken)throw new HttpError(401,'Token de instalacao invalido.');
        const body=await readJson(request,bodyLimitBytes);const auth=runtime.catalog.verifyUserPassword(body.username,body.password);if(!auth.ok)throw new HttpError(401,'Usuario ou senha invalidos.');
        const sessionToken=randomBytes(32).toString('hex');const session={userId:auth.user.id,role:auth.user.role,name:auth.user.name,terminalId:String(body.terminalId||'').trim()||null,expiresAt:Date.now()+sessionTtlMs};sessions.set(sessionToken,session);sendJson(response,200,{sessionToken,user:auth.user,expiresAt:new Date(session.expiresAt).toISOString()},request,allowedOrigins);return;
      }
      const session=authenticate(request);const currentActor=actor(session);const mutationId=String(request.headers['x-mutation-id']||'').trim()||null;

      if(request.method==='GET'&&pathname==='/api/v1/products'){sendJson(response,200,runtime.catalog.listProducts({includeInactive:url.searchParams.get('includeInactive')==='true'}),request,allowedOrigins);return;}
      if(request.method==='POST'&&pathname==='/api/v1/products'){requireRole(session,['admin','manager']);const body=await readJson(request,bodyLimitBytes);const product=runtime.catalog.upsertProduct(body,currentActor);sendJson(response,201,product,request,allowedOrigins);return;}

      const inventoryMatch=pathname.match(/^\/api\/v1\/inventory\/([^/]+)$/);
      if(request.method==='GET'&&inventoryMatch){sendJson(response,200,{productId:decodeURIComponent(inventoryMatch[1]),quantity:runtime.inventory.getBalance(decodeURIComponent(inventoryMatch[1]))},request,allowedOrigins);return;}
      if(request.method==='POST'&&pathname==='/api/v1/inventory/movements'){requireRole(session,['admin','manager']);const body=await readJson(request,bodyLimitBytes);const movement=runtime.inventory.move(body,currentActor);sendJson(response,201,movement,request,allowedOrigins);return;}

      if(request.method==='POST'&&pathname==='/api/v1/cash/sessions'){const body=await readJson(request,bodyLimitBytes);const opened=runtime.cash.openSession({...body,operatorId:session.userId,terminalId:body.terminalId||session.terminalId,actor:currentActor,mutationId});const dispatchResult=await dispatch();sendJson(response,201,{session:opened,dispatch:dispatchResult},request,allowedOrigins);return;}
      if(request.method==='GET'&&pathname==='/api/v1/cash/open'){const terminalId=url.searchParams.get('terminalId')||session.terminalId;if(!terminalId)throw new HttpError(400,'terminalId obrigatorio.');sendJson(response,200,runtime.cash.getOpenSession(terminalId),request,allowedOrigins);return;}
      let cashMatch=pathname.match(/^\/api\/v1\/cash\/sessions\/([^/]+)\/(supply|withdraw|close)$/);
      if(request.method==='POST'&&cashMatch){const id=decodeURIComponent(cashMatch[1]);const action=cashMatch[2];const body=await readJson(request,bodyLimitBytes);let result;if(action==='supply')result=runtime.cash.addSupply(id,{...body,actor:currentActor});else if(action==='withdraw')result=runtime.cash.withdraw(id,{...body,actor:currentActor});else result=runtime.cash.closeSession(id,{...body,actor:currentActor,mutationId});const dispatchResult=action==='close'?await dispatch():null;sendJson(response,200,dispatchResult?{session:result,dispatch:dispatchResult}:result,request,allowedOrigins);return;}

      if(request.method==='POST'&&pathname==='/api/v1/sales'){const body=await readJson(request,bodyLimitBytes);const sale=runtime.sales.openSale({...body,operatorId:session.userId,terminalId:body.terminalId||session.terminalId},currentActor);sendJson(response,201,sale,request,allowedOrigins);return;}
      const saleGet=pathname.match(/^\/api\/v1\/sales\/([^/]+)$/);if(request.method==='GET'&&saleGet){const sale=runtime.sales.getSale(decodeURIComponent(saleGet[1]));if(!sale)throw new HttpError(404,'Venda nao encontrada.');sendJson(response,200,sale,request,allowedOrigins);return;}
      const itemMatch=pathname.match(/^\/api\/v1\/sales\/([^/]+)\/items$/);if(request.method==='POST'&&itemMatch){const body=await readJson(request,bodyLimitBytes);sendJson(response,200,runtime.sales.addItem(decodeURIComponent(itemMatch[1]),body),request,allowedOrigins);return;}
      const completeMatch=pathname.match(/^\/api\/v1\/sales\/([^/]+)\/complete$/);if(request.method==='POST'&&completeMatch){const body=await readJson(request,bodyLimitBytes);const sale=runtime.sales.completeSale(decodeURIComponent(completeMatch[1]),{payments:body.payments||[],actor:currentActor,mutationId});const dispatchResult=await dispatch();sendJson(response,200,{sale,dispatch:dispatchResult},request,allowedOrigins);return;}
      const cancelMatch=pathname.match(/^\/api\/v1\/sales\/([^/]+)\/cancel$/);if(request.method==='POST'&&cancelMatch){requireRole(session,['admin','manager']);const body=await readJson(request,bodyLimitBytes);const sale=runtime.sales.cancelSale(decodeURIComponent(cancelMatch[1]),{reason:body.reason,actor:currentActor,mutationId});const dispatchResult=await dispatch();sendJson(response,200,{sale,dispatch:dispatchResult},request,allowedOrigins);return;}

      throw new HttpError(404,'Rota nao encontrada.');
    }catch(error){let status=error.statusCode||400;if(/UNIQUE constraint failed/.test(error.message||''))status=409;sendJson(response,status,{error:error.message||'Erro interno.'},request,allowedOrigins);}
  };
}
module.exports={HttpError,readJson,createRouter};
