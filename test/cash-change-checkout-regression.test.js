'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ui = require('../desktop/renderer/ui-model');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('cash change model computes received, remaining and change in cents', () => {
  assert.deepEqual(ui.calculateCashChange(199, 1000), {
    receivedCents: 1000,
    remainingCents: 0,
    changeCents: 801,
    sufficient: true
  });
  assert.deepEqual(ui.calculateCashChange(199, 100), {
    receivedCents: 100,
    remainingCents: 99,
    changeCents: 0,
    sufficient: false
  });
});

test('checkout loads cash change UI and sends received cash instead of sale due amount', () => {
  const cashUi = read('desktop/renderer/cash-change-ui.js');
  const index = read('desktop/renderer/index.html');

  assert.match(index, /<script src="\.\/app\.js"><\/script>\s*<script src="\.\/cash-change-ui\.js"><\/script>/);
  assert.match(cashUi, /id="cash-received-value"/);
  assert.match(cashUi, /id="cash-change-value"/);
  assert.match(cashUi, /amountCents:cashReceivedCents/);
  assert.match(cashUi, /confirm\.disabled = !summary\.sufficient/);
});
