const test = require('node:test');
const assert = require('node:assert/strict');
const { toCents, formatCents } = require('../js/domains/shared/money');
const { resolvePayment } = require('../js/domains/payments/payment-rules');

test('toCents converts decimal BRL safely to integer cents', () => {
  assert.equal(toCents(125.5), 12550);
  assert.equal(toCents('98.90'), 9890);
  assert.equal(formatCents(9890), 'R$ 98,90');
});

test('resolvePayment reports remaining amount', () => {
  const summary = resolvePayment({
    totalCents: 12550,
    payments: [
      { method: 'CASH', amountCents: 5000 },
      { method: 'PIX', amountCents: 2525 }
    ]
  });
  assert.equal(summary.status, 'insufficient');
  assert.equal(summary.paidTotalCents, 7525);
  assert.equal(summary.remainingTotalCents, 5025);
  assert.equal(summary.changeDueCents, 0);
});

test('resolvePayment returns change only from cash-like payments', () => {
  const summary = resolvePayment({
    totalCents: 9890,
    payments: [
      { method: 'CASH', amountCents: 10000 },
      { method: 'STORE_CREDIT', amountCents: 2000 }
    ],
    creditMethods: ['STORE_CREDIT'],
    changeMethods: ['CASH']
  });
  assert.equal(summary.status, 'paid');
  assert.equal(summary.creditTotalCents, 2000);
  assert.equal(summary.changeDueCents, 110);
});

test('resolvePayment rejects store credit above available limit', () => {
  assert.throws(() => resolvePayment({
    totalCents: 20000,
    payments: [{ method: 'STORE_CREDIT', amountCents: 20000 }],
    creditMethods: ['STORE_CREDIT'],
    availableCreditCents: 15000,
    customerName: 'Maria Oliveira'
  }), /Limite de credito insuficiente/);
});

test('resolvePayment rejects invalid negative or fractional cents', () => {
  assert.throws(() => resolvePayment({ totalCents: 1000.5, payments: [] }), /centavos inteiros/);
  assert.throws(() => resolvePayment({ totalCents: 1000, payments: [{ method: 'CASH', amountCents: -1 }] }), /nao pode ser negativo/);
});
