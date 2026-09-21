'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {buildCertificationPlan}=require('../scripts/fiscal-release-certification');

test('P25 final fiscal certification plan accumulates unit integration contract E2E invariants QA full security packaging and verify release',()=>{
  const plan=buildCertificationPlan();const commands=plan.map(step=>`${step.command} ${(step.args||[]).join(' ')}`);
  for(const marker of ['npm test','fiscal-block','fiscal-security-hardening','fiscal-packaging','qa:full','verify:release'])assert.equal(commands.some(command=>command.includes(marker)),true,`missing ${marker}`);
  assert.equal(new Set(plan.map(step=>step.id)).size,plan.length);assert.equal(plan.every(step=>step.required===true),true);
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));assert.match(pkg.scripts['fiscal:certify']||'',/fiscal-release-certification/);
});
