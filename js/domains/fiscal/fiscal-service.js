'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { validateConnection, validateReference } = require('./fiscal-core');
const { assertFiscalTransition, legacyStatusFor } = require('./fiscal-state-machine');

function parseJson(value, fallback = {}) { try { return JSON.parse(value || '{}'); } catch { return fallback; } }
function legacyLifecycle(status){return status==='ISSUED'?'AUTHORIZED':status==='CANCELLED'?'CANCELLED':status==='FAILED'?'FAILED':'PENDING';}
function pickData(result={}){return result.data&&typeof result.data==='object'?result.data:{};}
function sefazCode(result={}){const value=pickData(result).cStat;return value===null||value===undefined?null:String(value);}
function sefazMessage(result={}){const data=pickData(result);return String(data.xMotivo||data.mensagem||data.message||result.error||'').slice(0,4000)||null;}

function createFiscalService({ db, outbox, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}` } = {}) {
  if (!db || !outbox) throw new TypeError('Database and outbox are required.');
  const hasLifecycle=Boolean(db.prepare("SELECT 1 FROM pragma_table_info('fiscal_documents') WHERE name='lifecycle_status'").get());
  const hasEventTable=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fiscal_document_events'").get());

  function mapDocument(row) {
    if (!row) return null;
    const metadata = parseJson(row.response_json, {});
    return {
      id:row.id,saleId:row.sale_id,provider:row.provider,documentType:row.document_type,environment:row.environment,reference:row.reference,
      status:row.status,lifecycleStatus:hasLifecycle?(row.lifecycle_status||legacyLifecycle(row.status)):legacyLifecycle(row.status),
      attemptCount:hasLifecycle?Number(row.attempt_count||0):0,reconcileRequired:hasLifecycle?Boolean(row.reconcile_required):false,
      processingStartedAt:hasLifecycle?row.processing_started_at:null,lastTransitionAt:hasLifecycle?row.last_transition_at:null,
      lastReconciledAt:hasLifecycle?row.last_reconciled_at:null,lastReconcileStatus:hasLifecycle?row.last_reconcile_status:null,
      accessKey:row.access_key,number:row.number,series:row.series,issuedAt:row.issued_at,cancelledAt:row.cancelled_at,lastError:row.last_error,
      authorizationProtocol:row.authorization_protocol||null,xmlPath:row.xml_path||null,danfePath:row.danfe_path||null,
      authorizedAt:row.authorized_at||row.issued_at||null,rejectedAt:row.rejected_at||null,sefazCode:row.sefaz_code||null,sefazMessage:row.sefaz_message||null,
      requestPayload:metadata.requestPayload||{},providerResponse:metadata.providerResponse||null,createdAt:row.created_at,updatedAt:row.updated_at
    };
  }
  function getDocument(id){return mapDocument(db.prepare('SELECT * FROM fiscal_documents WHERE id=?').get(String(id)));}
  function getByReference(reference){return mapDocument(db.prepare('SELECT * FROM fiscal_documents WHERE reference=?').get(validateReference(reference)));}
  function requireDocument(id){const row=db.prepare('SELECT * FROM fiscal_documents WHERE id=?').get(String(id));if(!row)throw new Error('Documento fiscal nao encontrado.');return row;}
  function currentState(row){return hasLifecycle?(row.lifecycle_status||legacyLifecycle(row.status)):legacyLifecycle(row.status);}
  function requireSale(saleId){const row=db.prepare('SELECT * FROM sales WHERE id=?').get(String(saleId));if(!row)throw new Error('Venda nao encontrada para emissao fiscal.');if(row.status!=='COMPLETED')throw new Error('Somente venda concluida pode gerar documento fiscal.');return row;}
  function eventEnvelope({type,documentId,actor={},mutationId=null,payload={}}){return{eventId:String(idFactory('event')),type,aggregate:'fiscal-document',aggregateId:String(documentId),occurredAt:now(),actor:actor&&typeof actor==='object'?actor:{},source:'server',mutationId:mutationId||null,payload};}
  function recordEvent(documentId,{eventType,status=null,result=null,metadata={}}={}){
    if(!hasEventTable)return;
    const data=pickData(result||{});const timestamp=now();
    db.prepare(`INSERT INTO fiscal_document_events(id,fiscal_document_id,event_type,status,sefaz_code,sefaz_message,protocol,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(String(idFactory('fiscal-event')),String(documentId),String(eventType||'STATE_CHANGED'),status?String(status):null,sefazCode(result||{}),sefazMessage(result||{}),data.protocolo||data.nProt||null,JSON.stringify(metadata&&typeof metadata==='object'?metadata:{}),timestamp);
  }

  function requestIssue(input={}){
    const connection=validateConnection(input);const sale=requireSale(input.saleId);const reference=validateReference(input.reference||sale.sale_number);
    const requestPayload=input.payload&&typeof input.payload==='object'?input.payload:{};const actor=input.actor&&typeof input.actor==='object'?input.actor:{};
    return withTransaction(db,()=>{
      const existing=getByReference(reference);if(existing)return existing;
      const id=String(input.id||idFactory('fiscal'));const timestamp=now();
      db.prepare(`INSERT INTO fiscal_documents(id,sale_id,provider,document_type,environment,reference,status,response_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'PENDING',?,?,?)`)
        .run(id,String(input.saleId),connection.provider,connection.documentType,connection.environment,reference,JSON.stringify({requestPayload,providerResponse:null}),timestamp,timestamp);
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET lifecycle_status='PENDING',last_transition_at=? WHERE id=?").run(timestamp,id);
      recordEvent(id,{eventType:'ISSUE_REQUESTED',status:'PENDING'});
      outbox.insert(eventEnvelope({type:'fiscal.issue-requested',documentId:id,actor,mutationId:input.mutationId||null,payload:{saleId:String(input.saleId),provider:connection.provider,documentType:connection.documentType,environment:connection.environment,reference}}));
      writeAudit(db,{action:'fiscal.issue.request',entity:'fiscal-document',entityId:id,actor,context:{saleId:String(input.saleId),provider:connection.provider,documentType:connection.documentType,environment:connection.environment,reference}},now);
      return getDocument(id);
    });
  }

  function retryIssue(id,{actor={},mutationId=null}={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);const state=currentState(row);
      if(state==='REJECTED')throw new Error('Documento fiscal rejeitado exige correcao fiscal; nao pode ser reenviado como o mesmo documento.');
      if(state==='UNKNOWN'&&hasLifecycle&&Boolean(row.reconcile_required))throw new Error('Documento fiscal UNKNOWN exige reconciliacao antes de qualquer reenvio.');
      if(state==='UNKNOWN'&&hasLifecycle&&row.last_reconcile_status!=='NOT_FOUND')throw new Error('Documento fiscal UNKNOWN exige reconciliacao conclusiva antes do reenvio.');
      if(!['FAILED','PENDING','UNKNOWN'].includes(state))throw new Error('Somente documento pendente, com falha ou UNKNOWN reconciliado como nao encontrado pode ser reenviado.');
      if(hasLifecycle)assertFiscalTransition(state,'PENDING');
      const timestamp=now();
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET status='PENDING',lifecycle_status='PENDING',reconcile_required=0,last_error=NULL,last_transition_at=?,updated_at=? WHERE id=?").run(timestamp,timestamp,String(id));
      else db.prepare("UPDATE fiscal_documents SET status='PENDING',last_error=NULL,updated_at=? WHERE id=?").run(timestamp,String(id));
      recordEvent(id,{eventType:'RETRY_REQUESTED',status:'PENDING'});
      outbox.insert(eventEnvelope({type:'fiscal.issue-requested',documentId:String(id),actor,mutationId,payload:{saleId:row.sale_id,provider:row.provider,documentType:row.document_type,environment:row.environment,reference:row.reference,retry:true}}));
      writeAudit(db,{action:'fiscal.issue.retry',entity:'fiscal-document',entityId:String(id),actor,context:{reference:row.reference}},now);
      return getDocument(id);
    });
  }

  function saveProviderResponse(id,{status,data=null,error=null}={}){
    const row=requireDocument(id);const current=parseJson(row.response_json,{});const metadata={requestPayload:current.requestPayload||{},providerResponse:data};
    db.prepare('UPDATE fiscal_documents SET response_json=?,last_error=?,updated_at=? WHERE id=?').run(JSON.stringify(metadata),error?String(error).slice(0,4000):null,now(),String(id));
    return{...getDocument(id),statusCode:status||null};
  }

  function markProcessing(id,actor={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);const state=currentState(row);if(['AUTHORIZED','CANCELLED'].includes(state))return getDocument(id);
      if(hasLifecycle)assertFiscalTransition(state,'PROCESSING');const timestamp=now();
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET status='PENDING',lifecycle_status='PROCESSING',attempt_count=attempt_count+1,processing_started_at=?,reconcile_required=0,last_transition_at=?,updated_at=? WHERE id=?").run(timestamp,timestamp,timestamp,String(id));
      recordEvent(id,{eventType:'PROCESSING',status:'PROCESSING'});
      writeAudit(db,{action:'fiscal.state.processing',entity:'fiscal-document',entityId:String(id),actor,context:{reference:row.reference}},now);
      return getDocument(id);
    });
  }

  function markAuthorized(id,result={},actor={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);const state=currentState(row);if(state==='AUTHORIZED')return getDocument(id);if(hasLifecycle)assertFiscalTransition(state,'AUTHORIZED');
      const data=pickData(result);saveProviderResponse(id,{status:result.status,data,error:null});const timestamp=now();
      const key=data.chave_nfe||data.chave_nfce||data.chave||data.chDFe||row.access_key||null;const protocol=data.protocolo||data.nProt||null;
      if(hasLifecycle)db.prepare(`UPDATE fiscal_documents SET status='ISSUED',lifecycle_status='AUTHORIZED',access_key=?,number=?,series=?,issued_at=?,authorized_at=?,authorization_protocol=?,xml_path=COALESCE(?,xml_path),sefaz_code=?,sefaz_message=?,reconcile_required=0,last_reconciled_at=CASE WHEN ?='UNKNOWN' THEN ? ELSE last_reconciled_at END,last_reconcile_status=CASE WHEN ?='UNKNOWN' THEN 'AUTHORIZED' ELSE last_reconcile_status END,last_error=NULL,last_transition_at=?,updated_at=? WHERE id=?`)
        .run(key,data.numero!=null?String(data.numero):row.number,data.serie!=null?String(data.serie):row.series,timestamp,timestamp,protocol,data.xmlPath||data.xml_path||null,sefazCode(result),sefazMessage(result),state,timestamp,state,timestamp,timestamp,String(id));
      else db.prepare("UPDATE fiscal_documents SET status='ISSUED',access_key=?,number=?,series=?,issued_at=?,last_error=NULL,updated_at=? WHERE id=?").run(key,data.numero!=null?String(data.numero):null,data.serie!=null?String(data.serie):null,timestamp,timestamp,String(id));
      recordEvent(id,{eventType:'AUTHORIZED',status:'AUTHORIZED',result});
      outbox.insert(eventEnvelope({type:'fiscal.issued',documentId:String(id),actor,payload:{saleId:row.sale_id,reference:row.reference,accessKey:key}}));
      return getDocument(id);
    });
  }

  function markRejected(id,result={},actor={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);const state=currentState(row);if(state==='REJECTED')return getDocument(id);if(hasLifecycle)assertFiscalTransition(state,'REJECTED');
      const message=sefazMessage(result)||'Documento fiscal rejeitado.';saveProviderResponse(id,{status:result.status,data:result.data||null,error:message});const timestamp=now();
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET status='FAILED',lifecycle_status='REJECTED',rejected_at=?,sefaz_code=?,sefaz_message=?,reconcile_required=0,last_error=?,last_transition_at=?,updated_at=? WHERE id=?").run(timestamp,sefazCode(result),message,message,timestamp,timestamp,String(id));
      else db.prepare("UPDATE fiscal_documents SET status='FAILED',last_error=?,updated_at=? WHERE id=?").run(message,timestamp,String(id));
      recordEvent(id,{eventType:'REJECTED',status:'REJECTED',result});
      outbox.insert(eventEnvelope({type:'fiscal.rejected',documentId:String(id),actor,payload:{saleId:row.sale_id,reference:row.reference,sefazCode:sefazCode(result),message}}));
      return getDocument(id);
    });
  }

  function markUnknown(id,result={},actor={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);const state=currentState(row);if(hasLifecycle)assertFiscalTransition(state,'UNKNOWN');
      const message=sefazMessage(result)||'Resultado fiscal indeterminado; reconciliacao obrigatoria.';saveProviderResponse(id,{status:result.status,data:result.data||null,error:message});const timestamp=now();
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET status='FAILED',lifecycle_status='UNKNOWN',reconcile_required=1,sefaz_code=?,sefaz_message=?,last_error=?,last_transition_at=?,updated_at=? WHERE id=?").run(sefazCode(result),message,message,timestamp,timestamp,String(id));
      else db.prepare("UPDATE fiscal_documents SET status='FAILED',last_error=?,updated_at=? WHERE id=?").run(message,timestamp,String(id));
      recordEvent(id,{eventType:'UNKNOWN',status:'UNKNOWN',result});
      outbox.insert(eventEnvelope({type:'fiscal.unknown',documentId:String(id),actor,payload:{saleId:row.sale_id,reference:row.reference,error:message}}));
      return getDocument(id);
    });
  }

  function markFailed(id,result={},actor={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);const state=currentState(row);if(hasLifecycle)assertFiscalTransition(state,'FAILED');
      const message=String(result.error||result.data?.mensagem||result.data?.message||'Falha na emissao fiscal.').slice(0,4000);saveProviderResponse(id,{status:result.status,data:result.data||null,error:message});const timestamp=now();
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET status='FAILED',lifecycle_status='FAILED',reconcile_required=0,last_error=?,last_transition_at=?,updated_at=? WHERE id=?").run(message,timestamp,timestamp,String(id));
      else db.prepare("UPDATE fiscal_documents SET status='FAILED',last_error=?,updated_at=? WHERE id=?").run(message,timestamp,String(id));
      recordEvent(id,{eventType:'FAILED',status:'FAILED',result});
      outbox.insert(eventEnvelope({type:'fiscal.failed',documentId:String(id),actor,payload:{saleId:row.sale_id,reference:row.reference,error:message}}));
      return getDocument(id);
    });
  }

  function requestReconcile(id,{actor={},mutationId=null}={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);const state=currentState(row);if(state!=='UNKNOWN')throw new Error('Somente documento fiscal UNKNOWN pode ser reconciliado.');
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET reconcile_required=1,updated_at=? WHERE id=?").run(now(),String(id));
      recordEvent(id,{eventType:'RECONCILE_REQUESTED',status:'UNKNOWN'});
      outbox.insert(eventEnvelope({type:'fiscal.reconcile-requested',documentId:String(id),actor,mutationId,payload:{saleId:row.sale_id,provider:row.provider,documentType:row.document_type,environment:row.environment,reference:row.reference}}));
      writeAudit(db,{action:'fiscal.reconcile.request',entity:'fiscal-document',entityId:String(id),actor,context:{reference:row.reference}},now);
      return getDocument(id);
    });
  }

  function markReconcileNotFound(id,result={},actor={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);if(currentState(row)!=='UNKNOWN')throw new Error('Reconciliacao NOT_FOUND exige documento UNKNOWN.');
      saveProviderResponse(id,{status:result.status,data:result.data||null,error:result.error||null});const timestamp=now();
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET reconcile_required=0,last_reconciled_at=?,last_reconcile_status='NOT_FOUND',sefaz_code=?,sefaz_message=?,last_transition_at=?,updated_at=? WHERE id=?").run(timestamp,sefazCode(result),sefazMessage(result),timestamp,timestamp,String(id));
      recordEvent(id,{eventType:'RECONCILED_NOT_FOUND',status:'UNKNOWN',result});
      writeAudit(db,{action:'fiscal.reconcile.not-found',entity:'fiscal-document',entityId:String(id),actor,context:{reference:row.reference}},now);
      return getDocument(id);
    });
  }

  function markReconcileUnknown(id,result={},actor={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);if(currentState(row)!=='UNKNOWN')throw new Error('Reconciliacao inconclusiva exige documento UNKNOWN.');const timestamp=now();
      saveProviderResponse(id,{status:result.status,data:result.data||null,error:result.error||null});
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET reconcile_required=1,last_reconciled_at=?,last_reconcile_status='UNKNOWN',sefaz_code=?,sefaz_message=?,updated_at=? WHERE id=?").run(timestamp,sefazCode(result),sefazMessage(result),timestamp,String(id));
      recordEvent(id,{eventType:'RECONCILED_UNKNOWN',status:'UNKNOWN',result});
      return getDocument(id);
    });
  }

  function markCancelled(id,result={},actor={}){
    return withTransaction(db,()=>{
      const row=requireDocument(id);const state=currentState(row);if(hasLifecycle)assertFiscalTransition(state,'CANCELLED');saveProviderResponse(id,{status:result.status,data:result.data||null,error:null});const timestamp=now();
      if(hasLifecycle)db.prepare("UPDATE fiscal_documents SET status='CANCELLED',lifecycle_status='CANCELLED',cancelled_at=?,reconcile_required=0,last_error=NULL,last_transition_at=?,updated_at=? WHERE id=?").run(timestamp,timestamp,timestamp,String(id));
      else db.prepare("UPDATE fiscal_documents SET status='CANCELLED',cancelled_at=?,last_error=NULL,updated_at=? WHERE id=?").run(timestamp,timestamp,String(id));
      recordEvent(id,{eventType:'CANCELLED',status:'CANCELLED',result});
      outbox.insert(eventEnvelope({type:'fiscal.cancelled',documentId:String(id),actor,payload:{saleId:row.sale_id,reference:row.reference}}));return getDocument(id);
    });
  }

  function listDocuments(filters={}){const clauses=[];const params=[];if(filters.saleId){clauses.push('sale_id=?');params.push(String(filters.saleId));}if(filters.status){if(hasLifecycle&&Object.values(require('./fiscal-state-machine').FISCAL_STATES).includes(String(filters.status).toUpperCase())){clauses.push('lifecycle_status=?');params.push(String(filters.status).toUpperCase());}else{clauses.push('status=?');params.push(String(filters.status).toUpperCase());}}if(filters.documentType){clauses.push('document_type=?');params.push(String(filters.documentType).toLowerCase());}if(filters.environment){clauses.push('environment=?');params.push(String(filters.environment).toLowerCase());}return db.prepare(`SELECT * FROM fiscal_documents${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC`).all(...params).map(mapDocument);}
  function listEvents(id){if(!hasEventTable)return[];requireDocument(id);return db.prepare('SELECT * FROM fiscal_document_events WHERE fiscal_document_id=? ORDER BY created_at,id').all(String(id)).map(row=>({id:row.id,eventType:row.event_type,status:row.status,sefazCode:row.sefaz_code,sefazMessage:row.sefaz_message,protocol:row.protocol,metadata:parseJson(row.metadata_json,{}),createdAt:row.created_at}));}

  return {requestIssue,retryIssue,requestReconcile,getDocument,getByReference,listDocuments,listEvents,markProcessing,markAuthorized,markIssued:markAuthorized,markRejected,markUnknown,markFailed,markReconcileNotFound,markReconcileUnknown,markCancelled};
}

module.exports = { createFiscalService };
