'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const json=file=>JSON.parse(read(file));

test('services/workshop module toggles avoid check() on a DOM node replaced by rerender',()=>{
  const flow=json('qa/flows/user/19-servicos-oficina.json');
  const byName=name=>flow.steps.find(step=>step.name===name);
  assert.equal(byName('enable-services')?.action,'click');
  assert.equal(byName('services-enabled')?.action,'waitFor');
  assert.equal(byName('services-enabled')?.selector,"[data-module-toggle='SERVICES']:checked");
  assert.equal(byName('enable-workshop')?.action,'click');
  assert.equal(byName('workshop-enabled')?.action,'waitFor');
  assert.equal(byName('workshop-enabled')?.selector,"[data-module-toggle='WORKSHOP']:checked");
});

test('every QA step is protected by a finite runner-level watchdog',()=>{
  const runner=read('qa/runtime/src/runner.js');
  assert.match(runner,/stepTimeoutMs/);
  assert.match(runner,/Promise\.race/);
  assert.match(runner,/QA step timed out/);
  assert.match(runner,/executeStepWithTimeout/);
});

test('terminal-friendly full QA command is exposed through npm',()=>{
  const pkg=json('package.json');
  assert.equal(pkg.scripts?.['qa:user:all'],'node scripts/qa-user-all.mjs');
});

test('business integrity regression suite covers cross-module side effects',()=>{
  const file=path.join(root,'test','user-flow-integrity.test.js');
  assert.ok(fs.existsSync(file),'missing test/user-flow-integrity.test.js');
  const source=fs.readFileSync(file,'utf8');
  for(const token of ['buildSalesSummary','getBalance','listSessionMovements','listJobs','commissions','createReturn','restart']){
    assert.match(source,new RegExp(token),`integrity suite must cover ${token}`);
  }
});
