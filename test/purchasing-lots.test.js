const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runSalesEnhancementMigrations } = require('../js/core/database/sales-enhancement-migrations');
const { runCommercialMediaMigrations } = require('../js/core/database/commercial-media-migrations');
const { runCommercialCoreMigrations } = require('../js/core/database/commercial-core-migrations');
const { createCatalogService } = require('../js/domains/catalog/catalog-service');
const { createInventoryService } = require('../js/domains/inventory/inventory-service');
const { createFinanceService } = require('../js/domains/finance/finance-service');
const { createLotService } = require('../js/domains/inventory/lot-service');
const { createPurchasingService } = require('../js/domains/purchasing/purchasing-service');

function setup() {
  let sequence = 0;
  const idFactory = prefix => `${prefix}-${++sequence}`;
  const now = () => '2026-09-16T15:00:00.000Z';
  const db = openDatabase(':memory:');
  runMigrations(db, now);
  runSalesEnhancementMigrations(db, now);
  runCommercialMediaMigrations(db, now);
  runCommercialCoreMigrations(db, now);
  const catalog = createCatalogService({ db, now, idFactory });
  const inventory = createInventoryService({ db, now, idFactory });
  const finance = createFinanceService({ db, now, idFactory });
  const lots = createLotService({ db, now, idFactory });
  const purchasing = createPurchasingService({ db, inventory, finance, lots, now, idFactory });
  const actor = { userId:'manager-1', role:'manager', terminalId:'pdv-1' };
  catalog.upsertSupplier({ id:'sup-1', name:'Fornecedor 1' }, actor);
  catalog.upsertProduct({ id:'p1', name:'Produto 1', sku:'P1', salePriceCents:500, costCents:200, trackStock:true, minimumStock:2, trackLots:true }, actor);
  return { db, catalog, inventory, finance, lots, purchasing, actor };
}

test('purchase receiving supports partial/full receipts, lot stock and idempotent receipt ids', () => {
  const { db, inventory, finance, lots, purchasing, actor } = setup();
  const draft = purchasing.createDraft({
    id:'po-1', orderNumber:'PO-001', supplierId:'sup-1', expectedAt:'2026-09-20T12:00:00Z',
    items:[{ id:'poi-1', productId:'p1', quantity:10, unitCostCents:300 }]
  }, actor);
  assert.equal(draft.status, 'DRAFT');
  purchasing.submit('po-1', actor);

  const partial = purchasing.receive('po-1', {
    receiptId:'rec-1', documentNumber:'NF-10', payableDueAt:'2026-10-01T12:00:00Z', updateProductCost:true,
    items:[{ purchaseOrderItemId:'poi-1', quantity:4, unitCostCents:300, lot:{ lotCode:'L-A', expiresAt:'2026-12-01T00:00:00Z' } }]
  }, actor);
  assert.equal(partial.order.status, 'PARTIAL');
  assert.equal(inventory.getBalance('p1'), 4);
  assert.equal(lots.listLots({ productId:'p1' })[0].quantity, 4);
  assert.equal(db.prepare('SELECT cost_cents AS cost FROM products WHERE id=?').get('p1').cost, 300);
  assert.equal(finance.listEntries({ kind:'PAYABLE' }).length, 1);

  const repeated = purchasing.receive('po-1', {
    receiptId:'rec-1',
    items:[{ purchaseOrderItemId:'poi-1', quantity:4, unitCostCents:300, lot:{ lotCode:'L-A', expiresAt:'2026-12-01T00:00:00Z' } }]
  }, actor);
  assert.equal(repeated.receipt.id, 'rec-1');
  assert.equal(inventory.getBalance('p1'), 4);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM purchase_receipts').get().count, 1);

  const full = purchasing.receive('po-1', {
    receiptId:'rec-2',
    items:[{ purchaseOrderItemId:'poi-1', quantity:6, unitCostCents:310, lot:{ lotCode:'L-B', expiresAt:'2027-01-01T00:00:00Z' } }]
  }, actor);
  assert.equal(full.order.status, 'RECEIVED');
  assert.equal(inventory.getBalance('p1'), 10);
  assert.equal(purchasing.get('po-1').items[0].receivedQuantity, 10);
  db.close();
});

test('FEFO consumes earliest non-expired lot and blocks expired stock unless manager overrides with reason', () => {
  const { db, lots, actor } = setup();
  const early = lots.createLot({ id:'lot-early', productId:'p1', supplierId:'sup-1', lotCode:'EARLY', expiresAt:'2026-10-01T00:00:00Z', receivedAt:'2026-09-10T00:00:00Z' }, actor);
  const late = lots.createLot({ id:'lot-late', productId:'p1', supplierId:'sup-1', lotCode:'LATE', expiresAt:'2026-11-01T00:00:00Z', receivedAt:'2026-09-11T00:00:00Z' }, actor);
  const expired = lots.createLot({ id:'lot-old', productId:'p1', supplierId:'sup-1', lotCode:'OLD', expiresAt:'2026-09-01T00:00:00Z', receivedAt:'2026-08-01T00:00:00Z' }, actor);
  lots.move({ lotId:early.id, productId:'p1', type:'purchase', quantityDelta:2, sourceType:'seed', sourceId:'1' }, actor);
  lots.move({ lotId:late.id, productId:'p1', type:'purchase', quantityDelta:5, sourceType:'seed', sourceId:'2' }, actor);
  lots.move({ lotId:expired.id, productId:'p1', type:'purchase', quantityDelta:3, sourceType:'seed', sourceId:'3' }, actor);

  const allocated = lots.allocateFefo({ productId:'p1', quantity:3, at:'2026-09-16T15:00:00Z', sourceType:'sale', sourceId:'sale-1' }, actor);
  assert.deepEqual(allocated.map(item => [item.lotCode,item.quantity]), [['EARLY',2],['LATE',1]]);
  assert.equal(lots.getLot('lot-early').quantity, 0);
  assert.equal(lots.getLot('lot-late').quantity, 4);

  assert.throws(() => lots.allocateFefo({ productId:'p1', quantity:5, at:'2026-12-15T00:00:00Z', sourceType:'sale', sourceId:'sale-2' }, actor), /vencido|validade|estoque.*lote/i);
  const override = lots.allocateFefo({ productId:'p1', quantity:1, at:'2026-12-15T00:00:00Z', sourceType:'sale', sourceId:'sale-3', allowExpired:true, overrideReason:'Venda autorizada apos conferencia' }, actor);
  assert.equal(override.length, 1);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='inventory.lot.expired-override'").get());
  db.close();
});
