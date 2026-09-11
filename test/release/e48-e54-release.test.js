'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {openDatabase}=require('../../js/core/database/sqlite-database');
const {runMigrations}=require('../../js/core/database/migrations');
const {runReleaseMigrations}=require('../../js/core/database/release-migrations');
const {VERTICAL_SCHEMA_VERSION,runVerticalMigrations}=require('../../js/core/database/vertical-migrations');

const root=path.join(__dirname,'../..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('E48-E54 release is 1.3.0 with additive schema v8',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.version,'1.3.0');
  assert.equal(VERTICAL_SCHEMA_VERSION,8);
  const db=openDatabase(':memory:');
  try{
    runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);
    assert.equal(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v,8);
    assert.deepEqual(db.prepare('SELECT version,name FROM schema_migrations WHERE version=8').get(),{version:8,name:'pdv_verticals_e48_e54'});
  }finally{db.close();}
});

test('E48-E54 commercial surface stays local non-fiscal and manual-payment',()=>{
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
  assert.match(notes,/não declara PWA instalável/i);
  assert.match(limitations,/não é apresentado como HTTPS/i);
});

test('E54 hardware matrix cannot claim verified hardware without evidence',()=>{
  const matrix=JSON.parse(read('release/hardware-compatibility.json'));
  assert.ok(Array.isArray(matrix.entries));
  for(const item of matrix.entries){
    if(item.status==='VERIFIED')assert.ok(item.evidence,`${item.manufacturer} ${item.model} precisa de evidência`);
  }
});
