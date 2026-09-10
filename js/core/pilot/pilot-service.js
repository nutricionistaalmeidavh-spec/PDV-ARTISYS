'use strict';

const { writeAudit }=require('../audit-log');

const PILOT_STATES=Object.freeze(['NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL']);
const PILOT_CHECKS=Object.freeze([
  {key:'identify-server',title:'Identificar servidor',category:'deployment'},
  {key:'store-config',title:'Configurar loja',category:'configuration'},
  {key:'terminal-register',title:'Cadastrar e parear terminal',category:'lan'},
  {key:'lan-test',title:'Testar comunicação LAN',category:'lan'},
  {key:'printer-test',title:'Testar impressora',category:'hardware'},
  {key:'drawer-test',title:'Testar gaveta',category:'hardware'},
  {key:'scale-test',title:'Testar balança quando aplicável',category:'hardware',optional:true},
  {key:'fiscal-test',title:'Configurar e testar fiscal quando aplicável',category:'fiscal',optional:true},
  {key:'backup-manual',title:'Executar backup manual',category:'recovery'},
  {key:'restore-test',title:'Validar restore controlado',category:'recovery'},
  {key:'sale-test',title:'Executar venda teste',category:'operations'},
  {key:'return-test',title:'Executar cancelamento/devolução teste',category:'operations'},
  {key:'cash-close-test',title:'Executar fechamento de caixa teste',category:'operations'},
  {key:'import-test',title:'Validar importação inicial',category:'migration'},
  {key:'diagnostics',title:'Gerar pacote de diagnóstico',category:'support'}
]);

function ensurePilotTable(db){
  db.exec(`CREATE TABLE IF NOT EXISTS pilot_checks(
    check_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    optional INTEGER NOT NULL DEFAULT 0 CHECK(optional IN(0,1)),
    status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN('NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL')),
    note TEXT,
    evidence_json TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pilot_checks_status ON pilot_checks(status,category);`);
}
function mapRow(row){if(!row)return null;let evidence=null;try{evidence=row.evidence_json?JSON.parse(row.evidence_json):null;}catch{evidence=null;}return{key:row.check_key,title:row.title,category:row.category,optional:Boolean(row.optional),status:row.status,note:row.note,evidence,updatedBy:row.updated_by,createdAt:row.created_at,updatedAt:row.updated_at};}
function assertActor(actor){if(!['admin','manager'].includes(String(actor?.role||'')))throw new Error('Permissao insuficiente para atualizar checklist de piloto.');}
function sanitizeEvidence(value){if(value==null)return null;if(typeof value!=='object'||Array.isArray(value))throw new Error('Evidencia do piloto deve ser um objeto.');const text=JSON.stringify(value);if(text.length>12000)throw new Error('Evidencia do piloto excede o limite.');return value;}

function createPilotService({db,now=()=>new Date().toISOString()}={}){
  if(!db)throw new TypeError('Database is required.');ensurePilotTable(db);
  const insert=db.prepare(`INSERT OR IGNORE INTO pilot_checks(check_key,title,category,optional,status,created_at,updated_at) VALUES(?,?,?,?, 'NOT_STARTED',?,?)`);
  const seededAt=now();for(const item of PILOT_CHECKS)insert.run(item.key,item.title,item.category,item.optional?1:0,seededAt,seededAt);

  function listChecks(){return db.prepare('SELECT * FROM pilot_checks ORDER BY rowid').all().map(mapRow);}
  function getCheck(key){return mapRow(db.prepare('SELECT * FROM pilot_checks WHERE check_key=?').get(String(key)));}
  function updateCheck(key,{status,note=null,evidence=null,actor={}}={}){
    assertActor(actor);const normalizedStatus=String(status||'').toUpperCase();if(!PILOT_STATES.includes(normalizedStatus))throw new Error('Estado de piloto invalido.');const existing=getCheck(key);if(!existing)throw new Error('Item do checklist de piloto nao encontrado.');
    const safeEvidence=sanitizeEvidence(evidence);const safeNote=note==null?null:String(note).trim().slice(0,2000)||null;const timestamp=now();
    db.prepare('UPDATE pilot_checks SET status=?,note=?,evidence_json=?,updated_by=?,updated_at=? WHERE check_key=?').run(normalizedStatus,safeNote,safeEvidence==null?null:JSON.stringify(safeEvidence),actor.userId||null,timestamp,existing.key);
    writeAudit(db,{action:'pilot.check.update',entity:'pilot-check',entityId:existing.key,actor,context:{from:existing.status,to:normalizedStatus,note:safeNote,evidence:safeEvidence}},now);
    return getCheck(existing.key);
  }
  function readiness(){
    const checks=listChecks();const blockers=checks.filter(item=>item.status==='BLOCKED');const externalBlockers=checks.filter(item=>item.status==='BLOCKED_EXTERNAL');const incomplete=checks.filter(item=>!['READY','BLOCKED','BLOCKED_EXTERNAL'].includes(item.status));
    let status='NOT_STARTED';if(blockers.length)status='BLOCKED';else if(externalBlockers.length)status='BLOCKED_EXTERNAL';else if(checks.length&&checks.every(item=>item.status==='READY'))status='READY';else if(checks.some(item=>item.status!=='NOT_STARTED'))status='IN_PROGRESS';
    return{status,ready:status==='READY',total:checks.length,readyCount:checks.filter(item=>item.status==='READY').length,blockedCount:blockers.length,externalBlockedCount:externalBlockers.length,incompleteCount:incomplete.length,blockers,externalBlockers,incomplete,updatedAt:checks.reduce((latest,item)=>!latest||item.updatedAt>latest?item.updatedAt:latest,null)};
  }
  return{listChecks,getCheck,updateCheck,readiness};
}

module.exports={PILOT_STATES,PILOT_CHECKS,createPilotService,ensurePilotTable};
