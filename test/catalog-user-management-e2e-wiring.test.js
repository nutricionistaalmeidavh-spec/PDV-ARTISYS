'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'qa/artisys-qa.config.json'),'utf8'));
const coreFlow=JSON.parse(fs.readFileSync(path.join(root,'qa/flows/core-business-e2e.json'),'utf8'));
const flow=JSON.parse(fs.readFileSync(path.join(root,'qa/flows/catalog-user-management-e2e.json'),'utf8'));

function hasStep(predicate){return flow.steps.some(predicate);}
function countSteps(predicate){return flow.steps.filter(predicate).length;}

test('catalog user management E2E is part of the release-critical core business flow',()=>{
  assert.equal(config.flows['core-business-e2e'],'flows/core-business-e2e.json');
  assert.ok(coreFlow.steps.some(step=>step.uses==='catalog-user-management-e2e.json'),'core-business-e2e must include catalog-user-management-e2e');
  for(const profileName of ['full','release']){
    const profile=config.qaProfiles[profileName];
    assert.ok(profile.flows.includes('core-business-e2e'),`${profileName} must run core-business-e2e`);
    assert.ok(profile.criticalFlows.includes('core-business-e2e'),`${profileName} must treat core-business-e2e as critical`);
  }
});

test('catalog user management E2E exercises create edit password reset deactivate reactivate and logical deletion',()=>{
  assert.ok(hasStep(step=>step.action==='click'&&step.selector==='#catalog-new-user'),'missing user creation');
  assert.ok(hasStep(step=>step.action==='click'&&String(step.selector||'').includes('[data-edit-user]')),'missing user edit');
  assert.ok(countSteps(step=>step.action==='fill'&&step.selector==="#catalog-user-form input[name='password']")>=2,'user password must be set on create and reset on edit');
  assert.ok(hasStep(step=>step.action==='click'&&String(step.selector||'').includes('[data-remove-user]')),'missing user deactivation');
  assert.ok(hasStep(step=>step.action==='click'&&step.selector==='#catalog-confirm-remove-user'),'missing user deactivation confirmation');
  assert.ok(hasStep(step=>step.action==='click'&&String(step.selector||'').includes('[data-reactivate-user]')),'missing user reactivation');
  for(const selector of ['[data-remove-customer]','[data-remove-category]','[data-remove-supplier]']){
    assert.ok(hasStep(step=>step.action==='click'&&String(step.selector||'').includes(selector)),`missing logical deletion coverage for ${selector}`);
  }
});
