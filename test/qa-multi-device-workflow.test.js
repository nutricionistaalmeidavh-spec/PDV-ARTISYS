'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

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
  const syntax=spawnSync(process.execPath,['--check',runnerPath],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  const runner=fs.readFileSync(runnerPath,'utf8');
  for(const invariant of [
    'price-propagation',
    'cashier-ui-price-propagation',
    'sale-stock-decrement',
    'last-unit-race',
    'idempotent-completion',
    'cash-session-isolation',
    'restaurant-kds-flow',
    'self-service-order',
    'authorization-boundaries',
    'database-invariants'
  ]) assert.ok(runner.includes(invariant),invariant);
  assert.match(runner,/requireTerminalAuth:true/,'LAN QA must authenticate paired terminals');
  assert.match(runner,/electron\.launch/,'full LAN QA must exercise a real remote Electron cashier');
  assert.match(runner,/data-add-product='qa-ui-price'/,'cashier UI must assert the price on the POS product card');
  assert.match(runner,/\/api\/v1\/restaurant\/sessions\/'\+opened\.body\.id\+'\/checkout/,'restaurant QA must reach checkout');
  assert.match(runner,/qa-waiter-device-2/,'restaurant QA must cover concurrent waiters');
  assert.match(runner,/PRAGMA integrity_check/,'QA must validate SQLite integrity');
  assert.match(runner,/PRAGMA foreign_key_check/,'QA must validate foreign keys');
});
