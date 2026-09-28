'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('CI reports built-in Node test coverage and preserves the report as evidence',()=>{
  const workflow=read('.github/workflows/verify.yml');
  assert.match(workflow,/--experimental-test-coverage/);
  assert.match(workflow,/coverage\/test-coverage\.txt/);
  assert.match(workflow,/code-coverage-/);
});

test('critical QA has an isolated opt-in visual regression flow',()=>{
  const flow=JSON.parse(read('qa/flows/visual-critical.json'));
  assert.ok(flow.steps.some(step=>step.uses==='home.json'));
  const snapshots=flow.steps.filter(step=>step.action==='visualSnapshot');
  assert.ok(snapshots.some(step=>step.snapshot==='classic-home-critical'));
  assert.ok(snapshots.some(step=>step.snapshot==='checkout-critical'));

  const workflow=read('.github/workflows/qa-visual.yml');
  assert.match(workflow,/ARTISYS_QA_VISUAL/);
  assert.match(workflow,/ARTISYS_QA_UPDATE_VISUAL_BASELINES/);
  assert.match(workflow,/visual-critical/);
});

test('customer bugs have a permanent regression policy and PR checklist',()=>{
  const policy=read('docs/qa/customer-regression-policy.md');
  const template=read('.github/pull_request_template.md');
  assert.match(policy,/teste de regress[aã]o/i);
  assert.match(policy,/falh/i);
  assert.match(template,/bug.*cliente/i);
  assert.match(template,/regress[aã]o/i);
});

test('dependency security scan is pinned to OSV Scanner v2.6.0',()=>{
  const workflow=read('.github/workflows/osv-scanner.yml');
  assert.match(workflow,/google\/osv-scanner-action/);
  assert.match(workflow,/@v2\.6\.0/);
});
