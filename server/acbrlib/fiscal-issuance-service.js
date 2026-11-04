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

 db.exec(\`CREATE TABLE IF NOT EXISTS acbr_fiscal_cancellations(
  document_id TEXT PRIMARY KEY,justification TEXT NOT NULL,status TEXT NOT NULL
  CHECK(status IN('UNKNOWN','CANCELLED')),requested_at TEXT NOT NULL,
  event_protocol TEXT,c_stat INTEGER,confirmed_at TEXT);
 CREATE TABLE IF NOT EXISTS acbr_fiscal_inutilizations(
  id TEXT PRIMARY KEY,environment TEXT NOT NULL,year INTEGER NOT NULL,
  model INTEGER NOT NULL,series INTEGER NOT NULL,first_number INTEGER NOT NULL,
  last_number INTEGER NOT NULL,justification TEXT NOT NULL,status TEXT NOT NULL
  CHECK(status IN('UNKNOWN','CONFIRMED')),requested_at TEXT NOT NULL,
  event_protocol TEXT,confirmed_at TEXT);\`);
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
 async function danfe(id){
  const document=draftFor(id);
  if(document.status!=='AUTHORIZED')throw Error('DANFE só pode ser gerado após autorização fiscal confirmada');
  const record=metaFor(id);
  if(!record?.xml_sha256||!record?.access_key||!record?.protocol)
   throw Error('Documento sem protocolo de autorização fiscal');
  const xmlPath=path.join(dir,record.reference+'.authorized.xml');
  if(!fs.existsSync(xmlPath)||sha(fs.readFileSync(xmlPath))!==record.xml_sha256)
   throw Error('XML autorizado alterado ou indisponível');
  const pdfPath=path.join(dir,record.reference+'.danfe.pdf');
  const proofPath=path.join(dir,record.reference+'.danfe.json');
  if(fs.existsSync(pdfPath)){
   if(!fs.existsSync(proofPath))throw Error('PDF DANFE sem manifesto de integridade');
   const p=JSON.parse(fs.readFileSync(proofPath,'utf8'));
   const current=fs.readFileSync(pdfPath);
   if(p.xmlSha256!==record.xml_sha256||p.pdfSha256!==sha(current)||
      current.subarray(0,5).toString('ascii')!=='%PDF-')
    throw Error('Integridade do PDF DANFE comprometida');
   return {id,ready:true,reference:record.reference,sha256:p.pdfSha256};
  }
  if(typeof adapter.pdf!=='function')throw Error('ACBr nativa não possui renderizador de PDF DANFE');
  const result=await adapter.pdf({
   type:document.documentType,reference:record.reference,
   environment:'homologation',xmlPath,protocol:record.protocol
  });
  if(result?.ok!==true||!result.data?.pdfBase64)
   throw Error('ACBr não confirmou PDF DANFE');
  const encoded=String(result.data.pdfBase64);
  if(encoded.length>4*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
   throw Error('PDF fiscal Base64 inválido');
  const bytes=Buffer.from(encoded,'base64');
  if(bytes.length<16||bytes.length>3*1024*1024||
     bytes.subarray(0,5).toString('ascii')!=='%PDF-'||
     !bytes.toString('ascii',Math.max(0,bytes.length-128)).includes('%%EOF'))
   throw Error('DANFE não é um PDF válido gerado pela ACBr');
  const pdfSha256=sha(bytes);
  writeOnce(pdfPath,bytes);
  writeOnce(proofPath,Buffer.from(JSON.stringify({
   xmlSha256:record.xml_sha256,pdfSha256,reference:record.reference,
   accessKey:record.access_key,protocol:record.protocol
  }),'utf8'));
  return {id,ready:true,reference:record.reference,sha256:pdfSha256};
 }
 function getDanfe(id){
  const document=draftFor(id);
  if(document.status!=='AUTHORIZED')throw Error('DANFE não disponível: nota não autorizada');
  const meta=metaFor(id);
  if(!meta?.xml_sha256||!meta?.access_key||!meta?.protocol)
   throw Error('Protocolo ou XML fiscal indisponível');
  const pdfPath=path.join(dir,meta.reference+'.danfe.pdf'),proof=path.join(dir,meta.reference+'.danfe.json');
  if(!fs.existsSync(pdfPath)||!fs.existsSync(proof))
   throw Error('PDF DANFE ainda não foi gerado');
  const pdf=fs.readFileSync(pdfPath),data=JSON.parse(fs.readFileSync(proof,'utf8'));
  if(data.reference!==meta.reference||data.accessKey!==meta.access_key||
     data.protocol!==meta.protocol||data.xmlSha256!==meta.xml_sha256||
     data.pdfSha256!==sha(pdf)||pdf.length>3*1024*1024||
     pdf.subarray(0,5).toString('ascii')!=='%PDF-')
   throw Error('Integridade do DANFE PDF inválida');
  const original=fs.readFileSync(path.join(dir,meta.reference+'.authorized.xml'));
  if(sha(original)!==meta.xml_sha256)throw Error('XML autorizado não confere com DANFE');
  return pdf;
 }

 function justification(value){
  const reason=String(value||'').trim();
  if(reason.length<15||reason.length>255||/[\r\n\0]/.test(reason))
   throw Error('Justificativa fiscal deve conter de 15 a 255 caracteres sem quebras');
  return reason;
 }
 function getCancellationStatus(id){
  const row=db.prepare('SELECT * FROM acbr_fiscal_cancellations WHERE document_id=?').get(String(id));
  return row?{documentId:id,status:row.status,eventProtocol:row.event_protocol||null,
   cStat:row.c_stat||null,requestedAt:row.requested_at}:null;
 }
 async function cancel(id,{reason}={}){
  if(!allowHomologation)throw Error('Cancelamento somente em homologação habilitada');
  if(typeof adapter.cancel!=='function')throw Error('ACBr local não suporta cancelamento');
  const document=draftFor(id);
  if(document.status!=='AUTHORIZED')throw Error('Cancelamento exige nota autorizada');
  const meta=metaFor(id);
  if(!meta?.access_key||!meta.protocol||!meta.xml_sha256)
   throw Error('Nota sem protocolo autorizado verificável');
  const xmlPath=path.join(dir,meta.reference+'.authorized.xml');
  if(!fs.existsSync(xmlPath)||sha(fs.readFileSync(xmlPath))!==meta.xml_sha256)
   throw Error('XML autorizado alterado: cancelamento bloqueado');
  const text=justification(reason);
  if(getCancellationStatus(id))throw Error('Cancelamento anterior exige consulta, nunca reenvio');
  if(typeof adapter.status==='function'){
   const ready=await adapter.status();
   if(ready?.data?.ready===false)throw Error('ACBr local não pronta para cancelamento');
  }
  // Persist UNKNOWN before the native event is sent. Never retry a timeout.
  withTransaction(db,()=>db.prepare("INSERT INTO acbr_fiscal_cancellations(document_id,justification,status,requested_at) VALUES(?,?,'UNKNOWN',?)")
   .run(String(id),text,now()));
  let result=null;
  try{result=await adapter.cancel({type:document.documentType,reference:meta.reference,
   environment:'homologation',accessKey:meta.access_key,reason:text});}
  catch{/* Unknown official outcome remains durable. */}
  const d=result?.data;
  if(result?.ok===true&&d?.accessKey===meta.access_key&&[135,155].includes(Number(d.cStat))&&
    /^\d{10,20}$/.test(String(d.eventProtocol||''))){
   withTransaction(db,()=>{
    const changed=db.prepare("UPDATE acbr_fiscal_documents SET status='CANCELLED',updated_at=? WHERE id=? AND status='AUTHORIZED'")
     .run(now(),id).changes;
    if(changed!==1)throw Error('Estado fiscal mudou; cancelamento requer conciliação');
    db.prepare("UPDATE acbr_fiscal_cancellations SET status='CANCELLED',event_protocol=?,c_stat=?,confirmed_at=? WHERE document_id=? AND status='UNKNOWN'")
     .run(d.eventProtocol,Number(d.cStat),now(),id);
   });
   return {id,status:'CANCELLED',eventProtocol:d.eventProtocol,cStat:Number(d.cStat)};
  }
  return {id,status:'UNKNOWN',requiresManualReconciliation:true};
 }
 function listInutilizations(){
  return db.prepare('SELECT * FROM acbr_fiscal_inutilizations ORDER BY requested_at DESC LIMIT 100').all()
   .map(r=>({id:r.id,status:r.status,model:r.model,series:r.series,year:r.year,
    startNumber:r.first_number,endNumber:r.last_number,eventProtocol:r.event_protocol||null}));
 }
 async function inutilize({model,series,year,startNumber,endNumber,reason}={}){
  if(!allowHomologation)throw Error('Inutilização somente em homologação habilitada');
  if(typeof adapter.inutilize!=='function')throw Error('ACBr local não suporta inutilização');
  const company=drafts.getCompany();
  if(!company||company.environment!=='homologation')throw Error('Emitente fiscal não configurado');
  if(![55,65].includes(model)||series!==company.series||!Number.isSafeInteger(series)||
     !Number.isSafeInteger(year)||year!==Number(String(now()).slice(0,4))||
     !Number.isSafeInteger(startNumber)||startNumber<1||startNumber>999999999||
     !Number.isSafeInteger(endNumber)||endNumber<startNumber||endNumber-startNumber>99)
   throw Error('Faixa ou exercício fiscal inválido');
  const text=justification(reason),type=model===65?'nfce':'nfe';
  const sequence=db.prepare("SELECT next_number FROM acbr_fiscal_sequences WHERE document_type=? AND environment='homologation' AND series=?")
   .get(type,series);
  if(!sequence||sequence.next_number<=endNumber)
   throw Error('Faixa ainda não reservada no histórico fiscal');
  const used=db.prepare("SELECT count(*) AS n FROM acbr_fiscal_documents WHERE environment='homologation' AND model=? AND series=? AND number BETWEEN ? AND ?")
   .get(model,series,startNumber,endNumber);
  if(used.n>0)throw Error('Faixa contém documento fiscal utilizado');
  const overlap=db.prepare("SELECT 1 FROM acbr_fiscal_inutilizations WHERE environment='homologation' AND model=? AND series=? AND year=? AND first_number<=? AND last_number>=? LIMIT 1")
   .get(model,series,year,endNumber,startNumber);
  if(overlap)throw Error('Faixa anterior exige consulta, nunca reenvio');
  if(typeof adapter.status==='function'){
   const ready=await adapter.status();
   if(ready?.data?.ready===false)throw Error('ACBr local não pronta para inutilização');
  }
  const id=[year,model,series,startNumber,endNumber].join('-');
  // State is durable before any potential SEFAZ call.
  withTransaction(db,()=>db.prepare("INSERT INTO acbr_fiscal_inutilizations(id,environment,year,model,series,first_number,last_number,justification,status,requested_at) VALUES(?,'homologation',?,?,?,?,?,?,'UNKNOWN',?)")
   .run(id,year,model,series,startNumber,endNumber,text,now()));
  let result=null;
  try{result=await adapter.inutilize({environment:'homologation',issuerCnpj:company.cnpj,
   issuerUF:company.uf,model,series,year,startNumber,endNumber,reason:text});}
  catch{/* UNKNOWN persists; do not repeat. */}
  const d=result?.data;
  if(result?.ok===true&&d?.cStat===102&&d.model===model&&d.series===series&&
     d.year===year&&d.startNumber===startNumber&&d.endNumber===endNumber&&
     /^\d{10,20}$/.test(String(d.eventProtocol||''))){
    withTransaction(db,()=>db.prepare("UPDATE acbr_fiscal_inutilizations SET status='CONFIRMED',event_protocol=?,confirmed_at=? WHERE id=? AND status='UNKNOWN'")
     .run(d.eventProtocol,now(),id));
    return {id,status:'CONFIRMED',eventProtocol:d.eventProtocol};
  }
  return {id,status:'UNKNOWN',requiresManualReconciliation:true};
 }
 return Object.freeze({prepare,issue,consult,danfe,getDanfe,cancel,getCancellationStatus,inutilize,listInutilizations});
}
module.exports={createFiscalIssuanceService};
