'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const config=require('../qa/artisys-qa.config.json');

const required=[
  'statement-ofx-e2e','statement-dedupe-e2e','reconciliation-payable-e2e',
  'reconciliation-receivable-e2e','bank-transfer-e2e','finance-recurrence-e2e',
  'recurrence-idempotency-e2e','financial-alerts-e2e','cash-projection-e2e'
];

test('P2/P3 ERP finance flows are real files and release-critical',()=>{
  for(const name of required){
    assert.equal(config.flows[name],`flows/${name}.json`,`${name} must be registered`);
    assert.ok(config.qaProfiles.full.flows.includes(name),`${name} missing from full.flows`);
    assert.ok(config.qaProfiles.full.criticalFlows.includes(name),`${name} missing from full.criticalFlows`);
    assert.ok(config.qaProfiles.release.flows.includes(name),`${name} missing from release.flows`);
    assert.ok(config.qaProfiles.release.criticalFlows.includes(name),`${name} missing from release.criticalFlows`);
    const file=path.join(__dirname,'..','qa',config.flows[name]);
    assert.ok(fs.existsSync(file),`${name} flow file does not exist`);
    const flow=JSON.parse(fs.readFileSync(file,'utf8'));
    assert.equal(flow.name,name);
    assert.ok(flow.steps.some(step=>step.action==='capability'),`${name} must exercise a deterministic ERP finance capability`);
  }
});