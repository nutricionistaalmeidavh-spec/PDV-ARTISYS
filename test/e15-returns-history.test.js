'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

function seed(runtime) {
  runtime.db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('mgr','gerente','Gerente','manager','hash','salt',1,'2026-09-09T10:00:00Z','2026-09-09T10:00:00Z');
  runtime.catalog.upsertCategory({ id:'cat1', name:'Geral' });
  runtime.catalog.upsertProduct({ id:'p1', sku:'SKU-1', name:'Produto A', salePriceCents:1000, costCents:500, trackStock:true, minimumStock:1 });
  runtime.inventory.move({ productId:'p1', type:'opening', quantityDelta:5, reason:'saldo inicial' });
}

function cashActor() { return { userId:'mgr', role:'manager', terminalId:'PDV-01' }; }

async function completeSale(runtime) {
  runtime.cash.openSession({ terminalId:'PDV-01', operatorId:'mgr', initialCashCents:0, actor:cashActor() });
  const sale = runtime.sales.openSale({ id:'sale1', saleNumber:'S-001', terminalId:'PDV-01', operatorId:'mgr' }, cashActor());
  runtime.sales.addItem(sale.id, { productId:'p1', quantity:2 });
  runtime.sales.completeSale(sale.id, { payments:[{ method:'CASH', amountCents:2000 }], actor:cashActor() });
  const dispatch = await runtime.dispatchPending();
  assert.equal(dispatch.failed, 0);
  return runtime.sales.getSale(sale.id);
}

test('sales history filters completed sales and exposes immutable detailed original', async () => {
  let seq = 0;
  const baseTime = Date.parse('2026-09-09T12:00:00Z');
  const runtime = createPdvRuntime({ now:()=>new Date(baseTime+(seq++*1000)).toISOString(), idFactory:p=>`${p}-${seq++}` });
  seed(runtime);
  await completeSale(runtime);

  const history = runtime.sales.listHistory({ status:'COMPLETED', query:'S-001' });
  assert.equal(history.length, 1);
  assert.equal(history[0].saleNumber, 'S-001');
  assert.equal(history[0].totalCents, 2000);
  const details = runtime.sales.getSaleDetails('sale1');
  assert.equal(details.items.length, 1);
  assert.equal(details.payments[0].amountCents, 2000);
  assert.equal(details.status, 'COMPLETED');
  runtime.close();
});

test('partial returns preserve original sale and restore stock/cash once per return', async () => {
  let seq = 0;
  const baseTime = Date.parse('2026-09-09T13:00:00Z');
  const runtime = createPdvRuntime({ now:()=>new Date(baseTime+(seq++*1000)).toISOString(), idFactory:p=>`${p}-${seq++}` });
  seed(runtime);
  const sale = await completeSale(runtime);
  const saleItemId = sale.items[0].id;
  assert.equal(runtime.inventory.getBalance('p1'), 3);

  const first = runtime.returns.createReturn({
    saleId:'sale1', terminalId:'PDV-01', operatorId:'mgr', reason:'Cliente desistiu de uma unidade',
    items:[{ saleItemId, quantity:1 }], refunds:[{ method:'CASH', amountCents:1000 }], actor:cashActor()
  });
  assert.equal(first.totalCents, 1000);
  assert.equal(first.status, 'COMPLETED');
  assert.equal(runtime.sales.getSale('sale1').status, 'COMPLETED');
  let dispatch = await runtime.dispatchPending();
  assert.equal(dispatch.failed, 0);
  assert.equal(runtime.inventory.getBalance('p1'), 4);

  const firstReversals = runtime.cash.listSessionMovements(runtime.cash.getOpenSession('PDV-01').id)
    .filter(m => m.type === 'REVERSAL' && m.returnId === first.id);
  assert.equal(firstReversals.length, 1);
  assert.equal(firstReversals[0].amountCents, 1000);

  await runtime.dispatchPending();
  assert.equal(runtime.inventory.getBalance('p1'), 4);
  assert.equal(runtime.cash.listSessionMovements(runtime.cash.getOpenSession('PDV-01').id)
    .filter(m => m.type === 'REVERSAL' && m.returnId === first.id).length, 1);

  assert.throws(() => runtime.returns.createReturn({
    saleId:'sale1', terminalId:'PDV-01', operatorId:'mgr', reason:'Tentativa acima do vendido',
    items:[{ saleItemId, quantity:2 }], refunds:[{ method:'CASH', amountCents:2000 }], actor:cashActor()
  }), /quantidade.*devolv/i);

  const second = runtime.returns.createReturn({
    saleId:'sale1', terminalId:'PDV-01', operatorId:'mgr', reason:'Devolucao da unidade restante',
    items:[{ saleItemId, quantity:1 }], refunds:[{ method:'CASH', amountCents:1000 }], actor:cashActor()
  });
  dispatch = await runtime.dispatchPending();
  assert.equal(dispatch.failed, 0);
  assert.equal(runtime.inventory.getBalance('p1'), 5);
  assert.equal(runtime.cash.listSessionMovements(runtime.cash.getOpenSession('PDV-01').id)
    .filter(m => m.type === 'REVERSAL' && [first.id, second.id].includes(m.returnId)).length, 2);
  assert.equal(runtime.returns.listReturns({ saleId:'sale1' }).length, 2);
  runtime.close();
});
