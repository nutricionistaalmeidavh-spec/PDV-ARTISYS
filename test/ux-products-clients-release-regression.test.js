'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const config = JSON.parse(read('qa/artisys-qa.config.json'));
const products = require(path.join(root, 'desktop', 'renderer', 'products-dense-view.js'));
const customers = require(path.join(root, 'desktop', 'renderer', 'customers-master-detail-view.js'));

const CROSS_FLOW = 'ux-products-clients-cross-flow';
const CROSS_FLOW_FILE = 'qa/flows/ux-products-clients-cross-flow.json';

function includesAll(source, markers, label) {
  for (const marker of markers) assert.ok(source.includes(marker), `${label}: missing ${marker}`);
}

test('Entrega 7 registers a real Products + Customers cross-flow as critical full/release QA', () => {
  assert.equal(config.flows[CROSS_FLOW], 'flows/ux-products-clients-cross-flow.json');
  assert.equal(fs.existsSync(path.join(root, CROSS_FLOW_FILE)), true, `${CROSS_FLOW_FILE} must exist`);

  for (const profileName of ['full', 'release']) {
    const profile = config.qaProfiles[profileName];
    assert.ok(profile.flows.includes(CROSS_FLOW), `${profileName}: cross-flow must execute`);
    assert.ok(profile.criticalFlows.includes(CROSS_FLOW), `${profileName}: cross-flow must be critical`);
  }
});

test('Entrega 7 cross-flow exercises customer -> sale -> history and product -> sale -> stock -> reports', () => {
  const flow = read(CROSS_FLOW_FILE);
  includesAll(flow, [
    "[data-route='customers']",
    '#new-customer',
    "#customer-form input[name='name']",
    'QA UX Cliente Integrado',
    "[data-route='products']",
    '#new-product',
    "#product-form input[name='name']",
    'QA UX Produto Integrado',
    "[data-route='inventory']",
    '#ops-inventory-form',
    "[data-route='checkout']",
    '#customer-search',
    '[data-customer-id]',
    ".product-card:has-text('QA UX Produto Integrado')",
    '#finalize-sale',
    '#confirm-payment',
    '[data-customers-master-panel]',
    "[data-action='customer-history']",
    '[data-customer-history-panel]',
    '2 UN',
    "[data-route='reports']",
    "[data-report-view='customers']",
    "[data-report-view='products']"
  ], 'cross-flow');
});

test('Entrega 8 makes the release profile a complete regression gate over every registered QA flow', () => {
  const registered = Object.keys(config.flows).sort();
  const release = [...config.qaProfiles.release.flows].sort();
  assert.deepEqual(release, registered, 'release must execute every registered QA flow');

  const releaseCritical = new Set(config.qaProfiles.release.criticalFlows);
  for (const flow of registered) assert.ok(releaseCritical.has(flow), `release criticalFlows missing ${flow}`);
});

test('paired UX maturity advances together to cross-flow + release-regression guarded level', () => {
  assert.equal(products.PRODUCTS_UX_LEVEL, customers.CUSTOMERS_UX_LEVEL);
  assert.ok(products.PRODUCTS_UX_LEVEL >= 3, 'Products UX level must advance for Entregas 7/8');
  assert.deepEqual(products.PRODUCTS_UX_GUARDS, customers.CUSTOMERS_UX_GUARDS);
  assert.equal(products.PRODUCTS_UX_GUARDS.crossFlowGuarded, true);
  assert.equal(products.PRODUCTS_UX_GUARDS.releaseRegressionGuarded, true);
});

test('release-regression policy documents the two chained business invariants and paired gate', () => {
  const file = 'docs/architecture/ux-products-clients-release-regression.md';
  assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must exist`);
  const policy = read(file);
  includesAll(policy, [
    'Cliente → Venda → Histórico',
    'Produto → Venda → Estoque → Relatórios',
    'release',
    'criticalFlows',
    'PRODUCTS_UX_LEVEL',
    'CUSTOMERS_UX_LEVEL',
    'evolução despareada'
  ], 'release-regression policy');
});
