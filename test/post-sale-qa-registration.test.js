'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');

test('post-sale PDF and printing settings flows are release-critical',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'qa/artisys-qa.config.json'),'utf8'));
  for(const name of ['post-sale-print-pdf','printing-settings-e2e']){
    assert.equal(typeof config.flows[name],'string',`${name} must be registered`);
    assert.equal(fs.existsSync(path.join(root,'qa',config.flows[name])),true,`${name} flow file must exist`);
    assert.ok(config.qaProfiles.full.flows.includes(name),`${name} must run in full QA`);
    assert.ok(config.qaProfiles.full.criticalFlows.includes(name),`${name} must be full-critical`);
    assert.ok(config.qaProfiles.release.flows.includes(name),`${name} must run in release QA`);
    assert.ok(config.qaProfiles.release.criticalFlows.includes(name),`${name} must be release-critical`);
  }
  const postSale=JSON.parse(fs.readFileSync(path.join(root,'qa/flows/post-sale-print-pdf.json'),'utf8'));
  const fileCheck=postSale.steps.find(step=>step.action==='expectFile');
  assert.ok(fileCheck,'post-sale flow must assert a generated PDF file');
  assert.equal(fileCheck.startsWith,'%PDF-');
  assert.equal(fileCheck.createdAfterRunStart,true,'PDF assertion must reject stale artifacts');
  assert.ok(Number(fileCheck.minBytes)>=100,'PDF assertion must reject empty/trivial files');
});