'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const config=JSON.parse(fs.readFileSync(path.join(root,'qa/artisys-qa.config.json'),'utf8'));
const flow=JSON.parse(fs.readFileSync(path.join(root,'qa/flows/catalog-user-management-e2e.json'),'utf8'));

function hasStep(predicate){return flow.steps.some(predicate);}
function countSteps(predicate){return flow.steps.filter(predicate).length;}

test('catalog user management E2E is wired as a release-critical flow',()=>{
  assert.equal(config.flows['catalog-user-management-e2e'],'flows/catalog-user-management-e2e.json');
  for(const profileName of ['full','release']){
    const profile=config.qaProfiles[profileName];
    assert.ok(profile.flows.includes('catalog-user-management-e2e'),`${profileName} must run catalog-user-management-e2e`);
    assert.ok(profile.criticalFlows.includes('catalog-user-management-e2e'),`${profileName} must treat catalog-user-management-e2e as critical`);
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
