'use strict';

const {randomUUID}=require('node:crypto');
const {sanitizeValue,sanitizeText}=require('./security-hardening');

function ensureSchema(db){db.exec(`CREATE TABLE IF NOT EXISTS fiscal_observability_events(
 id TEXT PRIMARY KEY,
 operation TEXT NOT NULL,
 provider TEXT,
 document_type TEXT,
 environment TEXT,
 outcome TEXT NOT NULL,
 sefaz_code TEXT,
 reference TEXT,
 duration_ms INTEGER NOT NULL DEFAULT 0 CHECK(duration_ms >= 0),
 retry INTEGER NOT NULL DEFAULT 0 CHECK(retry >= 0),
 context_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fiscal_observability_created ON fiscal_observability_events(created_at,id);
CREATE INDEX IF NOT EXISTS idx_fiscal_observability_operation ON fiscal_observability_events(operation,outcome,created_at);
CREATE INDEX IF NOT EXISTS idx_fiscal_observability_rejection ON fiscal_observability_events(sefaz_code,outcome,created_at);`);}
function safeText(value,max=160){return sanitizeText(value,max).slice(0,max);}
function createFiscalObservability({db,logger=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`,retention=5000}={}){
 if(!db)throw new TypeError('Database obrigatorio para observabilidade fiscal.');ensureSchema(db);const maxRows=Math.max(100,Math.min(Number(retention)||5000,50000));
 function record(input={}){const operation=safeText(input.operation||'unknown',80).toLowerCase();const outcome=safeText(input.outcome||'UNKNOWN',80).toUpperCase();const provider=input.provider?safeText(input.provider,80):null;const documentType=input.documentType?safeText(input.documentType,32).toLowerCase():null;const environment=input.environment?safeText(input.environment,32).toLowerCase():null;const sefazCode=input.sefazCode==null?null:safeText(input.sefazCode,32);const reference=input.reference?safeText(input.reference,120):null;const durationMs=Math.max(0,Math.min(Number(input.durationMs)||0,24*60*60*1000));const retry=Math.max(0,Math.min(Number(input.retry)||0,100000));const context=sanitizeValue(input.context&&typeof input.context==='object'?input.context:{});const id=String(idFactory('fiscal-observation'));const createdAt=now();db.prepare('INSERT INTO fiscal_observability_events(id,operation,provider,document_type,environment,outcome,sefaz_code,reference,duration_ms,retry,context_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,operation,provider,documentType,environment,outcome,sefazCode,reference,durationMs,retry,JSON.stringify(context),createdAt);db.prepare(`DELETE FROM fiscal_observability_events WHERE id IN (SELECT id FROM fiscal_observability_events ORDER BY created_at DESC,id DESC LIMIT -1 OFFSET ?)` ).run(maxRows);try{logger?.log?.({level:outcome==='REJECTED'||outcome==='FAILED'?'warn':'info',subsystem:'fiscal',message:`${operation}:${outcome}`,context:{provider,documentType,environment,sefazCode,reference,durationMs,retry,...context}});}catch{}return{id,operation,outcome,createdAt};}
 function list({limit=200,operation=null,outcome=null}={}){const clauses=[];const params=[];if(operation){clauses.push('operation=?');params.push(String(operation).toLowerCase());}if(outcome){clauses.push('outcome=?');params.push(String(outcome).toUpperCase());}params.push(Math.max(1,Math.min(Number(limit)||200,1000)));return db.prepare(`SELECT * FROM fiscal_observability_events${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC LIMIT ?`).all(...params).map(row=>({id:row.id,operation:row.operation,provider:row.provider,documentType:row.document_type,environment:row.environment,outcome:row.outcome,sefazCode:row.sefaz_code,reference:row.reference,durationMs:row.duration_ms,retry:row.retry,context:sanitizeValue(JSON.parse(row.context_json||'{}')),createdAt:row.created_at}));}
 function snapshot(){const rows=db.prepare('SELECT operation,outcome,sefaz_code,duration_ms,retry FROM fiscal_observability_events').all();const byOperation={};const byOutcome={};const rejections={};let totalDurationMs=0;let maxDurationMs=0;let retries=0;let reconciliations=0;for(const row of rows){byOperation[row.operation]=(byOperation[row.operation]||0)+1;byOutcome[row.outcome]=(byOutcome[row.outcome]||0)+1;if(row.outcome==='REJECTED'&&row.sefaz_code)rejections[row.sefaz_code]=(rejections[row.sefaz_code]||0)+1;const duration=Number(row.duration_ms||0);totalDurationMs+=duration;maxDurationMs=Math.max(maxDurationMs,duration);retries+=Number(row.retry||0);if(row.operation==='reconcile')reconciliations+=1;}return sanitizeValue({generatedAt:now(),total:rows.length,byOperation,byOutcome,rejections,reconciliations,retries,averageDurationMs:rows.length?Math.round(totalDurationMs/rows.length):0,maxDurationMs,recent:list({limit:50})});}
 return Object.freeze({record,list,snapshot});
}
module.exports={createFiscalObservability,ensureSchema};