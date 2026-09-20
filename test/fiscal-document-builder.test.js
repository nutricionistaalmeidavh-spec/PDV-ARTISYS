'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildFiscalDocument, allocateDiscountCents } = require('../js/domains/fiscal/fiscal-document-builder');

function sampleSale(overrides = {}) {
  return {
    id:'sale-1',
    saleNumber:'V-1001',
    status:'COMPLETED',
    subtotalCents:1500,
    discountCents:101,
    totalCents:1399,
    changeCents:0,
    completedAt:'2026-09-20T19:00:00-03:00',
    customerId:null,
    items:[
      { id:'i1', productId:'p1', productName:'Produto A', sku:'A-1', quantity:1, unitPriceCents:1000, totalCents:1000 },
      { id:'i2', productId:'p2', productName:'Produto B', sku:'B-1', quantity:1, unitPriceCents:500, totalCents:500 }
    ],
    payments:[{ id:'pay-1', method:'PIX', amountCents:1399 }],
    ...overrides
  };
}

function sampleFiscalContext(overrides = {}) {
  return {
    issuer:{
      cnpj:'12345678000195',
      legalName:'EMPRESA HOMOLOGACAO LTDA',
      tradeName:'EMPRESA HOMOLOGACAO',
      stateRegistration:'123456789',
      crt:'1',
      address:{ street:'Rua Teste', number:'100', district:'Centro', cityCode:'3543402', city:'Ribeirao Preto', state:'SP', zip:'14000000' }
    },
    series:'1',
    number:'42',
    operationNature:'VENDA',
    items:{
      p1:{ ncm:'22021000', cfop:'5102', unit:'UN', origin:'0', csosn:'102', pisCst:'49', cofinsCst:'49' },
      p2:{ ncm:'19059090', cfop:'5102', unit:'UN', origin:'0', csosn:'102', pisCst:'49', cofinsCst:'49' }
    },
    ...overrides
  };
}

test('allocates sale discount deterministically in cents and preserves exact total', () => {
  const allocations = allocateDiscountCents([
    { totalCents:1000 },
    { totalCents:500 }
  ], 101);
  assert.deepEqual(allocations, [67, 34]);
  assert.equal(allocations.reduce((sum, value) => sum + value, 0), 101);
});

test('builds canonical NFC-e from completed sale without recalculating the sale total', () => {
  const document = buildFiscalDocument({
    sale:sampleSale(),
    fiscalContext:sampleFiscalContext(),
    documentType:'nfce',
    environment:'homologation',
    reference:'V-1001'
  });

  assert.equal(document.documentType, 'nfce');
  assert.equal(document.environment, 'homologation');
  assert.equal(document.reference, 'V-1001');
  assert.equal(document.identification.model, '65');
  assert.equal(document.identification.series, '1');
  assert.equal(document.identification.number, '42');
  assert.equal(document.totals.subtotalCents, 1500);
  assert.equal(document.totals.discountCents, 101);
  assert.equal(document.totals.totalCents, 1399);
  assert.equal(document.items.reduce((sum, item) => sum + item.totalCents - item.discountCents, 0), 1399);
  assert.equal(document.payments.reduce((sum, payment) => sum + payment.amountCents, 0), 1399);
  assert.equal(document.items[0].tax.ncm, '22021000');
  assert.equal(document.items[0].tax.csosn, '102');
});

test('fails closed when a product has no resolved fiscal data and leaves the sale object untouched', () => {
  const sale = sampleSale();
  const snapshot = JSON.stringify(sale);
  const context = sampleFiscalContext({ items:{ p1:sampleFiscalContext().items.p1 } });
  assert.throws(() => buildFiscalDocument({
    sale,
    fiscalContext:context,
    documentType:'nfce',
    environment:'homologation',
    reference:'V-1001'
  }), /Dados fiscais ausentes.*p2/);
  assert.equal(JSON.stringify(sale), snapshot);
});

test('rejects non-completed sale and inconsistent canonical totals', () => {
  assert.throws(() => buildFiscalDocument({
    sale:sampleSale({ status:'OPEN' }),
    fiscalContext:sampleFiscalContext(),
    documentType:'nfce',
    environment:'homologation',
    reference:'V-1001'
  }), /venda concluida/i);

  assert.throws(() => buildFiscalDocument({
    sale:sampleSale({ totalCents:1400 }),
    fiscalContext:sampleFiscalContext(),
    documentType:'nfce',
    environment:'homologation',
    reference:'V-1001'
  }), /Total canonico inconsistente/);
});
