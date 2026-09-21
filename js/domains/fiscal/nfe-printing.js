'use strict';
const {randomUUID}=require('node:crypto');
const {writeAudit}=require('../../core/audit-log');
const {renderDanfeNfeA4}=require('./danfe-nfe-renderer');

function queueNfeDanfe({runtime,documentId,actor={},now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
 if(!runtime?.fiscal||!runtime?.printing||!runtime?.db)throw new TypeError('Runtime fiscal com impressao e obrigatorio.');
 const document=runtime.fiscal.getDocument(documentId);if(!document)throw new Error('Documento fiscal nao encontrado.');if(document.documentType!=='nfe')throw new Error('DANFE A4 aceita somente NF-e modelo 55.');
 const html=renderDanfeNfeA4({document});
 const job=runtime.printing.queueJob({type:'DANFE_NFE_A4',entityType:'fiscal-document',entityId:document.id,payload:{html,format:'A4',documentType:'nfe',accessKey:document.accessKey},actor});
 const timestamp=now();runtime.db.prepare('UPDATE fiscal_documents SET danfe_print_job_id=?,updated_at=? WHERE id=?').run(job.id,timestamp,String(document.id));
 if(runtime.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fiscal_document_events'").get())runtime.db.prepare('INSERT INTO fiscal_document_events(id,fiscal_document_id,event_type,status,metadata_json,created_at) VALUES(?,?,?,?,?,?)').run(idFactory('fiscal-event'),String(document.id),'DANFE_NFE_A4_QUEUED',document.lifecycleStatus,JSON.stringify({printJobId:job.id,format:'A4'}),timestamp);
 writeAudit(runtime.db,{action:'fiscal.danfe-nfe.queue',entity:'fiscal-document',entityId:String(document.id),actor,context:{printJobId:job.id,format:'A4'}},now);
 return job;
}
module.exports={queueNfeDanfe};