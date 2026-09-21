'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function includesAll(source, markers, label) {
  for (const marker of markers) assert.ok(source.includes(marker), `${label}: missing ${marker}`);
}

test('Customers master-detail assets load around app without removing legacy renderer assets', () => {
  const index = read('desktop/renderer/index.html');
  includesAll(index, [
    './ux-components.css',
    './customers-master-detail.css',
    './ux-components.js',
    './feature-flags.js',
    './customers-master-detail-view.js',
    './app.js',
    './customers-master-detail-controller.js'
  ], 'index');
  assert.ok(index.indexOf('./feature-flags.js') < index.indexOf('./app.js'));
  assert.ok(index.indexOf('./customers-master-detail-view.js') < index.indexOf('./app.js'));
  assert.ok(index.indexOf('./app.js') < index.indexOf('./customers-master-detail-controller.js'));
});

test('Customers master-detail is enabled by a reversible global feature flag', () => {
  const flags = read('desktop/renderer/feature-flags.js');
  includesAll(flags, [
    'customersMasterDetailView: true',
    'window.PdvFeatureFlags',
    'customersMasterDetailView'
  ], 'feature flags');
});

test('legacy Customers renderer remains untouched as the source of form/search/edit handlers', () => {
  const app = read('desktop/renderer/app.js');
  includesAll(app, [
    'function renderCustomers()',
    'function openCustomerForm(customer = null)',
    'id="new-customer"',
    'id="customer-page-search"',
    'data-edit-customer=',
    'id="customer-form"',
    'api.saveCustomer',
    'creditLimitCents',
    'creditUsedCents'
  ], 'legacy app');
});

test('master-detail controller augments existing customer rows and reuses the canonical edit action', () => {
  const controller = read('desktop/renderer/customers-master-detail-controller.js');
  includesAll(controller, [
    'PdvFeatureFlags.customersMasterDetailView',
    'PdvCustomersMasterDetail',
    'ArtisysUxComponents',
    'function decorateCustomers',
    'function restoreLegacy',
    '#customer-page-search',
    '[data-edit-customer]',
    'data-customer-master-row',
    'data-customer-last-sale',
    'data-customers-master-panel',
    "originalEdit?.click()"
  ], 'master-detail controller');
  assert.equal(controller.includes('data-edit-customer="'), false, 'controller must not rebuild canonical edit buttons');
  assert.equal(controller.includes('id="customer-form"'), false, 'controller must not rebuild the canonical customer form');
});

test('customer history uses canonical sales data and never invents a frontend-only purchase record', () => {
  const controller = read('desktop/renderer/customers-master-detail-controller.js');
  const view = read('desktop/renderer/customers-master-detail-view.js');
  includesAll(controller, [
    "api.sales('COMPLETED', 200)",
    'salesLoadedAt',
    'historyOpen',
    'PdvCustomersMasterDetail.salesForCustomer'
  ], 'history controller');
  includesAll(view, [
    'function salesForCustomer',
    'function latestSaleForCustomer',
    'sale.customerId',
    'sale.completedAt',
    'sale.totalCents'
  ], 'history view');
});

test('delivery address extension and full customer form remain connected after master-detail enhancement', () => {
  const address = read('desktop/renderer/delivery-address-ui.js');
  includesAll(address, [
    "document.getElementById('customer-form')",
    '[data-customer-address]',
    'p.saveCustomer=function(body)',
    "field('postalCode','CEP'",
    "field('street','Logradouro')"
  ], 'delivery address');
});

test('phase 6 customer parity matrix is versioned and blocks legacy removal', () => {
  const matrixPath = path.join(root, 'docs', 'architecture', 'customers-master-detail-parity.md');
  assert.equal(fs.existsSync(matrixPath), true);
  const matrix = fs.readFileSync(matrixPath, 'utf8');
  includesAll(matrix, [
    'Feature flag',
    'Legacy',
    'Master-detail',
    'Novo cliente',
    'Busca',
    'Editar ficha',
    'Endereço de entrega',
    'Crédito',
    'Histórico',
    'Cliente → Venda',
    'não remover o renderer legado'
  ], 'customer parity matrix');
});
