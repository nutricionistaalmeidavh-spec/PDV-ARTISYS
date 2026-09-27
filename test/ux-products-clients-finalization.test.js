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
    '#new-customer',
    'QA Flag Legacy Product',
    'QA Flag Legacy Customer',
    'QA Flag Dense Product',
    'QA Flag Master Customer',
    'expectValue'
  ]) assert.ok(serialized.includes(marker), `feature flag flow missing ${marker}`);

  const visibleCustomerSelector = '[data-customer-master-row]:not(.catalog-search-hidden)';
  assert.equal(flow.steps.find(step => step.name === 'flags-on-customer-row-ready')?.selector, visibleCustomerSelector);
  assert.equal(flow.steps.find(step => step.name === 'flags-on-customer-select')?.selector, visibleCustomerSelector);
});

test('feature-flag fallback CRUD stays attached to canonical legacy form selectors', () => {
  const flow = read('qa/flows/ux-products-clients-flags-e2e.json');
  for (const marker of [
    "#product-form input[name='name']",
    "#product-form input[name='sku']",
    "#product-form input[name='salePrice']",
    "#product-form input[name='cost']",
    "#customer-form input[name='name']"
  ]) assert.ok(flow.includes(marker), `feature flag flow missing canonical selector ${marker}`);

  for (const stale of [
    '"selector":"#product-name"',
    '"selector":"#product-sku"',
    '"selector":"#product-sale-price"',
    '"selector":"#customer-name"',
    '"selector":"#customer-document"',
    '"selector":"#customer-phone"'
  ]) assert.equal(flow.includes(stale), false, `feature flag flow still uses stale selector ${stale}`);
});

test('paired UX has executable responsive evidence at supported desktop widths', () => {
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
    'setViewportSize',
    '1440',
    '900',
    '1180',
    '800',
    'expectNoHorizontalOverflow',
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

test('responsive modal evidence closes the canonical Product and Customer forms', () => {
  const flow = read('qa/flows/ux-products-clients-responsive-evidence.json');
  assert.ok(flow.includes('#product-form [data-close-modal]'), 'Products responsive evidence must close the canonical Product form');
  assert.ok(flow.includes('#customer-form [data-close-modal]'), 'Customers responsive evidence must close the canonical Customer form');
  assert.equal(flow.includes('.modal-actions .btn:not(.primary)'), false, 'responsive evidence must not depend on a non-existent generic button class');
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
  assert.equal(evidence.version, 2, 'paired evidence must use the verifiable-reference schema');

  const productKeys = Object.keys(evidence.products || {}).sort();
  const customerKeys = Object.keys(evidence.customers || {}).sort();
  assert.deepEqual(productKeys, customerKeys, 'Products and Customers must carry the same evidence categories');

  for (const key of [
    'featureFlag',
    'fallbackE2E',
    'parityMatrix',
    'unit',
    'controllerIntegration',
    'deepE2E',
    'crossFlow',
    'responsiveEvidence',
    'releaseRegistration'
  ]) {
    const productRefs = evidence.products?.[key];
    const customerRefs = evidence.customers?.[key];
    assert.ok(Array.isArray(productRefs) && productRefs.length > 0, `Products evidence missing ${key}`);
    assert.ok(Array.isArray(customerRefs) && customerRefs.length > 0, `Customers evidence missing ${key}`);
    assert.equal(productRefs.length, customerRefs.length, `${key}: Products and Customers must carry the same evidence depth`);
    assert.ok(productRefs.every(reference => reference && typeof reference.file === 'string'), `Products ${key} must use concrete file references`);
    assert.ok(customerRefs.every(reference => reference && typeof reference.file === 'string'), `Customers ${key} must use concrete file references`);
  }

  const guard = read('test/paired-ux-evolution-guard.test.js');
  assert.ok(guard.includes('ux-products-clients-evidence.json'), 'paired guard must read the evidence manifest');
  assert.ok(guard.includes('validateEvidenceReference'), 'paired guard must validate concrete evidence files and markers');
});

test('architecture docs describe the current progressive-enhancement state', () => {
  const inventory = read('docs/architecture/ux-products-clients-inventory.md');
  assert.ok(!inventory.includes('componentes criados na Entrega 2 permanecem inertes nesta branch'), 'inventory still claims the UX foundation is inert');

  const productParity = read('docs/architecture/products-dense-parity.md');
  assert.ok(productParity.includes('Caminho canônico'), 'Products parity doc must explicitly name the canonical rendering strategy');
  assert.ok(productParity.includes('progressive enhancement'), 'Products canonical strategy must remain progressive enhancement');
});
