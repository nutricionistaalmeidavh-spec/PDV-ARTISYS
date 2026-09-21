'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { renderDanfeNfce } = require('./danfe-nfce-renderer');

const EXTERNAL_CHECKS = Object.freeze([
  ['certificate','Certificado A1 valido'],
  ['csc','CSC NFC-e configurado'],
  ['sidecar','Sidecar fiscal local acessivel'],
  ['sefaz','SEFAZ acessivel'],
  ['homologation_authorized','NFC-e autorizada em homologacao'],
  ['homologation_cancelled','Cancelamento confirmado em homologacao'],
  ['danfe_print','DANFE NFC-e impresso e conferido'],
  ['backup','Backup fiscal conferido']
]);
const EXTERNAL_KEYS = new Set(EXTERNAL_CHECKS.map(([key]) => key));
const SENSITIVE_KEYS = /password|passphrase|token|secret|csc$|pfx|private|credential/i;

function parseJson(value, fallback = {}) { try { return JSON.parse(value || '{}'); } catch { return fallback; } }
function requireManager(actor = {}) { if (!['admin','manager'].includes(String(actor.role || ''))) throw new Error('Permissao insuficiente para operacao fiscal.'); }
function requireAdmin(actor = {}) { if (String(actor.role || '') !== 'admin') throw new Error('Somente administrador pode ativar ou desativar producao fiscal.'); }
function actorId(actor = {}) { return String(actor.userId || actor.id || actor.role || 'system').slice(0,120); }
function cleanReason(value) { const text=String(value||'').trim().replace(/\s+/g,' ');if(text.length<15||text.length>255)throw new Error('Justificativa de contingencia deve conter entre 15 e 255 caracteres.');return text; }
function sanitize(value, depth = 0) {
  if (depth > 5) return '[TRUNCATED]';
  if (Array.isArray(value)) return value.slice(0,50).map(item => sanitize(item, depth + 1));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? value.slice(0,1000) : value;
  const out={};for(const [key,item] of Object.entries(value)){out[key]=SENSITIVE_KEYS.test(key)?'[REDACTED]':sanitize(item,depth+1);}return out;
}
function clone(value){return JSON.parse(JSON.stringify(value));}

function createFiscalProductionService({
  db,
  fiscalConfiguration,
  fiscal,
  printing = null,
  backups = null,
  fiscalProviderResolver = async () => null,
  now = () => new Date().toISOString(),
  idFactory = prefix => `${prefix}-${randomUUID()}`
} = {}) {
  if (!db || !fiscalConfiguration || !fiscal) throw new TypeError('Database, fiscal configuration and fiscal service are required.');
  if (typeof fiscalProviderResolver !== 'function') throw new TypeError('fiscalProviderResolver must be a function.');

  // A queda do processo no meio do envio nunca autoriza retry cego.
  db.prepare("UPDATE fiscal_contingency SET status='RECONCILING',last_error=COALESCE(last_error,'Processo reiniciado durante transmissao; reconciliacao obrigatoria.'),updated_at=? WHERE status='TRANSMITTING'").run(now());

  function getActivation(){
    const row=db.prepare("SELECT * FROM fiscal_production_activation WHERE id='default'").get();
    return row?{enabled:Boolean(row.enabled),activatedAt:row.activated_at,activatedBy:row.activated_by,deactivatedAt:row.deactivated_at,deactivatedBy:row.deactivated_by,updatedAt:row.updated_at}: {enabled:false,activatedAt:null,activatedBy:null,deactivatedAt:null,deactivatedBy:null,updatedAt:null};
  }

  function evidenceMap(){
    const map=new Map();
    for(const row of db.prepare('SELECT * FROM fiscal_production_evidence ORDER BY check_key').all())map.set(row.check_key,{key:row.check_key,passed:Boolean(row.passed),message:row.message,metadata:parseJson(row.metadata_json,{}),checkedAt:row.checked_at,checkedBy:row.checked_by});
    return map;
  }

  function objectiveHomologation(){
    const authorized=Number(db.prepare("SELECT COUNT(*) AS count FROM fiscal_documents WHERE environment='homologation' AND lifecycle_status IN ('AUTHORIZED','CANCELLED')").get()?.count||0)>0;
    const cancelled=Number(db.prepare("SELECT COUNT(*) AS count FROM fiscal_documents WHERE environment='homologation' AND lifecycle_status='CANCELLED'").get()?.count||0)>0;
    const danfe=Number(db.prepare("SELECT COUNT(*) AS count FROM fiscal_documents WHERE danfe_print_job_id IS NOT NULL").get()?.count||0)>0;
    return {authorized,cancelled,danfe};
  }

  function getReadiness(){
    const settings=fiscalConfiguration.getCompanySettings();
    const evidence=evidenceMap();
    const checks=[];
    const push=(key,label,passed,message,source='computed',checkedAt=null)=>checks.push({key,label,passed:Boolean(passed),message:String(message||''),source,checkedAt});
    const companyReady=Boolean(settings&&settings.cnpj&&settings.stateRegistration&&settings.crt&&settings.series&&settings.address?.cityCode&&settings.address?.state);
    push('company','Cadastro fiscal da empresa',companyReady,companyReady?'Cadastro fiscal completo.':'Preencha CNPJ, IE, CRT, serie e endereco fiscal.');
    const activeProducts=Number(db.prepare('SELECT COUNT(*) AS count FROM products WHERE active=1').get()?.count||0);
    const coveredProducts=Number(db.prepare("SELECT COUNT(*) AS count FROM products p JOIN product_fiscal_data pfd ON pfd.product_id=p.id JOIN fiscal_profiles fp ON fp.id=pfd.fiscal_profile_id WHERE p.active=1 AND fp.active=1").get()?.count||0);
    const coverageReady=activeProducts===coveredProducts;
    push('product_coverage','Cobertura tributaria dos produtos',coverageReady,coverageReady?`${coveredProducts}/${activeProducts} produtos cobertos.`:`${coveredProducts}/${activeProducts} produtos ativos possuem perfil fiscal.`);
    const sequence=settings?fiscalConfiguration.getSequence({documentType:settings.documentType,environment:'production',series:settings.series}):null;
    push('production_sequence','Sequencia fiscal de producao',Boolean(sequence),sequence?`Proximo numero: ${sequence.nextNumber}.`:'Inicialize a serie/sequencia de producao.');

    const certificate=fiscalConfiguration.getCertificateMetadata();
    const validTo=certificate?.validTo?Date.parse(certificate.validTo):NaN;
    const certificateObjective=Boolean(certificate&&Number.isFinite(validTo)&&validTo>Date.now());
    const hom=objectiveHomologation();
    for(const [key,label] of EXTERNAL_CHECKS){
      const row=evidence.get(key);let objective=false;
      if(key==='certificate')objective=certificateObjective;
      if(key==='homologation_authorized')objective=hom.authorized;
      if(key==='homologation_cancelled')objective=hom.cancelled;
      if(key==='danfe_print')objective=hom.danfe;
      const passed=objective||Boolean(row?.passed);
      push(key,label,passed,passed?(objective?'Evidencia objetiva encontrada.':row?.message||'Evidencia registrada.'):(row?.message||'Evidencia obrigatoria ainda nao confirmada.'),objective?'computed':(row?'evidence':'missing'),row?.checkedAt||null);
    }
    const activation=getActivation();
    return {ready:checks.every(item=>item.passed),enabled:activation.enabled,checks,blockers:checks.filter(item=>!item.passed).map(item=>item.key),settings:settings?{provider:settings.provider,documentType:settings.documentType,environment:settings.environment,autoIssue:settings.autoIssue,cnpj:settings.cnpj,legalName:settings.legalName,tradeName:settings.tradeName,crt:settings.crt,series:settings.series,cscId:settings.cscId,address:settings.address}:null,activation};
  }

  function recordEvidence(key,input={},actor={}){
    requireManager(actor);const safeKey=String(key||'').trim();if(!EXTERNAL_KEYS.has(safeKey))throw new Error('Item de evidencia fiscal invalido.');
    const timestamp=now();const passed=Boolean(input.passed);const message=String(input.message||'').trim().slice(0,1000)||null;const metadata=sanitize(input.metadata&&typeof input.metadata==='object'?input.metadata:{});
    db.prepare(`INSERT INTO fiscal_production_evidence(check_key,passed,message,metadata_json,checked_at,checked_by) VALUES(?,?,?,?,?,?)
      ON CONFLICT(check_key) DO UPDATE SET passed=excluded.passed,message=excluded.message,metadata_json=excluded.metadata_json,checked_at=excluded.checked_at,checked_by=excluded.checked_by`)
      .run(safeKey,passed?1:0,message,JSON.stringify(metadata),timestamp,actorId(actor));
    writeAudit(db,{action:'fiscal.production.evidence',entity:'fiscal-production',entityId:safeKey,actor,context:{passed,message}},now);
    return getReadiness();
  }

  function activateProduction(actor={}){
    requireAdmin(actor);const readiness=getReadiness();if(!readiness.ready)throw new Error(`Ativacao de producao bloqueada por pendencias: ${readiness.blockers.join(', ')}.`);
    const timestamp=now();const settings=fiscalConfiguration.getCompanySettings();if(!settings)throw new Error('Configuracao fiscal ausente.');
    withTransaction(db,()=>{
      db.prepare(`INSERT INTO fiscal_production_activation(id,enabled,activated_at,activated_by,deactivated_at,deactivated_by,check_snapshot_json,updated_at)
        VALUES('default',1,?,?,NULL,NULL,?,?) ON CONFLICT(id) DO UPDATE SET enabled=1,activated_at=excluded.activated_at,activated_by=excluded.activated_by,deactivated_at=NULL,deactivated_by=NULL,check_snapshot_json=excluded.check_snapshot_json,updated_at=excluded.updated_at`)
        .run(timestamp,actorId(actor),JSON.stringify(readiness.checks),timestamp);
      db.prepare("UPDATE fiscal_company_settings SET environment='production',auto_issue=0,updated_at=? WHERE id='default'").run(timestamp);
      writeAudit(db,{action:'fiscal.production.activate',entity:'fiscal-production',entityId:'default',actor,context:{provider:settings.provider,series:settings.series,autoIssue:false}},now);
    });
    return getActivation();
  }

  function deactivateProduction(actor={}){
    requireAdmin(actor);const timestamp=now();
    withTransaction(db,()=>{
      db.prepare(`INSERT INTO fiscal_production_activation(id,enabled,deactivated_at,deactivated_by,check_snapshot_json,updated_at)
        VALUES('default',0,?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=0,deactivated_at=excluded.deactivated_at,deactivated_by=excluded.deactivated_by,updated_at=excluded.updated_at`)
        .run(timestamp,actorId(actor),'{}',timestamp);
      db.prepare("UPDATE fiscal_company_settings SET environment='homologation',auto_issue=0,updated_at=? WHERE id='default'").run(timestamp);
      writeAudit(db,{action:'fiscal.production.deactivate',entity:'fiscal-production',entityId:'default',actor,context:{}},now);
    });
    return getActivation();
  }

  function mapContingency(row,{includeXml=false}={}){
    if(!row)return null;const document=parseJson(row.document_json,{});return{fiscalDocumentId:row.fiscal_document_id,status:row.status,reason:row.reason,enteredAt:row.entered_at,tpEmis:row.tp_emis,document,hasGeneratedXml:Boolean(row.generated_xml),...(includeXml?{generatedXml:row.generated_xml||null}:{}),accessKey:row.access_key||null,transmissionAttempts:Number(row.transmission_attempts||0),lastAttemptAt:row.last_attempt_at,lastError:row.last_error,resolvedAt:row.resolved_at,updatedAt:row.updated_at};
  }
  function getContingency(documentId,options={}){return mapContingency(db.prepare('SELECT * FROM fiscal_contingency WHERE fiscal_document_id=?').get(String(documentId)),options);}
  function listContingencies({status=null}={}){const rows=status?db.prepare('SELECT * FROM fiscal_contingency WHERE status=? ORDER BY entered_at DESC').all(String(status).toUpperCase()):db.prepare('SELECT * FROM fiscal_contingency ORDER BY entered_at DESC').all();return rows.map(row=>mapContingency(row));}

  function recordFiscalEvent(documentId,eventType,status,metadata={}){
    db.prepare(`INSERT INTO fiscal_document_events(id,fiscal_document_id,event_type,status,metadata_json,created_at) VALUES(?,?,?,?,?,?)`)
      .run(String(idFactory('fiscal-event')),String(documentId),String(eventType),String(status||''),JSON.stringify(sanitize(metadata)),now());
  }

  function enterContingency(documentId,{reason,actor={}}={}){
    requireManager(actor);const doc=fiscal.getDocument(documentId);if(!doc)throw new Error('Documento fiscal nao encontrado.');if(doc.documentType!=='nfce')throw new Error('Contingencia offline deste bloco aceita somente NFC-e.');
    if(doc.lifecycleStatus==='UNKNOWN')throw new Error('Documento UNKNOWN exige reconciliacao antes de qualquer contingencia.');
    if(doc.lifecycleStatus!=='PENDING'||Number(doc.attemptCount||0)!==0)throw new Error('Contingencia somente pode iniciar antes da primeira tentativa de transmissao online.');
    const existing=getContingency(documentId);if(existing)return existing;
    const safeReason=cleanReason(reason);const timestamp=now();const payload=clone(doc.requestPayload||{});if(!payload||payload.documentType!=='nfce')throw new Error('Payload NFC-e canonico ausente.');
    payload.contingency={type:'offline',tpEmis:'9',enteredAt:timestamp,reason:safeReason};
    withTransaction(db,()=>{
      db.prepare(`INSERT INTO fiscal_contingency(fiscal_document_id,status,reason,entered_at,tp_emis,document_json,generated_xml,access_key,transmission_attempts,updated_at) VALUES(?,'ISSUED',?,?, '9',?,NULL,NULL,0,?)`)
        .run(String(documentId),safeReason,timestamp,JSON.stringify(payload),timestamp);
      db.prepare("UPDATE fiscal_documents SET contingency_type='offline',updated_at=? WHERE id=?").run(timestamp,String(documentId));
      recordFiscalEvent(documentId,'CONTINGENCY_ISSUED','PENDING',{reason:safeReason,tpEmis:'9'});
      writeAudit(db,{action:'fiscal.contingency.enter',entity:'fiscal-document',entityId:String(documentId),actor,context:{reason:safeReason,tpEmis:'9'}},now);
    });
    return getContingency(documentId);
  }

  async function resolveProvider(doc){const provider=await fiscalProviderResolver(doc);if(!provider)throw new Error('Provedor fiscal local indisponivel.');return provider;}

  async function prepareContingency(documentId,{actor={}}={}){
    requireManager(actor);const entry=getContingency(documentId,{includeXml:true});if(!entry)throw new Error('Contingencia fiscal nao encontrada.');if(entry.status==='RECONCILING')throw new Error('Contingencia em reconciliacao; nao gere novo XML.');
    if(entry.generatedXml)return getContingency(documentId);
    const doc=fiscal.getDocument(documentId);const provider=await resolveProvider(doc);if(typeof provider.createContingency!=='function')throw new Error('Provedor fiscal nao suporta geracao offline de contingencia.');
    const result=await provider.createContingency(doc.reference,entry.document,doc.documentType);if(!result?.ok){if(result?.indeterminate)throw new Error('Geracao local de contingencia ficou indeterminada; confira o ACBr antes de prosseguir.');throw new Error(result?.error||'Falha ao gerar XML de contingencia.');}
    const xml=String(result.data?.xml||'').trim();if(!xml)throw new Error('ACBr nao retornou XML assinado da contingencia.');const key=String(result.data?.chave||result.data?.accessKey||'').trim()||null;
    db.prepare('UPDATE fiscal_contingency SET generated_xml=?,access_key=?,updated_at=?,last_error=NULL WHERE fiscal_document_id=?').run(xml,key,now(),String(documentId));
    recordFiscalEvent(documentId,'CONTINGENCY_XML_SIGNED','PENDING',{accessKey:key});
    if(printing){
      const publicDoc={...doc,accessKey:key||doc.accessKey,lifecycleStatus:'CONTINGENCY',requestPayload:entry.document};
      const text=renderDanfeNfce({document:publicDoc,width:42,allowContingency:true});
      printing.queueJob({type:'DANFE_NFCE',entityType:'fiscal-document',entityId:doc.id,payload:{text,width:42,documentType:'nfce',accessKey:key,contingency:true},actor});
    }
    writeAudit(db,{action:'fiscal.contingency.prepare',entity:'fiscal-document',entityId:String(documentId),actor,context:{hasXml:true,accessKey:key}},now);
    return getContingency(documentId);
  }

  async function transmitContingency(documentId,{actor={}}={}){
    requireManager(actor);const entry=getContingency(documentId,{includeXml:true});if(!entry)throw new Error('Contingencia fiscal nao encontrada.');if(entry.status==='RECONCILING')throw new Error('Contingencia exige reconciliacao; retransmissao cega bloqueada.');if(!['ISSUED','FAILED'].includes(entry.status))throw new Error('Contingencia nao esta disponivel para transmissao.');if(!entry.generatedXml)throw new Error('XML assinado da contingencia ainda nao foi gerado.');
    const doc=fiscal.getDocument(documentId);if(doc.lifecycleStatus==='UNKNOWN')throw new Error('Documento UNKNOWN exige reconciliacao; retransmissao bloqueada.');
    const provider=await resolveProvider(doc);if(typeof provider.sendContingency!=='function')throw new Error('Provedor fiscal nao suporta transmissao de contingencia.');const timestamp=now();
    db.prepare("UPDATE fiscal_contingency SET status='TRANSMITTING',transmission_attempts=transmission_attempts+1,last_attempt_at=?,last_error=NULL,updated_at=? WHERE fiscal_document_id=?").run(timestamp,timestamp,String(documentId));
    fiscal.markProcessing(documentId,actor);
    let result;try{result=await provider.sendContingency(doc.reference,{xml:entry.generatedXml,payload:entry.document},doc.documentType);}catch(error){result={ok:false,status:0,indeterminate:true,error:error?.message||String(error)};}
    if(result?.ok){fiscal.markAuthorized(documentId,result,actor);db.prepare("UPDATE fiscal_contingency SET status='RESOLVED',resolved_at=?,updated_at=?,last_error=NULL WHERE fiscal_document_id=?").run(now(),now(),String(documentId));recordFiscalEvent(documentId,'CONTINGENCY_AUTHORIZED','AUTHORIZED',{accessKey:result.data?.chave||entry.accessKey});}
    else if(result?.indeterminate){fiscal.markUnknown(documentId,result,actor);db.prepare("UPDATE fiscal_contingency SET status='RECONCILING',last_error=?,updated_at=? WHERE fiscal_document_id=?").run(String(result.error||'Resultado indeterminado.'),now(),String(documentId));recordFiscalEvent(documentId,'CONTINGENCY_UNKNOWN','UNKNOWN',{});}
    else if(Number(result?.data?.cStat)>0){fiscal.markRejected(documentId,result,actor);db.prepare("UPDATE fiscal_contingency SET status='RESOLVED',resolved_at=?,last_error=?,updated_at=? WHERE fiscal_document_id=?").run(now(),String(result.error||'Rejeitada.'),now(),String(documentId));recordFiscalEvent(documentId,'CONTINGENCY_REJECTED','REJECTED',{cStat:result.data?.cStat});}
    else{fiscal.markFailed(documentId,result,actor);db.prepare("UPDATE fiscal_contingency SET status='FAILED',last_error=?,updated_at=? WHERE fiscal_document_id=?").run(String(result?.error||'Falha de transmissao.'),now(),String(documentId));recordFiscalEvent(documentId,'CONTINGENCY_FAILED','FAILED',{});}
    return {contingency:getContingency(documentId),document:fiscal.getDocument(documentId)};
  }

  function reconcileContingency(documentId,{actor={}}={}){
    requireManager(actor);const entry=getContingency(documentId);if(!entry)throw new Error('Contingencia fiscal nao encontrada.');if(entry.status!=='RECONCILING')throw new Error('Somente contingencia RECONCILING pode solicitar reconciliacao.');const document=fiscal.getDocument(documentId);if(document.lifecycleStatus!=='UNKNOWN')throw new Error('Documento fiscal precisa estar UNKNOWN para reconciliacao da contingencia.');return fiscal.requestReconcile(documentId,{actor});
  }

  return Object.freeze({getActivation,getReadiness,recordEvidence,activateProduction,deactivateProduction,getContingency,listContingencies,enterContingency,prepareContingency,transmitContingency,reconcileContingency});
}

module.exports={EXTERNAL_CHECKS,createFiscalProductionService};