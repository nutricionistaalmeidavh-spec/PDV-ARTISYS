'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

const FLOW = 'products-deep-e2e';

test('deep Products E2E is a critical full/release gate', () => {
  const config = readJson('qa/artisys-qa.config.json');
  assert.equal(config.flows[FLOW], `flows/${FLOW}.json`);
  for (const profile of ['full', 'release']) {
    assert.ok(config.qaProfiles[profile].flows.includes(FLOW), `${profile} must execute ${FLOW}`);
    assert.ok(config.qaProfiles[profile].criticalFlows.includes(FLOW), `${profile} must fail closed on ${FLOW}`);
  }
});

test('deep Products flow exercises the complete product surface through real UI actions', () => {
  const flowPath = path.join(root, 'qa', 'flows', `${FLOW}.json`);
  assert.equal(fs.existsSync(flowPath), true, `${FLOW}.json must exist`);
  const source = fs.readFileSync(flowPath, 'utf8');
  const requiredMarkers = [
    '#new-category',
    '#new-product',
    '#product-form',
    '#product-fiscal-fields',
    'fiscalProfileId',
    'data-product-photo-edit',
    'data-new-product-variant',
    '#product-variant-form',
    'data-new-kit',
    '#kc-kit-form',
    'data-new-combo',
    '#kc-combo-form',
    '#product-page-search',
    '#product-category-filter',
    '#products-stock-filter',
    "data-route='checkout'",
    "data-route='inventory'",
    "data-route='reports'"
  ];
  for (const marker of requiredMarkers) assert.ok(source.includes(marker), `deep Products flow missing ${marker}`);
});

test('deep Products low-stock report assertion has a valid inventory precondition', () => {
  const flow = readJson(`qa/flows/${FLOW}.json`);
  const step = name => flow.steps.find(item => item.name === name);
  const minimum = Number(step('products-deep-product-minimum')?.value);
  const opening = Number(step('products-deep-inventory-quantity')?.value);
  const expectedAfterSale = Number(String(step('products-deep-stock-after-sale')?.expected || '').split(/\s+/)[0]);
  assert.ok(Number.isFinite(minimum) && Number.isFinite(opening) && Number.isFinite(expectedAfterSale));
  assert.equal(expectedAfterSale, opening - 1, 'the checkout sale must consume exactly one unit');
  assert.ok(expectedAfterSale <= minimum, 'the final stock must be at/below minimum so the low-stock report can list the product');
});

test('QA photo selection is isolated in the photo bridge and keeps the production picker intact', () => {
  const bridge = read('desktop/product-photo-bridge.cjs');
  assert.match(bridge, /process\.env\.ARTISYS_QA\s*!==\s*'1'/);
  assert.match(bridge, /resolveQaProductPhotoFixture/);
  assert.match(bridge, /qaFixturePath/);
  assert.match(bridge, /dialog\.showOpenDialog/);
  assert.match(bridge, /client\.upload/);
});
