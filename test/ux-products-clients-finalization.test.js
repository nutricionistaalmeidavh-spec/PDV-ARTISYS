'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const json = relative => JSON.parse(read(relative));

const exists = relative => fs.existsSync(path.join(root, relative));

test('QA runtime can toggle only the paired Products and Customers feature flags', () => {
  const steps = read('qa/runtime/src/steps.js');
  assert.ok(steps.includes("case 'setFeatureFlags'"), 'QA runtime must expose a bounded setFeatureFlags action');
  assert.ok(steps.includes('productsDenseView'), 'Products flag must be explicitly allowed');
  assert.ok(steps.includes('customersMasterDetailView'), 'Customers flag must be explicitly allowed');
});

test('paired UX has an executable ON/OFF fallback flow', () => {
  const file = 'qa/flows/ux-products-clients-flags-e2e.json';
  assert.equal(exists(file), true, `${file} must exist`);
  const flow = json(file);
  const serialized = JSON.stringify(flow);
  for (const marker of [
    'setFeatureFlags',
    'productsDenseView',
    'customersMasterDetailView',
    '[data-products-dense-header]',
    '[data-customers-master-panel]',
    'detached',
    '#new-product',
    '#new-customer'
  ]) assert.ok(serialized.includes(marker), `feature flag flow missing ${marker}`);
});

test('paired UX has responsive screenshot evidence at desktop tablet and narrow viewport', () => {
  const file = 'qa/flows/ux-products-clients-responsive-evidence.json';
  assert.equal(exists(file), true, `${file} must exist`);
  const flow = json(file);
  const serialized = JSON.stringify(flow);
  for (const marker of [
    "[data-route='products']",
    "[data-route='customers']",
    '[data-products-dense-header]',
    '[data-customers-master-panel]',
    '#new-product',
    '#new-customer',
    'screenshot'
  ]) assert.ok(serialized.includes(marker), `responsive evidence flow missing ${marker}`);

  const pkg = json('package.json');
  for (const script of [
    'qa:ux:flags',
    'qa:ux:responsive:desktop',
    'qa:ux:responsive:tablet',
    'qa:ux:responsive:mobile',
    'qa:ux:finalize'
  ]) assert.equal(typeof pkg.scripts?.[script], 'string', `package script missing: ${script}`);

  assert.ok(pkg.scripts['qa:ux:responsive:desktop'].includes('--viewport desktop'));
  assert.ok(pkg.scripts['qa:ux:responsive:tablet'].includes('--viewport tablet'));
  assert.ok(pkg.scripts['qa:ux:responsive:mobile'].includes('--viewport mobile'));
});

test('GitHub release E2E executes paired UX finalization on the same SHA', () => {
  const workflow = read('.github/workflows/verify.yml');
  assert.ok(workflow.includes('Run paired UX finalization'), 'workflow must execute paired UX finalization');
  assert.ok(workflow.includes('npm run qa:ux:finalize'), 'workflow must call qa:ux:finalize');
  assert.ok(workflow.indexOf('Run paired UX finalization') > workflow.indexOf('Run release E2E flows'), 'paired UX finalization should run after release E2E setup/data');
});

test('paired evolution is evidence-based rather than UX-level-only', () => {
  const file = 'docs/architecture/ux-products-clients-evidence.json';
  assert.equal(exists(file), true, `${file} must exist`);
  const evidence = json(file);
  assert.deepEqual(evidence.products, evidence.customers, 'Products and Customers must carry the same evidence contract');
  for (const key of [
    'featureFlag',
    'fallbackE2E',
    'parityMatrix',
    'controllerIntegration',
    'deepE2E',
    'crossFlow',
    'responsiveEvidence',
    'releaseRegistration'
  ]) assert.equal(evidence.products?.[key], true, `paired evidence missing ${key}`);

  const guard = read('test/paired-ux-evolution-guard.test.js');
  assert.ok(guard.includes('ux-products-clients-evidence.json'), 'paired guard must read the evidence manifest');
});

test('architecture docs describe the current progressive-enhancement state', () => {
  const inventory = read('docs/architecture/ux-products-clients-inventory.md');
  assert.ok(!inventory.includes('componentes criados na Entrega 2 permanecem inertes nesta branch'), 'inventory still claims the UX foundation is inert');

  const productParity = read('docs/architecture/products-dense-parity.md');
  assert.ok(productParity.includes('Caminho canônico'), 'Products parity doc must explicitly name the canonical rendering strategy');
  assert.ok(productParity.includes('progressive enhancement'), 'Products canonical strategy must remain progressive enhancement');
});
