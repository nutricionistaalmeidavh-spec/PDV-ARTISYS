'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'qa', 'artisys-qa.config.json');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readText = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('sales enhancements flow is part of full and release QA', () => {
  const config = readJson('qa/artisys-qa.config.json');
  assert.equal(config.flows['sales-enhancements'], 'flows/sales-enhancements.json');
  assert.ok(config.qaProfiles.full.flows.includes('sales-enhancements'));
  assert.ok(config.qaProfiles.full.criticalFlows.includes('sales-enhancements'));
  assert.ok(config.qaProfiles.release.flows.includes('sales-enhancements'));
  assert.ok(config.qaProfiles.release.criticalFlows.includes('sales-enhancements'));
});

test('sales enhancements flow covers the new commercial features with screenshots', () => {
  const flow = readJson('qa/flows/sales-enhancements.json');
  const names = new Set(flow.steps.map(step => step.name));
  for (const name of [
    'qa-admin-setup',
    'qa-login',
    'seller-created',
    'product-photo-control',
    'commission-rule-created',
    'seller-selector',
    'price-override-applied',
    'sale-observation-filled',
    'sale-completed',
    'sale-history-observation',
    'reports-period-and-seller',
  ]) assert.ok(names.has(name), `missing QA step ${name}`);

  const screenshots = flow.steps.filter(step => step.action === 'screenshot').map(step => step.name);
  assert.ok(screenshots.includes('products-with-photo-control'));
  assert.ok(screenshots.includes('checkout-sales-enhancements'));
  assert.ok(screenshots.includes('sale-history-with-observation'));
  assert.ok(screenshots.includes('reports-by-period-seller-commission'));

  assert.ok(flow.steps.some(step => step.selector === '#seller-select'));
  assert.ok(flow.steps.some(step => step.selector === '[data-price-item]'));
  assert.ok(flow.steps.some(step => step.selector === '#sale-observation'));
  assert.ok(flow.steps.some(step => step.selector === '#ops-report-filter'));
  assert.ok(flow.steps.some(step => step.selector === '#ops-commission-rule'));
  assert.ok(flow.steps.some(step => step.selector === '[data-product-photo-edit]'));
  assert.ok(flow.steps.some(step => step.valueFromEnv === 'ARTISYS_QA_ADMIN_PASSWORD'));
});

test('QA Electron launcher isolates userData from the installed PDV database', () => {
  const config = readJson('qa/artisys-qa.config.json');
  assert.equal(config.electron.entry, 'desktop/main.cjs');
  const launcher = readText('qa/desktop/main.cjs');
  assert.match(launcher, /ARTISYS_QA/);
  assert.match(launcher, /app\.setPath\(['"]userData['"]/);
  assert.match(launcher, /os\.tmpdir\(\)/);
  assert.match(launcher, /require\(['"]\.\.\/\.\.\/desktop\/main\.cjs['"]\)/);
  assert.equal(config.environments.ci.env.PDV_ENABLE_LAN, 'false');
  assert.equal(config.environments.ci.env.PDV_AUTO_PRINT, 'false');
});
