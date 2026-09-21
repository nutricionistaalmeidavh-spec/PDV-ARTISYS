'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const view = require(path.join(__dirname, '..', 'desktop', 'renderer', 'customers-master-detail-view.js'));
const components = require(path.join(__dirname, '..', 'desktop', 'renderer', 'ux-components.js'));

test('customer master-detail exports the same guarded maturity contract expected by paired UX', () => {
  assert.equal(view.CUSTOMERS_UX_LEVEL, 2);
  assert.deepEqual(view.CUSTOMERS_UX_GUARDS, {
    reversible: true,
    progressiveEnhancement: true,
    legacyHandlersPreserved: true,
    parityGuarded: true
  });
});

test('creditSnapshot derives available credit without allowing a negative display balance', () => {
  assert.deepEqual(view.creditSnapshot({ creditLimitCents: 10000, creditUsedCents: 2500 }), {
    limitCents: 10000,
    usedCents: 2500,
    availableCents: 7500
  });
  assert.equal(view.creditSnapshot({ creditLimitCents: 1000, creditUsedCents: 1500 }).availableCents, 0);
});

test('salesForCustomer filters only the selected customer and orders most recent first', () => {
  const sales = [
    { id:'s-old', customerId:'c-1', completedAt:'2026-09-01T10:00:00.000Z' },
    { id:'s-other', customerId:'c-2', completedAt:'2026-09-20T10:00:00.000Z' },
    { id:'s-new', customerId:'c-1', completedAt:'2026-09-10T10:00:00.000Z' }
  ];
  assert.deepEqual(view.salesForCustomer(sales, 'c-1').map(sale => sale.id), ['s-new', 's-old']);
  assert.equal(view.latestSaleForCustomer(sales, 'c-2').id, 's-other');
  assert.equal(view.latestSaleForCustomer(sales, 'missing'), null);
});

test('formatAddress keeps structured delivery-address information visible in the detail panel', () => {
  assert.equal(
    view.formatAddress({ street:'Rua A', number:'10', complement:'Sala 2', district:'Centro', city:'Ribeirão Preto', state:'SP', postalCode:'14000000' }),
    'Rua A, 10 · Sala 2 · Centro · Ribeirão Preto/SP · CEP 14000000'
  );
  assert.equal(view.formatAddress(null), '—');
});

test('renderCustomerDetail uses real credit, last purchase, address and canonical panel actions', () => {
  const customer = {
    id:'c-1', name:'Marcos Lima', document:'12345678900', phone:'16999992222', email:'marcos@example.com',
    notes:'Cliente recorrente', active:true, creditLimitCents:10000, creditUsedCents:2500,
    address:{ street:'Rua A', number:'10', city:'Ribeirão Preto', state:'SP' }
  };
  const sales = [{ id:'s-1', customerId:'c-1', saleNumber:'V-100', completedAt:'2026-09-20T10:00:00.000Z', totalCents:4590, status:'COMPLETED' }];
  const html = view.renderCustomerDetail({
    customer,
    sales,
    components,
    formatCents:cents => `R$ ${(Number(cents)/100).toFixed(2)}`,
    formatDate:value => value ? '20/09/2026' : '—',
    historyOpen:true
  });

  assert.match(html, /Marcos Lima/);
  assert.match(html, /Crédito disponível/);
  assert.match(html, /R\$ 75\.00/);
  assert.match(html, /R\$ 25\.00/);
  assert.match(html, /20\/09\/2026/);
  assert.match(html, /Rua A, 10/);
  assert.match(html, /data-action="edit-customer"/);
  assert.match(html, /data-action="customer-history"/);
  assert.match(html, /V-100/);
  assert.match(html, /R\$ 45\.90/);
});
