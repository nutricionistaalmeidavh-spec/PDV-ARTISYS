'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const readJson = relative => JSON.parse(read(relative));

test('customers deep E2E is registered as critical in full and release', () => {
  const config = readJson('qa/artisys-qa.config.json');
  assert.equal(config.flows['customers-deep-e2e'], 'flows/customers-deep-e2e.json');
  for (const profileName of ['full', 'release']) {
    const profile = config.qaProfiles[profileName];
    assert.ok(profile.flows.includes('customers-deep-e2e'), `${profileName}: customers deep flow missing`);
    assert.ok(profile.criticalFlows.includes('customers-deep-e2e'), `${profileName}: customers deep flow is not critical`);
  }
});

test('customers deep E2E covers canonical CRUD, address persistence, linked sale, history and reports', () => {
  const flow = read('qa/flows/customers-deep-e2e.json');
  for (const marker of [
    'customers-deep-e2e',
    '#new-customer',
    '#customer-form',
    '#customer-name',
    '#customer-document',
    '#customer-phone',
    '#customer-email',
    '#customer-credit-limit',
    '#customer-notes',
    '#customer-active',
    '[data-customer-address]',
    '[name="zipCode"]',
    '[name="street"]',
    '[name="number"]',
    '[name="district"]',
    '[name="city"]',
    '[name="state"]',
    '[data-action="edit-customer"]',
    'expectValue',
    '#customer-search',
    '[data-customer-history-panel]',
    '1 venda vinculada',
    '[data-report-view="customers"]'
  ]) assert.ok(flow.includes(marker), `customers deep flow missing marker: ${marker}`);
});
