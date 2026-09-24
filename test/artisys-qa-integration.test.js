import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve('.');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('pins synchronized ArtiSys QA runtime',()=>{
  const lock=readJson('qa/artisys-qa.lock.json');
  const runtime=readJson('qa/runtime/package.json');
  assert.equal(lock.schemaVersion,2);
  assert.equal(lock.module,'@artisys/qa');
  assert.equal(lock.version,'2.6.0');
  assert.equal(lock.sourceRepository,'nutricionistaalmeidavh-spec/utilidades');
  assert.equal(lock.consumption,'vendored-runtime');
  assert.equal(runtime.name,'@artisys/qa');
  assert.equal(runtime.version,'2.6.0');
});

test('vendors runtime capabilities used by CI',()=>{
  for(const relative of ['qa/runtime/src/cli.mjs','qa/runtime/src/profile-runner.js','qa/runtime/src/profiles.js','qa/runtime/src/visual.js','qa/runtime/src/remote-control.js','qa/runtime/src/agent-cli.mjs','qa/runtime/src/telemetry-store.js','qa/runtime/src/release-gate.js','qa/runtime/src/product-report.js']) assert.equal(fs.existsSync(path.join(root,relative)),true,relative);
  assert.match(readText('qa/runtime/src/profile-runner.js'),/writeCiQaSummary/);
});

test('PDV release profile preserves existing gates and adds ERP finance P0-P3 E2E',()=>{
  const config=readJson('qa/artisys-qa.config.json');
  const legacyReleaseFlows=['smoke','home','sales-enhancements','checkout-ux-preservation','reports-v2-complete','core-business-e2e','ux-products-clients-cross-flow','products-deep-e2e','customers-deep-e2e','ux-products-clients-flags-e2e','ux-products-clients-responsive-evidence','enterprise-depth-p0','backend-parity-p0','backend-parity-p1','ui-parity-p0-p2','fiscal-block6','fiscal-ui-parity-baseline','fiscal-config-p2-p5','fiscal-nfse-p8'];
  const erpFinanceFlows=['finance-management-base-e2e','finance-source-link-e2e','finance-dimensions-e2e','finance-base-idempotency-e2e','business-dashboard-e2e','dre-e2e','cashflow-e2e','period-comparison-e2e','cost-center-e2e','statement-ofx-e2e','statement-dedupe-e2e','reconciliation-payable-e2e','reconciliation-receivable-e2e','bank-transfer-e2e','finance-recurrence-e2e','recurrence-idempotency-e2e','financial-alerts-e2e','cash-projection-e2e'];
  const releaseFlows=[...legacyReleaseFlows,...erpFinanceFlows];
  assert.deepEqual(config.qaProfiles.quick.flows,['smoke']);
  assert.deepEqual(config.qaProfiles.full.flows,releaseFlows);
  assert.deepEqual(config.qaProfiles.full.criticalFlows,releaseFlows);
  assert.deepEqual(config.qaProfiles.release.flows,releaseFlows);
  assert.deepEqual(config.qaProfiles.release.criticalFlows,releaseFlows);
  for(const name of legacyReleaseFlows) assert.equal(config.flows[name]?.startsWith('flows/'),true,`${name} remains registered`);
  for(const name of erpFinanceFlows) assert.equal(config.flows[name],`flows/${name}.json`,`${name} ERP finance flow is registered`);
});

test('future QA updates remain explicit and local-first',()=>{
  const pkg=readJson('package.json');
  assert.equal(pkg.scripts['qa:update'],'node scripts/sync-artisys-qa.mjs');
  assert.match(pkg.scripts['qa:quick'],/artisys-qa\.mjs quick/);
  assert.match(pkg.scripts['qa:full'],/artisys-qa\.mjs full/);
  assert.match(pkg.scripts['qa:release'],/artisys-qa\.mjs release/);
  const sync=readText('scripts/sync-artisys-qa.mjs');
  assert.match(sync,/ARTISYS_QA_SOURCE/);
  assert.match(sync,/qa\/artisys-qa\.config\.json/);
});

test('CircleCI verifies release before quick QA',()=>{
  const circle=readText('.circleci/config.yml');
  assert.match(circle,/command: npm run verify:release/);
  assert.match(circle,/xvfb-run -a npm run qa:quick/);
});

test('GitHub QA capture remains compatible with run and demo commands',()=>{
  const workflow=readText('.github/workflows/qa-capture.yml');
  assert.match(workflow,/artisys-qa\.mjs demo/);
  assert.match(workflow,/artisys-qa\.mjs run/);
});