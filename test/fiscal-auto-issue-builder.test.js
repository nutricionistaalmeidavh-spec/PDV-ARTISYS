'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerFiscalAutoIssueEffect } = require('../js/domains/fiscal/fiscal-effects');

function makeHarness() {
  let subscribed = null;
  let request = null;
  const bus = {
    subscribe(type, handler) {
      subscribed = { type, handler };
      return () => {};
    }
  };
  const effectStore = {
    async hasApplied(){ return false; },
    async markApplied(){ }
  };
  const sale = {
    id:'sale-auto', saleNumber:'V-AUTO-1', status:'COMPLETED', subtotalCents:1000, discountCents:0, totalCents:1000, changeCents:0,
    completedAt:'2026-09-20T19:00:00-03:00', customerId:null,
    items:[{ id:'item-auto', productId:'p-auto', productName:'Produto Auto', sku:'AUTO', quantity:1, unitPriceCents:1000, totalCents:1000 }],
    payments:[{ id:'pay-auto', method:'PIX', amountCents:1000 }]
  };
  const saleService = { getSaleDetails(){ return sale; } };
  const fiscalService = { requestIssue(input){ request = input; return { id:'fiscal-auto' }; } };
  return { bus, effectStore, sale, saleService, fiscalService, getSubscription:()=>subscribed, getRequest:()=>request };
}

function fiscalContext() {
  return {
    issuer:{
      cnpj:'12345678000195', legalName:'EMPRESA HOMOLOGACAO LTDA', tradeName:'EMPRESA HOMOLOGACAO', stateRegistration:'123456789', crt:'1',
      address:{ street:'Rua Teste', number:'100', district:'Centro', cityCode:'3543402', city:'Ribeirao Preto', state:'SP', zip:'14000000' }
    },
    series:'1', number:'88', operationNature:'VENDA',
    items:{ 'p-auto':{ ncm:'22021000', cfop:'5102', unit:'UN', origin:'0', csosn:'102', pisCst:'49', cofinsCst:'49' } }
  };
}

test('auto-issue acbr-local builds and persists canonical FiscalDocument when fiscalContext is configured', async () => {
  const harness = makeHarness();
  registerFiscalAutoIssueEffect({
    bus:harness.bus,
    effectStore:harness.effectStore,
    fiscalService:harness.fiscalService,
    saleService:harness.saleService,
    resolveConfiguration:async () => ({
      configured:true,
      autoIssue:true,
      provider:'acbr-local',
      environment:'homologation',
      documentType:'nfce',
      fiscalContext:fiscalContext()
    })
  });
  assert.equal(harness.getSubscription().type, 'sale.completed');
  await harness.getSubscription().handler({
    eventId:'evt-auto', aggregate:'sale', aggregateId:'sale-auto', actor:{ userId:'u1' }, mutationId:'m1'
  });
  const request = harness.getRequest();
  assert.equal(request.provider, 'acbr-local');
  assert.equal(request.payload.schemaVersion, 1);
  assert.equal(request.payload.documentType, 'nfce');
  assert.equal(request.payload.identification.model, '65');
  assert.equal(request.payload.identification.number, '88');
  assert.equal(request.payload.totals.totalCents, harness.sale.totalCents);
  assert.equal(request.payload.items[0].tax.ncm, '22021000');
});

test('auto-issue remains backward-compatible for optional providers without fiscalContext', async () => {
  const harness = makeHarness();
  const legacyPayload = { legacy:true };
  registerFiscalAutoIssueEffect({
    bus:harness.bus,
    effectStore:harness.effectStore,
    fiscalService:harness.fiscalService,
    saleService:harness.saleService,
    resolveConfiguration:async () => ({
      configured:true,
      autoIssue:true,
      provider:'focus',
      environment:'homologation',
      documentType:'nfce',
      payload:legacyPayload
    })
  });
  await harness.getSubscription().handler({ eventId:'evt-focus', aggregate:'sale', aggregateId:'sale-auto' });
  assert.deepEqual(harness.getRequest().payload, legacyPayload);
});
