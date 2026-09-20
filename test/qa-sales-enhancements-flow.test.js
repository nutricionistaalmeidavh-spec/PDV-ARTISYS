'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readText = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('deterministic sales enhancements flow is part of full and release QA', () => {
  const config = readJson('qa/artisys-qa.config.json');
  assert.equal(config.flows['sales-enhancements-release'], 'flows/sales-enhancements-release.json');
  assert.ok(config.qaProfiles.full.flows.includes('sales-enhancements-release'));
  assert.ok(config.qaProfiles.full.criticalFlows.includes('sales-enhancements-release'));
  assert.ok(config.qaProfiles.release.flows.includes('sales-enhancements-release'));
  assert.ok(config.qaProfiles.release.criticalFlows.includes('sales-enhancements-release'));
});

test('sales enhancements release flow covers the customer-facing commercial journey', () => {
  const flow = readJson('qa/flows/sales-enhancements-release.json');
  const names = new Set(flow.steps.map(step => step.name).filter(Boolean));
  for (const name of [
    'seller-created',
    'product-photo-control',
    'commission-rule-created',
    'seller-selected',
    'price-override-applied',
    'sale-observation-filled',
    'sale-completed',
    'sale-history-observation',
    'reports-period-and-seller',
  ]) assert.ok(names.has(name), `missing QA step ${name}`);

  assert.ok(flow.steps.some(step => step.uses === 'home.json'));
  assert.ok(flow.steps.some(step => step.selector === '#seller-select'));
  assert.ok(flow.steps.some(step => step.selector === '[data-price-item]'));
  assert.ok(flow.steps.some(step => step.selector === '#sale-observation'));
  assert.ok(flow.steps.some(step => step.selector === '#reports-filter'));
  assert.ok(flow.steps.some(step => step.selector === '#reports-commission-rule'));
  assert.ok(flow.steps.some(step => step.selector === '[data-product-photo-edit]'));
  assert.ok(flow.steps.some(step => step.action === 'screenshot' && step.name === 'sales-enhancements-release'));
});

test('legacy sales enhancements diagnostic flow remains registered but does not gate release', () => {
  const config = readJson('qa/artisys-qa.config.json');
  assert.equal(config.flows['sales-enhancements'], 'flows/sales-enhancements.json');
  assert.equal(config.qaProfiles.full.flows.includes('sales-enhancements'), false);
  assert.equal(config.qaProfiles.release.flows.includes('sales-enhancements'), false);
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
