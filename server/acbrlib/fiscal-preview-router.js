'use strict';
// Opt-in fiscal preparation endpoint. No real issuance, secret storage or SEFAZ call.
const {createFiscalDraftService}=require('./fiscal-draft-service');
const {createAcbrLibAdapter}=require('./acbrlib-adapter');
const {createFiscalIssuanceService}=require('./fiscal-issuance-service');
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
function createFiscalPreviewRouter({runtime,sessionStore,enabled=false,requireTerminalAuth=false,bodyLimitBytes=32*1024,nativeOptions=null}={}){
 if(!enabled)return async()=>false;
 if(!runtime?.db||!runtime?.sales||!runtime?.authorization)throw TypeError('Runtime fiscal indisponível');
 const service=createFiscalDraftService({db:runtime.db,sales:runtime.sales});
 // Native paths and certificate configuration are supplied locally by the
 // operator, never from HTTP requests or the central cloud.
 const adapter=nativeOptions?.inputDir?createAcbrLibAdapter({...nativeOptions,issuerUF:()=>service.getCompany()?.uf}):null;
 const issuance=adapter?createFiscalIssuanceService({
  db:runtime.db,drafts:service,sales:runtime.sales,adapter,inputDir:nativeOptions.inputDir,
  allowHomologation:nativeOptions.allowHomologation===true,
  ...(typeof nativeOptions.now==='function'?{now:nativeOptions.now}:{}),
  ...(typeof nativeOptions.randomCNF==='function'?{randomCNF:nativeOptions.randomCNF}:{})
 }):null;
 const nativeConfigured=Boolean(nativeOptions?.inputDir&&nativeOptions?.nfeLib&&nativeOptions?.nfeConfig&&nativeOptions?.workerExe);

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
   if(req.method==='GET'&&p===prefix+'/status'){const nativeState=adapter?await adapter.status():null;send(res,200,{...service.getStatus(),iniPreparationEnabled:Boolean(issuance),emissionEnabled:Boolean(issuance&&nativeConfigured&&nativeState?.data?.ready&&nativeOptions.allowHomologation===true)});return true;}
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
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/(compile|transmit|consult)$/))&&req.method==='POST'){
    const id=decodeURIComponent(matched[1]),operation=matched[2];
    if(!issuance)throw new FiscalHttpError(409,'ACBrLib local não configurada; emissão desabilitada');
    if(operation==='compile'){
     const body=await readBody(req,bodyLimitBytes);
     send(res,200,issuance.prepare(id,{recipient:body.recipient||null}));return true;
    }
    if(operation==='transmit'&&nativeOptions.allowHomologation!==true)
      throw new FiscalHttpError(409,'Emissão fiscal desabilitada até liberação explícita para homologação');
    const result=operation==='transmit'?await issuance.issue(id):await issuance.consult(id);
    send(res,result.status==='AUTHORIZED'?200:202,result);return true;
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
