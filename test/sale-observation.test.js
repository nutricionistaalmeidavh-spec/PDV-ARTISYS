'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSaleObservation, formatReceiptObservation } = require('../js/domains/sales/sale-observation');

test('observacao interna preserva ate 500 caracteres', () => {
  const source = 'A'.repeat(550);
  assert.equal(sanitizeSaleObservation(source).length, 500);
});

test('observacao impressa fica limitada a 120 caracteres e quatro linhas', () => {
  const source = Array.from({ length: 20 }, (_, index) => `linha-${index + 1}`).join('\n');
  const formatted = formatReceiptObservation(source, 32);
  assert.ok(formatted.length > 0);
  assert.ok(formatted.replace(/\n/g, '').length <= 120);
  assert.ok(formatted.split('\n').length <= 4);
});

test('observacao impressa quebra palavras conforme a largura do cupom', () => {
  const formatted = formatReceiptObservation('Cliente retira amanha as 10h e levar duas caixas separadas.', 32);
  for (const line of formatted.split('\n')) assert.ok(line.length <= 32);
});
