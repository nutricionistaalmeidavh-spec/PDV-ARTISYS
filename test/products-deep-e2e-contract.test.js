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
    'data-route="checkout"',
    'data-route="inventory"',
    'data-route="reports"'
  ];
  for (const marker of requiredMarkers) assert.ok(source.includes(marker), `deep Products flow missing ${marker}`);
});

test('QA photo selection uses a deterministic fixture only under ARTISYS_QA and keeps the production picker intact', () => {
  const bridge = read('desktop/product-photo-bridge.cjs');
  const main = read('desktop/main.cjs');
  assert.match(main, /ARTISYS_QA/);
  assert.match(main, /qaProductPhotoFixture/);
  assert.match(bridge, /qaFixturePath/);
  assert.match(bridge, /dialog\.showOpenDialog/);
  assert.match(bridge, /client\.upload/);
});
