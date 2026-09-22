'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const products = require(path.join(root, 'desktop', 'renderer', 'products-dense-view.js'));
const customers = require(path.join(root, 'desktop', 'renderer', 'customers-master-detail-view.js'));

test('Products and Customers remain at the same guarded UX maturity level', () => {
  assert.equal(products.PRODUCTS_UX_LEVEL, customers.CUSTOMERS_UX_LEVEL,
    'evolução estrutural em uma tela exige elevar a outra para o mesmo UX level');
  assert.deepEqual(products.PRODUCTS_UX_GUARDS, customers.CUSTOMERS_UX_GUARDS,
    'as duas telas devem manter o mesmo conjunto de garantias de evolução');
});

test('paired screens keep symmetrical reversible enhancement architecture', () => {
  const productController = read('desktop/renderer/products-dense-controller.js');
  const customerController = read('desktop/renderer/customers-master-detail-controller.js');

  for (const [label, source, flag, restore] of [
    ['Produtos', productController, 'productsDenseView', 'restoreLegacy'],
    ['Clientes', customerController, 'customersMasterDetailView', 'restoreLegacy']
  ]) {
    for (const marker of [flag, `function ${restore}`, 'scheduleDecorate', 'MutationObserver', "event.key.toLowerCase() !== 'k'"]) {
      assert.ok(source.includes(marker), `${label}: arquitetura pareada ausente: ${marker}`);
    }
  }
});

test('paired screens are both loaded, flagged, parity-documented and regression-tested', () => {
  const index = read('desktop/renderer/index.html');
  const flags = read('desktop/renderer/feature-flags.js');
  for (const marker of [
    './products-dense-view.css', './customers-master-detail.css',
    './products-dense-view.js', './customers-master-detail-view.js',
    './products-dense-controller.js', './customers-master-detail-controller.js'
  ]) assert.ok(index.includes(marker), `index: paired UX asset missing: ${marker}`);

  assert.ok(flags.includes('productsDenseView: true'));
  assert.ok(flags.includes('customersMasterDetailView: true'));

  for (const file of [
    'docs/architecture/products-dense-parity.md',
    'docs/architecture/customers-master-detail-parity.md',
    'docs/architecture/paired-ux-evolution.md',
    'docs/architecture/ux-products-clients-evidence.json',
    'test/products-dense-integration-parity.test.js',
    'test/customers-master-detail-integration-parity.test.js',
    'test/products-deep-e2e-contract.test.js',
    'test/customers-deep-e2e-contract.test.js'
  ]) assert.equal(fs.existsSync(path.join(root, file)), true, `paired UX artifact missing: ${file}`);
});

function validateEvidenceReference(entity, key, reference) {
  assert.equal(typeof reference, 'object', `${entity}.${key}: evidence reference must be an object`);
  assert.equal(typeof reference.file, 'string', `${entity}.${key}: evidence file must be a string`);
  assert.ok(reference.file.length > 0 && !reference.file.includes('..'), `${entity}.${key}: invalid evidence path`);
  const absolute = path.join(root, reference.file);
  assert.equal(fs.existsSync(absolute), true, `${entity}.${key}: evidence file missing: ${reference.file}`);
  const source = fs.readFileSync(absolute, 'utf8');
  for (const marker of reference.markers || []) {
    assert.equal(typeof marker, 'string', `${entity}.${key}: marker must be a string`);
    assert.ok(source.includes(marker), `${entity}.${key}: marker ${JSON.stringify(marker)} missing from ${reference.file}`);
  }
}

test('paired UX evidence manifest resolves to concrete files and blocks evidence-free maturity bumps', () => {
  const manifest = JSON.parse(read('docs/architecture/ux-products-clients-evidence.json'));
  assert.equal(manifest.version, 2, 'paired evidence manifest must use verifiable-reference schema v2');

  const expectedKeys = [
    'featureFlag',
    'fallbackE2E',
    'parityMatrix',
    'unit',
    'controllerIntegration',
    'deepE2E',
    'crossFlow',
    'responsiveEvidence',
    'releaseRegistration'
  ];

  for (const entity of ['products', 'customers']) {
    assert.deepEqual(Object.keys(manifest[entity]).sort(), [...expectedKeys].sort(), `${entity}: evidence categories drifted`);
    for (const key of expectedKeys) {
      const references = manifest[entity][key];
      assert.ok(Array.isArray(references) && references.length > 0, `${entity}.${key}: at least one concrete reference is required`);
      for (const reference of references) validateEvidenceReference(entity, key, reference);
    }
  }

  for (const key of expectedKeys) {
    assert.equal(manifest.products[key].length, manifest.customers[key].length,
      `${key}: Produtos e Clientes precisam ter a mesma profundidade de evidência`);
  }
});

test('paired evolution policy requires bumping both local UX levels for structural changes', () => {
  const policy = read('docs/architecture/paired-ux-evolution.md');
  for (const marker of [
    'PRODUCTS_UX_LEVEL',
    'CUSTOMERS_UX_LEVEL',
    'mesmo valor',
    'alteração estrutural',
    'CI deve falhar',
    'Produtos',
    'Clientes'
  ]) assert.ok(policy.includes(marker), `paired evolution policy missing: ${marker}`);
});
