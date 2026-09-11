'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {openDatabase}=require('../../js/core/database/sqlite-database');
const {runMigrations}=require('../../js/core/database/migrations');
const {runReleaseMigrations}=require('../../js/core/database/release-migrations');
const {VERTICAL_SCHEMA_VERSION,runVerticalMigrations}=require('../../js/core/database/vertical-migrations');
const {STATUSES}=require('../../js/core/hardware/hardware-compatibility-service');

const root=path.join(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('E48-E54 plus E54.1 release is 1.3.1 with additive schema v8',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.version,'1.3.1');
  assert.equal(VERTICAL_SCHEMA_VERSION,8);
  const db=openDatabase(':memory:');
  try{
    runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);
    assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,8);
    const migration=db.prepare('SELECT version,name FROM schema_migrations WHERE version=8').get();
    assert.equal(migration.version,8);
    assert.equal(migration.name,'pdv_verticals_e48_e54');
  }finally{db.close();}
});

test('commercial surface stays local non-fiscal and manual-payment',()=>{
  const router=read('server/e48-e54-router.js');
  const selfService=read('js/domains/self-service/self-service.js');
  const notes=read('release/release-notes.md');
  const limitations=JSON.parse(read('release/limitations.json')).join('\n');
  assert.doesNotMatch(router,/runtime\.fiscal|fiscalService|requestFiscalIssue|retryFiscalIssue/);
  assert.match(notes,/NÃO FISCAL/);
  assert.match(notes,/pagamentos manuais/i);
  assert.match(limitations,/não há TEF|TEF/i);
  assert.match(selfService,/MANUAL_AT_COUNTER/);
});

test('E53 does not claim HTTPS or installable PWA',()=>{
  const notes=read('release/release-notes.md');
  const limitations=JSON.parse(read('release/limitations.json')).join('\n');
  assert.match(notes,/http:\/\/IP-DO-SERVIDOR:4174\/mobile/);
  assert.match(notes,/não declara HTTPS nem PWA instalável/i);
  assert.match(limitations,/não é apresentado como HTTPS/i);
});

test('E54.1 hardware matrix separates protocol evidence from physical field verification',()=>{
  const matrix=JSON.parse(read('release/hardware-compatibility.json'));
  assert.equal(matrix.schemaVersion,2);
  assert.ok(Array.isArray(matrix.entries));
  assert.equal(STATUSES.has('PROTOCOL_VERIFIED'),true);
  assert.equal(STATUSES.has('FIELD_VERIFIED'),true);
  assert.equal(STATUSES.has('UNTESTED_MODEL'),true);
  assert.equal(STATUSES.has('BLOCKED_EXTERNAL'),false);
  assert.equal(STATUSES.has('VERIFIED'),false);
  for(const item of matrix.entries){
    if(['PROTOCOL_VERIFIED','FIELD_VERIFIED'].includes(item.status))assert.ok(item.evidence,`${item.manufacturer} ${item.model} precisa de evidência`);
  }
  for(const kind of ['PRINTER','SCALE','DRAWER','SCANNER']){
    assert.ok(matrix.entries.some(item=>item.kind===kind&&item.status==='PROTOCOL_VERIFIED'),`${kind} deve ter protocolo validado`);
  }
  assert.match(read('docs/operations/hardware-printing.md'),/PDV_SCALE_SETTLE_MS/);
  assert.ok(fs.existsSync(path.join(root,'test','e54-1-hardware-simulation.test.js')));
  assert.ok(fs.existsSync(path.join(root,'test','e54-1-hardware-failure-recovery.test.js')));
});
