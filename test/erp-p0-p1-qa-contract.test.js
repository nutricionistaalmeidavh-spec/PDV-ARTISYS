'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const config=require('../qa/artisys-qa.config.json');

const required=[
  'finance-management-base-e2e','finance-source-link-e2e','finance-dimensions-e2e',
  'finance-base-idempotency-e2e','business-dashboard-e2e','dre-e2e','cashflow-e2e',
  'period-comparison-e2e','cost-center-e2e'
];

test('P0/P1 ERP finance flows are real files and release-critical',()=>{
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

test('ERP finance QA adapter authenticates its isolated Electron fixture',()=>{
  const file=path.join(__dirname,'..','qa','runtime','adapters','erp-finance-ci.mjs');
  const source=fs.readFileSync(file,'utf8');
  assert.match(source,/await ensureAuthenticated\(page\)/,'finance setup must authenticate before protected API calls');
  assert.match(source,/api\.setupStatus\(\)/,'finance QA auth must detect first-access state');
  assert.match(source,/api\.setupAdmin\(/,'finance QA auth must bootstrap the local admin when needed');
  assert.match(source,/api\.login\(/,'finance QA auth must establish a session token');
});
