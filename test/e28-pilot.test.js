'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createPilotService,PILOT_STATES}=require('../js/core/pilot/pilot-service');

function fixture(){const db=openDatabase(':memory:');runMigrations(db);let seq=0;const now=()=>new Date(1789004400000+seq++*1000).toISOString();return{db,pilot:createPilotService({db,now})};}

test('pilot seeds required field checks idempotently with explicit states',()=>{const {db,pilot}=fixture();try{
 const first=pilot.listChecks();const second=pilot.listChecks();assert.equal(first.length,second.length);assert.ok(first.length>=12);assert.equal(new Set(first.map(x=>x.key)).size,first.length);
 for(const key of ['identify-server','store-config','terminal-register','lan-test','printer-test','drawer-test','backup-manual','sale-test','return-test','cash-close-test','diagnostics'])assert.ok(first.some(x=>x.key===key),key);
 assert.deepEqual(PILOT_STATES,['NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL']);assert.equal(first.every(x=>x.status==='NOT_STARTED'),true);
}finally{db.close();}});

test('pilot updates persist evidence and audit actor with admin/manager RBAC',()=>{const {db,pilot}=fixture();try{
 const updated=pilot.updateCheck('lan-test',{status:'READY',note:'Ping e handshake OK',evidence:{terminalId:'PDV-02',latencyMs:5},actor:{userId:'mgr',role:'manager'}});assert.equal(updated.status,'READY');assert.equal(updated.note,'Ping e handshake OK');assert.equal(updated.evidence.terminalId,'PDV-02');assert.equal(updated.updatedBy,'mgr');
 assert.throws(()=>pilot.updateCheck('sale-test',{status:'READY',actor:{userId:'cash',role:'cashier'}}),/permiss/i);assert.throws(()=>pilot.updateCheck('sale-test',{status:'FAKE',actor:{userId:'admin',role:'admin'}}),/estado/i);
 const audit=db.prepare("SELECT action,entity_id FROM audit_log WHERE action='pilot.check.update' ORDER BY id DESC LIMIT 1").get();assert.equal(audit.entity_id,'lan-test');
}finally{db.close();}});

test('BLOCKED_EXTERNAL is reported as external blocker and never as READY',()=>{const {db,pilot}=fixture();try{
 for(const item of pilot.listChecks())pilot.updateCheck(item.key,{status:'READY',actor:{userId:'admin',role:'admin'}});
 assert.equal(pilot.readiness().status,'READY');
 pilot.updateCheck('fiscal-test',{status:'BLOCKED_EXTERNAL',note:'Credencial fiscal real ainda nao fornecida.',actor:{userId:'admin',role:'admin'}});
 const readiness=pilot.readiness();assert.equal(readiness.status,'BLOCKED_EXTERNAL');assert.equal(readiness.ready,false);assert.deepEqual(readiness.externalBlockers.map(x=>x.key),['fiscal-test']);
}finally{db.close();}});

test('internal BLOCKED has precedence and incomplete checklist is not release-ready',()=>{const {db,pilot}=fixture();try{
 let state=pilot.readiness();assert.equal(state.status,'NOT_STARTED');assert.equal(state.ready,false);
 pilot.updateCheck('identify-server',{status:'READY',actor:{userId:'admin',role:'admin'}});state=pilot.readiness();assert.equal(state.status,'IN_PROGRESS');
 pilot.updateCheck('lan-test',{status:'BLOCKED',note:'Falha interna',actor:{userId:'admin',role:'admin'}});state=pilot.readiness();assert.equal(state.status,'BLOCKED');assert.equal(state.ready,false);assert.equal(state.blockers[0].key,'lan-test');
}finally{db.close();}});
