'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

function actor() {
  return { userId:'mgr', role:'manager', terminalId:'PDV-01' };
}

function seed(runtime) {
  runtime.db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('mgr','gerente','Gerente','manager','hash','salt',1,'2026-09-20T12:00:00Z','2026-09-20T12:00:00Z');
  runtime.catalog.upsertCategory({ id:'cat1', name:'Geral' });
  runtime.catalog.upsertProduct({
    id:'p1',
    sku:'SKU-FISCAL-1',
    name:'Produto Fiscal',
    salePriceCents:1000,
    costCents:500,
    trackStock:true,
    minimumStock:1
  });
  runtime.inventory.move({ productId:'p1', type:'opening', quantityDelta:5, reason:'saldo inicial' });
  runtime.cash.openSession({
    id:'cash1',
    terminalId:'PDV-01',
    operatorId:'mgr',
    initialCashCents:0,
    actor:actor()
  });
}

function completeSale(runtime, id = 'sale1') {
  const sale = runtime.sales.openSale({
    id,
    saleNumber:`S-${id}`,
    terminalId:'PDV-01',
    operatorId:'mgr'
  }, actor());
  runtime.sales.addItem(sale.id, { productId:'p1', quantity:2 });
  return runtime.sales.completeSale(sale.id, {
    payments:[{ method:'CASH', amountCents:2000 }],
    actor:actor()
  });
}

async function drain(runtime, maxPasses = 8) {
  const results = [];
  for (let index = 0; index < maxPasses; index += 1) {
    const result = await runtime.dispatchPending();
    results.push(result);
    if (result.attempted === 0) break;
  }
  return results;
}

function createAutoIssueResolver() {
  return async ({ sale }) => ({
    configured:true,
    autoIssue:true,
    provider:'focus',
    environment:'homologation',
    documentType:'nfce',
    reference:sale.saleNumber || sale.id,
    payload:{ natureza_operacao:'Venda' }
  });
}

test('E2E invariant: fiscal failure never rolls back sale, stock or cash and retry stays idempotent', async () => {
  let providerCalls = 0;
  const runtime = createPdvRuntime({
    fiscalProviderResolver:async () => ({
      issue:async () => {
        providerCalls += 1;
        return { ok:false, status:503, error:'SEFAZ indisponivel' };
      }
    }),
    fiscalAutoIssueResolver:createAutoIssueResolver()
  });
  seed(runtime);
  completeSale(runtime);
  await drain(runtime);

  const sale = runtime.sales.getSale('sale1');
  assert.equal(sale.status, 'COMPLETED');
  assert.equal(runtime.inventory.getBalance('p1'), 3);

  const session = runtime.cash.getOpenSession('PDV-01');
  const saleMovements = runtime.cash.listSessionMovements(session.id).filter(item => item.type === 'SALE' && item.saleId === 'sale1');
  assert.equal(saleMovements.length, 1);
  assert.equal(saleMovements[0].amountCents, 2000);

  const documents = runtime.fiscal.listDocuments({ saleId:'sale1' });
  assert.equal(documents.length, 1);
  assert.equal(documents[0].status, 'FAILED');
  assert.equal(providerCalls, 1);

  const stockBeforeRetry = runtime.inventory.getBalance('p1');
  const cashBeforeRetry = runtime.cash.listSessionMovements(session.id).map(item => ({ ...item }));
  runtime.fiscal.retryIssue(documents[0].id, { actor:actor() });
  await drain(runtime);

  assert.equal(runtime.fiscal.listDocuments({ saleId:'sale1' }).length, 1);
  assert.equal(runtime.inventory.getBalance('p1'), stockBeforeRetry);
  assert.deepEqual(runtime.cash.listSessionMovements(session.id), cashBeforeRetry);
  assert.equal(providerCalls, 2);
  runtime.close();
});

test('E2E invariant: fiscal pending/failed state survives process restart', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artisys-fiscal-invariant-'));
  const dbPath = path.join(tempDir, 'pdv.sqlite');

  const first = createPdvRuntime({
    dbPath,
    fiscalProviderResolver:async () => ({
      issue:async () => ({ ok:false, status:503, error:'Falha externa simulada' })
    }),
    fiscalAutoIssueResolver:createAutoIssueResolver()
  });
  seed(first);
  completeSale(first);
  await drain(first);

  const before = first.fiscal.listDocuments({ saleId:'sale1' });
  assert.equal(before.length, 1);
  assert.equal(before[0].status, 'FAILED');
  assert.equal(first.sales.getSale('sale1').status, 'COMPLETED');
  first.close();

  const second = createPdvRuntime({ dbPath });
  const after = second.fiscal.listDocuments({ saleId:'sale1' });
  assert.equal(after.length, 1);
  assert.equal(after[0].id, before[0].id);
  assert.equal(after[0].status, 'FAILED');
  assert.equal(second.sales.getSale('sale1').status, 'COMPLETED');
  assert.equal(second.inventory.getBalance('p1'), 3);
  const session = second.cash.getOpenSession('PDV-01');
  assert.equal(second.cash.listSessionMovements(session.id).filter(item => item.type === 'SALE' && item.saleId === 'sale1').length, 1);
  second.close();

  fs.rmSync(tempDir, { recursive:true, force:true });
});

test('E2E invariant: installations without fiscal auto-issue keep selling with zero fiscal documents', async () => {
  const runtime = createPdvRuntime();
  seed(runtime);
  completeSale(runtime);
  await drain(runtime);

  assert.equal(runtime.sales.getSale('sale1').status, 'COMPLETED');
  assert.equal(runtime.inventory.getBalance('p1'), 3);
  assert.equal(runtime.fiscal.listDocuments({ saleId:'sale1' }).length, 0);
  const session = runtime.cash.getOpenSession('PDV-01');
  assert.equal(runtime.cash.listSessionMovements(session.id).filter(item => item.type === 'SALE' && item.saleId === 'sale1').length, 1);
  runtime.close();
});
