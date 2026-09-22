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
    "#customer-form input[name='name']",
    "#customer-form input[name='document']",
    "#customer-form input[name='phone']",
    "#customer-form input[name='email']",
    "#customer-form input[name='creditLimit']",
    "#customer-form textarea[name='notes']",
    "#customer-form input[name='active']",
    'data-customer-address',
    'postalCode',
    'street',
    'number',
    'district',
    'city',
    'state',
    'edit-customer',
    'expectValue',
    '[data-close-modal]',
    '#customer-search',
    'data-customer-history-panel',
    '1 venda vinculada',
    'data-report-view',
    'customers'
  ]) assert.ok(flow.includes(marker), `customers deep flow missing marker: ${marker}`);
});

test('customers deep E2E selectors stay aligned with the canonical legacy form', () => {
  const app = read('desktop/renderer/app.js');
  for (const marker of [
    'id="customer-form"',
    'input name="name"',
    'input name="document"',
    'input name="phone"',
    'input name="email"',
    'input name="creditLimit"',
    'textarea name="notes"',
    'input name="active"',
    'data-close-modal'
  ]) assert.ok(app.includes(marker), `canonical customer form missing marker: ${marker}`);
});
