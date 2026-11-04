'use strict';
// Opt-in fiscal preparation endpoint. No real issuance, secret storage or SEFAZ call.
const {createFiscalDraftService}=require('./fiscal-draft-service');
class FiscalHttpError extends Error{constructor(statusCode,message){super(message);this.statusCode=statusCode;}}
function send(res,status,data){
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
 res.end(JSON.stringify(data));
}
async function readBody(req,limit){
 let size=0;const chunks=[];
 for await(const chunk of req){size+=chunk.length;if(size>limit)throw new FiscalHttpError(413,'Requisição fiscal excede o limite');chunks.push(chunk);}
 if(!chunks.length)return{};
 let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new FiscalHttpError(400,'JSON fiscal inválido');}
 if(!body||typeof body!=='object'||Array.isArray(body))throw new FiscalHttpError(400,'Corpo fiscal inválido');
 return body;
}
function createFiscalPreviewRouter({runtime,sessionStore,enabled=false,requireTerminalAuth=false,bodyLimitBytes=32*1024}={}){
 if(!enabled)return async()=>false;
 if(!runtime?.db||!runtime?.sales||!runtime?.authorization)throw TypeError('Runtime fiscal indisponível');
 const service=createFiscalDraftService({db:runtime.db,sales:runtime.sales});
 const sessions=sessionStore||new Map();
 function sessionFor(req){
  const bearer=String(req.headers.authorization||'');
  const token=bearer.startsWith('Bearer ')?bearer.slice(7).trim():'';
  const session=sessions.get(token);
  if(!token||!session||session.expiresAt<=Date.now())throw new FiscalHttpError(401,'Sessão inválida ou expirada');
  if(requireTerminalAuth){
   const terminal=runtime.terminals.listTerminals().find(item=>item.terminalId===session.terminalId);
   if(!terminal||terminal.status!=='ACTIVE')throw new FiscalHttpError(401,'Terminal não autorizado');
  }
  try{runtime.authorization.require({principal:{kind:'human',id:session.userId},capability:'settings.manage'});}
  catch{throw new FiscalHttpError(403,'Somente administrador fiscal autorizado pode acessar a preparação');}
  return session;
 }
 const prefix='/api/v1/fiscal-preview';
 return async function route(req,res){
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  const p=url.pathname;if(p!==prefix&&!p.startsWith(prefix+'/'))return false;
  try{
   sessionFor(req);
   let matched;
   if(req.method==='GET'&&p===prefix+'/status'){send(res,200,service.getStatus());return true;}
   if(req.method==='GET'&&p===prefix+'/company'){send(res,200,service.getCompany());return true;}
   if(req.method==='PUT'&&p===prefix+'/company'){
    const body=await readBody(req,bodyLimitBytes);
    if(['password','passphrase','pfx','certificate','csc','token','secret'].some(k=>Object.hasOwn(body,k)))
     throw new FiscalHttpError(400,'Credenciais fiscais devem permanecer no cofre local, não nesta API');
    send(res,200,service.saveCompany(body));return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/products\/([^/]+)$/))){
    const productId=decodeURIComponent(matched[1]);
    if(req.method==='GET'){const profile=service.getProductProfile(productId);if(!profile)throw new FiscalHttpError(404,'Perfil tributário não encontrado');send(res,200,profile);return true;}
    if(req.method==='PUT'){const body=await readBody(req,bodyLimitBytes);
     if(body.productId&&body.productId!==productId)throw new FiscalHttpError(400,'Produto não corresponde ao caminho');
     send(res,200,service.saveProductProfile({...body,productId}));return true;}
   }
   if(req.method==='GET'&&p===prefix+'/documents'){send(res,200,service.listDocuments({limit:Number(url.searchParams.get('limit')||100)}));return true;}
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)$/))&&req.method==='GET'){
    const doc=service.getDocument(decodeURIComponent(matched[1]));
    if(!doc)throw new FiscalHttpError(404,'Documento não encontrado');
    send(res,200,doc);return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/sales\/([^/]+)\/prepare$/))&&req.method==='POST'){
    const body=await readBody(req,bodyLimitBytes);
    send(res,201,service.prepareSale(decodeURIComponent(matched[1]),{documentType:body.documentType||'nfce'}));return true;
   }
   if(req.method==='POST'&&/^\/api\/v1\/fiscal-preview\/documents\/[^/]+\/transmit$/.test(p)){
    throw new FiscalHttpError(409,'Emissão fiscal desabilitada até homologação SEFAZ e integração ACBrLib');
   }
   throw new FiscalHttpError(405,'Operação fiscal não suportada');
  }catch(error){
   const status=error.statusCode||(/não encontrad/i.test(error.message||'')?404:400);
   send(res,status,{error:status>=500?'Erro fiscal interno':String(error.message||'Falha de preparação fiscal').slice(0,240)});
   return true;
  }
 };
}
module.exports={createFiscalPreviewRouter};
