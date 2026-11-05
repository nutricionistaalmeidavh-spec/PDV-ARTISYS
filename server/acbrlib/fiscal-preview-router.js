'use strict';
// Opt-in fiscal preparation endpoint. No real issuance, secret storage or SEFAZ call.
const {createFiscalDraftService}=require('./fiscal-draft-service');
const {createAcbrLibAdapter}=require('./acbrlib-adapter');
const {createFiscalIssuanceService}=require('./fiscal-issuance-service');
const {OFFLINE_UF_POLICIES}=require('./nfce-offline-uf-policy');
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
   if(req.method==='GET'&&p===prefix+'/offline-uf-policy'){
    const company=service.getCompany(),issuerUf=company?.uf||null;
    const policy=issuerUf?OFFLINE_UF_POLICIES[issuerUf]||null:null;
    send(res,200,{issuerUf,eligible:Boolean(policy),supportedUfs:Object.keys(OFFLINE_UF_POLICIES),
      policy:policy||null,
      configuredSeries:company?.series??null,configuredOfflineSeries:company?.offlineSeries??null,
      productionEnabled:false,requiresCustomerHomologation:true});
    return true;
   }
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
   if(req.method==='GET'&&p===prefix+'/documents'){
    const documents=service.listDocuments({limit:Number(url.searchParams.get('limit')||100)});
    send(res,200,documents.map(document=>({...document,
      issuanceMode:issuance?.getIssuanceMode(document.id)||null,
      offlineStatus:issuance?.getOfflineStatus(document.id)||null})));return true;
   }


   if(req.method==='GET'&&p===prefix+'/offline-queue'){
    if(!issuance)throw new FiscalHttpError(409,'Fila offline não configurada');
    send(res,200,issuance.listOfflineQueue());return true;
   }
   if(req.method==='POST'&&p===prefix+'/offline-queue/flush'){
    if(!issuance||nativeOptions.allowHomologation!==true)
     throw new FiscalHttpError(409,'Fila offline exige homologação habilitada');
    const body=await readBody(req,bodyLimitBytes);
    const result=await issuance.flushOfflineQueue({limit:body.limit??10});
    send(res,result.some(item=>item.status==='UNKNOWN')?202:200,result);return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/offline-issue$/))&&req.method==='POST'){
    if(!issuance||nativeOptions.allowHomologation!==true)
     throw new FiscalHttpError(409,'Emissão offline exige homologação habilitada');
    const result=await issuance.offlineIssue(decodeURIComponent(matched[1]));
    send(res,201,result);return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/offline-danfe\.pdf$/))&&req.method==='GET'){
    if(!issuance)throw new FiscalHttpError(409,'DANFE offline não configurada');
    const bytes=issuance.getOfflineDanfe(decodeURIComponent(matched[1]));
    res.writeHead(200,{'content-type':'application/pdf',
      'content-disposition':'attachment; filename="artisys-danfe-contingencia.pdf"',
      'content-length':bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});
    res.end(bytes);return true;
   }

   if(req.method==='GET'&&p===prefix+'/inutilizations'){
    if(!issuance)throw new FiscalHttpError(409,'ACBr local não configurada');
    send(res,200,issuance.listInutilizations());return true;
   }
   if(req.method==='POST'&&p===prefix+'/inutilizations'){
    if(!issuance||nativeOptions.allowHomologation!==true)
     throw new FiscalHttpError(409,'Inutilização somente em homologação habilitada');
    const body=await readBody(req,bodyLimitBytes);
    const result=await issuance.inutilize(body);
    send(res,result.status==='CONFIRMED'?200:202,result);return true;
   }

   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/cce$/))&&req.method==='GET'){
    if(!issuance)throw new FiscalHttpError(409,'ACBr local não configurada');
    send(res,200,issuance.getCceHistory(decodeURIComponent(matched[1])));return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/cce$/))&&req.method==='POST'){
    if(!issuance||nativeOptions.allowHomologation!==true)
     throw new FiscalHttpError(409,'CC-e somente em homologação habilitada');
    const body=await readBody(req,bodyLimitBytes);
    const result=await issuance.cce(decodeURIComponent(matched[1]),{
      correction:body.correction,sequence:body.sequence,reviewedBy:body.reviewedBy,
      confirmNoMaterialChange:body.confirmNoMaterialChange,
      replacesPrevious:body.replacesPrevious
    });
    send(res,result.status==='CONFIRMED'?200:202,result);return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/cancellation$/))&&req.method==='GET'){
    if(!issuance)throw new FiscalHttpError(409,'ACBr local não configurada');
    const result=issuance.getCancellationStatus(decodeURIComponent(matched[1]));
    if(!result)throw new FiscalHttpError(404,'Nenhum cancelamento registrado');
    send(res,200,result);return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/cancel$/))&&req.method==='POST'){
    if(!issuance||nativeOptions.allowHomologation!==true)
     throw new FiscalHttpError(409,'Cancelamento somente em homologação habilitada');
    const body=await readBody(req,bodyLimitBytes);
    const result=await issuance.cancel(decodeURIComponent(matched[1]),{reason:body.reason});
    send(res,result.status==='CANCELLED'?200:202,result);return true;
   }

   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)$/))&&req.method==='GET'){
    const doc=service.getDocument(decodeURIComponent(matched[1]));
    if(!doc)throw new FiscalHttpError(404,'Documento não encontrado');
    send(res,200,{...doc,issuanceMode:issuance?.getIssuanceMode(doc.id)||null,
      offlineStatus:issuance?.getOfflineStatus(doc.id)||null});return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/sales\/([^/]+)\/prepare$/))&&req.method==='POST'){
    const body=await readBody(req,bodyLimitBytes);
    send(res,201,service.prepareSale(decodeURIComponent(matched[1]),{documentType:body.documentType||'nfce',offline:body.offline===true}));return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/danfe\\.pdf$/))&&req.method==='GET'){
    if(!issuance)throw new FiscalHttpError(409,'ACBr local não configurada');
    const bytes=issuance.getDanfe(decodeURIComponent(matched[1]));
    res.writeHead(200,{
     'content-type':'application/pdf',
     'content-disposition':'attachment; filename="artisys-danfe.pdf"',
     'content-length':bytes.length,
     'cache-control':'no-store',
     'x-content-type-options':'nosniff'
    });
    res.end(bytes);return true;
   }
   if((matched=p.match(/^\/api\/v1\/fiscal-preview\/documents\/([^/]+)\/(compile|transmit|consult|danfe)$/))&&req.method==='POST'){
    const id=decodeURIComponent(matched[1]),operation=matched[2];
    if(!issuance)throw new FiscalHttpError(409,'ACBrLib local não configurada; emissão desabilitada');
    if(operation==='danfe'){
     const result=await issuance.danfe(id);
     send(res,200,result);return true;
    }
    if(operation==='compile'){
     const body=await readBody(req,bodyLimitBytes);
     send(res,200,issuance.prepare(id,{recipient:body.recipient||null,contingency:body.contingency||null}));return true;
    }
    if(operation==='transmit'&&nativeOptions.allowHomologation!==true)
      throw new FiscalHttpError(409,'Emissão fiscal desabilitada até liberação explícita para homologação');
    const result=operation==='transmit'?await issuance.issue(id):await issuance.consult(id);
    send(res,['AUTHORIZED','REJECTED'].includes(result.status)?200:202,result);return true;
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
