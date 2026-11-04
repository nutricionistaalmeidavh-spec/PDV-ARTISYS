'use strict';
// Local ACBrLib homologation coordinator. All filesystem and database state is
// durable before a single SEFAZ send. UNKNOWN can ONLY be consulted, not sent again.
const fs=require('node:fs');
const path=require('node:path');
const {createHash,randomInt}=require('node:crypto');
const {withTransaction}=require('../../js/core/database/sqlite-database');
const {compileAcbrIni}=require('./fiscal-ini-builder');
const {readManifest}=require('./acbrlib-adapter');
const KEY=/^([0-9]{44})$/;
function sha(data){return createHash('sha256').update(data).digest('hex');}
function writeOnce(filepath,buffer){
 try{fs.writeFileSync(filepath,buffer,{flag:'wx',mode:0o600});}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const existing=fs.readFileSync(filepath);
  if(sha(existing)!==sha(buffer))throw Error('Arquivo fiscal alterado: bloqueado para revisão');
 }
}
function ensureInputDirectory(dir){
 if(!dir||!path.isAbsolute(dir))throw Error('Pasta fiscal absoluta obrigatória');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink())throw Error('Pasta fiscal inválida');
 return fs.realpathSync(dir);
}
function createFiscalIssuanceService({db,drafts,sales,adapter,inputDir,allowHomologation=false,
 randomCNF=()=>String(randomInt(0,100000000)).padStart(8,'0'),
 now=()=>{
  const d=new Date(),two=n=>String(n).padStart(2,'0'),mins=-d.getTimezoneOffset();
  const offset=(mins>=0?'+':'-')+two(Math.floor(Math.abs(mins)/60))+':'+two(Math.abs(mins)%60);
  return [d.getFullYear(),two(d.getMonth()+1),two(d.getDate())].join('-')+'T'+
   [two(d.getHours()),two(d.getMinutes()),two(d.getSeconds())].join(':')+offset;
 }}={}){
 if(!db||!drafts||!sales||typeof sales.getSaleDetails!=='function'||!adapter||typeof adapter.issue!=='function')
  throw TypeError('SQLite, serviço fiscal canônico e adaptador ACBr são obrigatórios');
 const dir=ensureInputDirectory(inputDir);
 db.exec('CREATE TABLE IF NOT EXISTS acbr_fiscal_issuance_meta ('+
  'document_id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE,'+
  'cnf TEXT NOT NULL, issued_at TEXT NOT NULL, xml_sha256 TEXT,'+
  'access_key TEXT, protocol TEXT, updated_at TEXT NOT NULL)');
 db.exec('CREATE TABLE IF NOT EXISTS acbr_fiscal_rejections ('+
  'document_id TEXT PRIMARY KEY, c_stat INTEGER NOT NULL,reason TEXT NOT NULL,reported_at TEXT NOT NULL)');
 const metaFor=id=>db.prepare('SELECT * FROM acbr_fiscal_issuance_meta WHERE document_id=?').get(String(id));
 const draftFor=id=>{
  const draft=drafts.getDocument(id);
  if(!draft)throw Error('Documento fiscal não encontrado');
  if(draft.environment!=='homologation'||draft.snapshot.issuer.environment!=='homologation')
   throw Error('Produção fiscal bloqueada');
  return draft;
 };
 function assertSaleCurrent(draft){
  const current=sales.getSaleDetails(draft.saleId),original=draft.snapshot;
  if(!current||current.status!=='COMPLETED')throw Error('Venda não está concluída: envio fiscal bloqueado após cancelamento');
  if(current.completedAt!==original.sale.completedAt||
     current.totalCents!==original.totalCents||current.subtotalCents!==original.subtotalCents||
     current.discountCents!==original.discountCents||
     (current.changeCents||0)!==original.changeCents)
    throw Error('Valores da venda mudaram após preparação fiscal');
  const actual=current.items||[],expected=original.items||[];
  if(actual.length!==expected.length||actual.some((item,i)=>
   item.id!==expected[i].itemId||item.productId!==expected[i].productId||
   Math.round(item.quantity*1000)!==expected[i].quantityMilli||
   item.totalCents!==expected[i].grossCents||
   (item.netTotalCents??item.totalCents-(item.allocatedDiscountCents||0))!==expected[i].netTotalCents))
   throw Error('Itens da venda mudaram após preparação fiscal');
  const payments=current.payments||[],old=original.payments||[];
  if(payments.length!==old.length||payments.some((p,i)=>p.method!==old[i].method||p.amountCents!==old[i].amountCents))
   throw Error('Pagamentos da venda mudaram após preparação fiscal');
 }
 function verifyReady(document){
  const meta=metaFor(document.id);
  if(!meta)throw Error('Manifesto fiscal não preparado');
  const {iniPath,manifest}=readManifest(dir,meta.reference);
  if(manifest.snapshotHash!==document.snapshotHash||manifest.amountCents!==document.totalCents||
     manifest.issuerCnpj!==document.snapshot.issuer.cnpj||
     manifest.issuerUF!==document.snapshot.issuer.uf||
     manifest.environment!=='homologation'||manifest.model!==document.model||
     manifest.documentType!==document.documentType)
   throw Error('Manifesto fiscal diverge do documento canônico');
  return {meta,iniPath,manifest};
 }
 function prepare(id,{recipient=null}={}){
  const document=draftFor(id);
  if(document.status==='READY'){
   const ready=verifyReady(document);
   return {id:document.id,status:'READY',reference:ready.meta.reference,model:document.model};
  }
  if(document.status!=='REVIEW_REQUIRED')
   throw Error('Documento já enviado ou com consulta fiscal obrigatória');
  const existing=metaFor(id);
  // Preserve cNF and emission timestamp if preparation was interrupted.
  const cNF=existing?.cnf||randomCNF();
  const issuedAt=existing?.issued_at||now();
  const compiled=compileAcbrIni({document,cNF,issuedAt,recipient});
  const {reference,ini,manifest}=compiled;
  if(existing&&existing.reference!==reference)throw Error('Referência fiscal divergente');
  const iniPath=path.join(dir,reference+'.ini');
  const manifestPath=path.join(dir,reference+'.json');
  // Both files are idempotent and never overwritten in place.
  writeOnce(iniPath,Buffer.from(ini,'utf8'));
  writeOnce(manifestPath,Buffer.from(JSON.stringify(manifest),'utf8'));
  const validated=readManifest(dir,reference);
  if(validated.manifest.snapshotHash!==document.snapshotHash)
   throw Error('Snapshot fiscal não corresponde ao manifesto');
  withTransaction(db,()=>{
   db.prepare('INSERT INTO acbr_fiscal_issuance_meta(document_id,reference,cnf,issued_at,updated_at)'+
     'VALUES(?,?,?,?,?) ON CONFLICT(document_id) DO NOTHING').run(document.id,reference,cNF,issuedAt,now());
   const count=db.prepare("UPDATE acbr_fiscal_documents SET status='READY',updated_at=? "+
     "WHERE id=? AND status='REVIEW_REQUIRED'").run(now(),document.id);
   if(count.changes!==1)throw Error('Documento fiscal já preparado por outra operação');
  });
  return {id:document.id,status:'READY',reference,model:document.model};
 }
 function authorized(id,result){
  if(result?.ok!==true||!result.data)throw Error('ACBr não retornou autorização confirmada');
  const key=String(result.data.chave_nfe||''),protocol=String(result.data.protocolo||'');
  if(!KEY.test(key)||!/^\d{10,20}$/.test(protocol)||!String(result.data.xml||'').length)
   throw Error('Autorização fiscal incompleta');
  const record=metaFor(id);
  if(!record)throw Error('Registro de emissão não encontrado');
  const xml=Buffer.from(String(result.data.xml),'utf8');
  if(xml.length>4*1024*1024)throw Error('XML fiscal excede limite');
  const xmlPath=path.join(dir,record.reference+'.authorized.xml');
  writeOnce(xmlPath,xml);
  withTransaction(db,()=>{
   const status=db.prepare("UPDATE acbr_fiscal_documents "+
     "SET status='AUTHORIZED',updated_at=? WHERE id=? AND status='UNKNOWN'").run(now(),id);
   if(status.changes!==1)throw Error('Estado fiscal mudou durante autorização');
   db.prepare('UPDATE acbr_fiscal_issuance_meta SET access_key=?,protocol=?,xml_sha256=?,updated_at=? '+
     'WHERE document_id=?').run(key,protocol,sha(xml),now(),id);
  });
  return {id,status:'AUTHORIZED',accessKey:key,protocol,xmlSha256:sha(xml)};
 }
 function rejected(id,result){
  if(result?.rejected!==true||!result.data)throw Error('Rejeição fiscal não comprovada');
  const code=Number(result.data.cStat);
  if(!Number.isSafeInteger(code)||code<200||[204,205,539].includes(code))
   throw Error('Status SEFAZ ambíguo, requer consulta');
  const reason=String(result.data.reason||'Documento rejeitado pela SEFAZ').replace(/[\r\n\0]/g,' ').slice(0,180);
  withTransaction(db,()=>{
   const changed=db.prepare("UPDATE acbr_fiscal_documents SET status='REJECTED',updated_at=? "+
    "WHERE id=? AND status='UNKNOWN'").run(now(),id).changes;
   if(changed!==1)throw Error('Estado fiscal mudou durante rejeição');
   db.prepare('INSERT INTO acbr_fiscal_rejections(document_id,c_stat,reason,reported_at) VALUES(?,?,?,?)')
    .run(id,code,reason,now());
  });
  return {id,status:'REJECTED',cStat:code,reason,retryAllowed:false};
 }
 async function issue(id){
  if(allowHomologation!==true)throw Error('Envio fiscal desabilitado; somente homologação habilitada manualmente');
  const draft=draftFor(id);
  if(draft.status!=='READY')throw Error('Documento já enviado; consulta obrigatória antes de qualquer reenvio');
  assertSaleCurrent(draft);
  const {manifest,meta}=verifyReady(draft);
  if(typeof adapter.status==='function'){
   const state=await adapter.status();
   if(state?.data?.ready===false)throw Error('ACBrLib nativa ou configuração ausente; envio não iniciado');
  }
  if(fs.existsSync(path.join(dir,meta.reference+'.signed.xml')))
   throw Error('XML fiscal já assinado; somente consulta, não reenvio');
  const changed=withTransaction(db,()=>db.prepare("UPDATE acbr_fiscal_documents SET status='UNKNOWN',updated_at=? "+
    "WHERE id=? AND status='READY'").run(now(),id).changes);
  if(changed!==1)throw Error('Envio fiscal concorrente, consulta necessária');
  // UNKNOWN is persisted before the native worker is started, including after a crash.
  try{
   const result=await adapter.issue({type:manifest.documentType,reference:meta.reference,
    environment:'homologation',payload:{document:manifest}});
   if(result?.ok)return authorized(id,result);
   if(result?.rejected===true)return rejected(id,result);
  }catch{/* The worker/SEFAZ state is unknown, so no automatic retry. */}
  return {id,status:'UNKNOWN',requiresConsultation:true};
 }
 async function consult(id){
  const draft=draftFor(id);
  if(draft.status==='AUTHORIZED'){
   const meta=metaFor(id);
   return {id,status:'AUTHORIZED',accessKey:meta?.access_key,protocol:meta?.protocol};
  }
  if(draft.status!=='UNKNOWN')throw Error('Consulta somente para documento fiscal indeterminado');
  const {meta,manifest}=verifyReady(draft);
  const signedPath=path.join(dir,meta.reference+'.signed.xml');
  if(!fs.existsSync(signedPath))throw Error('Sem XML assinado local; reconciliação fiscal manual obrigatória');
  const xml=fs.readFileSync(signedPath,'utf8');
  const key=/\bNFe([0-9]{44})\b/.exec(xml)?.[1];
  if(!key)throw Error('Chave do XML assinado inválida');
  try{
   const result=await adapter.query({type:manifest.documentType,reference:meta.reference,
    environment:'homologation',accessKey:key});
   if(result?.ok&&result.data.chave_nfe===key)return authorized(id,result);
  }catch{/* UNKNOWN persists. */}
  return {id,status:'UNKNOWN',requiresConsultation:true};
 }
 return Object.freeze({prepare,issue,consult});
}
module.exports={createFiscalIssuanceService};
