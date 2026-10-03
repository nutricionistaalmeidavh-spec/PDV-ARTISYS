'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const workflowPath=path.join(root,'.github','workflows','qa-multi-device-lan.yml');
const runnerPath=path.join(root,'qa','multi-device','run.mjs');

test('multi-device LAN QA is isolated in a manual-only workflow',()=>{
  assert.equal(fs.existsSync(workflowPath),true,'workflow qa-multi-device-lan.yml must exist');
  const workflow=fs.readFileSync(workflowPath,'utf8');
  assert.match(workflow,/workflow_dispatch:/);
  assert.doesNotMatch(workflow,/^\s*push:/m);
  assert.doesNotMatch(workflow,/^\s*pull_request:/m);
  assert.doesNotMatch(workflow,/^\s*schedule:/m);
  for(const profile of ['smoke','full','stress']) assert.match(workflow,new RegExp('\\b'+profile+'\\b'));
});

test('multi-device LAN QA runner exposes business invariant coverage',()=>{
  assert.equal(fs.existsSync(runnerPath),true,'qa/multi-device/run.mjs must exist');
  const runner=fs.readFileSync(runnerPath,'utf8');
  for(const invariant of [
    'price-propagation',
    'sale-stock-decrement',
    'last-unit-race',
    'idempotent-completion',
    'cash-session-isolation',
    'restaurant-kds-flow',
    'self-service-order',
    'database-invariants'
  ]) assert.ok(runner.includes(invariant),invariant);
});
