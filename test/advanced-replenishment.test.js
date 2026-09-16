const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runSalesEnhancementMigrations } = require('../js/core/database/sales-enhancement-migrations');
const { runCommercialMediaMigrations } = require('../js/core/database/commercial-media-migrations');
const { runCommercialCoreMigrations } = require('../js/core/database/commercial-core-migrations');
const { createInventoryService } = require('../js/domains/inventory/inventory-service');
const { createReportingService } = require('../js/domains/reports/reporting-service');
const { createReplenishmentService } = require('../js/domains/inventory/replenishment-service');

function setup() {
  const nowValue = '2026-09-16T12:00:00.000Z';
  const now = () => nowValue;
  let seq = 0;
  const idFactory = prefix => `${prefix}-${++seq}`;
  const db = openDatabase(':memory:');
  runMigrations(db, now);
  runSalesEnhancementMigrations(db, now);
  runCommercialMediaMigrations(db, now);
  runCommercialCoreMigrations(db, now);
  db.prepare("INSERT INTO users(id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES('u1','seller','Seller','cashier','x','x',1,?,?)").run(nowValue,nowValue);
  db.prepare("INSERT INTO categories(id,name,active,created_at,updated_at) VALUES('cat-1','Geral',1,?,?)").run(nowValue,nowValue);
  db.prepare("INSERT INTO suppliers(id,name,active,created_at,updated_at) VALUES('sup-1','Fornecedor',1,?,?)").run(nowValue,nowValue);
  db.prepare(`INSERT INTO products(id,sku,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at)
    VALUES('p1','P1','Produto A','cat-1','UN',1000,400,1,3,1,?,?),('p2','P2','Produto B','cat-1','UN',1500,1000,1,2,1,?,?)`).run(nowValue,nowValue,nowValue,nowValue);
  db.prepare("INSERT INTO inventory_balances(product_id,quantity,updated_at) VALUES('p1',2,?),('p2',10,?)").run(nowValue,nowValue);
  return { db, now, idFactory, inventory:createInventoryService({db,now,idFactory}) };
}

function insertSale(db, { id, at, p1Qty=0, p2Qty=0, discount=0, status='COMPLETED' }) {
  const total = p1Qty*1000 + p2Qty*1500 - discount;
  db.prepare(`INSERT INTO sales(id,sale_number,terminal_id,operator_id,seller_id,seller_name_snapshot,status,subtotal_cents,discount_cents,total_cents,change_cents,opened_at,completed_at,cancelled_at,updated_at)
    VALUES(?,?,?,?,?,? ,?,?,?,?,?,?,?,?,?)`).run(id,id,'pdv-1','u1','u1','Seller',status,total+discount,discount,total,0,at,status==='COMPLETED'?at:null,status==='CANCELLED'?at:null,at);
  if (p1Qty) db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents,catalog_unit_price_cents,price_override_reason,commission_bps_snapshot,commission_base_cents,commission_cents,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`${id}-p1`,id,'p1','Produto A','P1',p1Qty,1000,p1Qty*1000,1100,'Promocao autorizada',0,0,0,at,at);
  if (p2Qty) db.prepare(`INSERT INTO sale_items(id,sale_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents,catalog_unit_price_cents,commission_bps_snapshot,commission_base_cents,commission_cents,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(`${id}-p2`,id,'p2','Produto B','P2',p2Qty,1500,p2Qty*1500,1500,0,0,0,at,at);
}

test('advanced reports calculate ABC, margin, time distribution and price override audit locally', () => {
  const { db, now } = setup();
  insertSale(db,{id:'s1',at:'2026-09-15T14:00:00.000Z',p1Qty:2,p2Qty:1,discount:200});
  insertSale(db,{id:'s2',at:'2026-09-16T10:00:00.000Z',p1Qty:1});
  insertSale(db,{id:'s3',at:'2026-09-16T11:00:00.000Z',p1Qty:1,status:'CANCELLED'});

  const reports = createReportingService({ db, now });
  const sales = reports.buildAdvancedSalesAnalytics({ from:'2026-09-01T00:00:00Z', to:'2026-09-30T23:59:59Z' });
  assert.equal(sales.salesCount, 2);
  assert.equal(sales.averageTicketCents, 2050);
  assert.equal(sales.priceOverrides.count, 2);
  assert.equal(sales.abcRevenue[0].productId, 'p1');
  assert.equal(sales.margins.find(row => row.productId==='p1').grossMarginCents, 1800);
  assert.equal(sales.byHour.find(row => row.hour===14).salesCount, 1);
  assert.equal(sales.sellers[0].cancelledSalesCount, 1);

  const inventory = reports.buildInventoryAnalytics({ from:'2026-09-01T00:00:00Z', to:'2026-09-30T23:59:59Z', asOf:'2026-09-16T12:00:00Z' });
  assert.equal(inventory.items.find(row => row.productId==='p1').quantitySold, 3);
  assert.equal(typeof inventory.items.find(row => row.productId==='p1').turnoverEstimate, 'number');

  const csv = reports.exportAdvancedCsv('sales', { from:'2026-09-01T00:00:00Z', to:'2026-09-30T23:59:59Z' });
  assert.match(csv, /produto;quantidade;receita_centavos/);
  assert.match(csv, /Produto A/);
  db.close();
});

test('purchasing analytics aggregates received spend by supplier and product', () => {
  const { db, now } = setup();
  db.prepare(`INSERT INTO purchase_orders(id,supplier_id,order_number,status,subtotal_cents,total_cents,created_by,created_at,updated_at,ordered_at,received_at)
    VALUES('po1','sup-1','PO1','RECEIVED',2000,2000,'u1',?,?,?,?,?)`).run(now(),now(),now(),now());
  db.prepare(`INSERT INTO purchase_order_items(id,purchase_order_id,product_id,product_name_snapshot,sku_snapshot,ordered_quantity,received_quantity,unit_cost_cents,total_cents)
    VALUES('poi1','po1','p1','Produto A','P1',4,4,500,2000)`).run();
  db.prepare(`INSERT INTO purchase_receipts(id,purchase_order_id,supplier_id,received_by,document_number,created_at)
    VALUES('r1','po1','sup-1','u1','NF1',?)`).run(now());
  db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,purchase_order_item_id,product_id,quantity,unit_cost_cents)
    VALUES('ri1','r1','poi1','p1',4,500)`).run();
  const report = createReportingService({ db, now }).buildPurchasingAnalytics({ from:'2026-09-01T00:00:00Z', to:'2026-09-30T23:59:59Z' });
  assert.equal(report.totalSpendCents, 2000);
  assert.equal(report.bySupplier[0].supplierId, 'sup-1');
  assert.equal(report.byProduct[0].productId, 'p1');
  db.close();
});

test('replenishment subtracts on-hand and on-order and honors minimum purchase quantity', () => {
  const { db, inventory, now, idFactory } = setup();
  for (let day=0; day<30; day++) insertSale(db,{id:`sale-${day}`,at:new Date(Date.parse('2026-08-18T12:00:00Z')+day*86400000).toISOString(),p1Qty:1});
  db.prepare(`INSERT INTO purchase_orders(id,supplier_id,order_number,status,subtotal_cents,total_cents,created_by,created_at,updated_at,ordered_at)
    VALUES('po-open','sup-1','PO-OPEN','ORDERED',1500,1500,'u1',?,?,?)`).run(now(),now(),now());
  db.prepare(`INSERT INTO purchase_order_items(id,purchase_order_id,product_id,product_name_snapshot,sku_snapshot,ordered_quantity,received_quantity,unit_cost_cents,total_cents)
    VALUES('poi-open','po-open','p1','Produto A','P1',3,0,500,1500)`).run();

  const service = createReplenishmentService({ db, inventory, now, idFactory, defaults:{ leadTimeDays:7, safetyStock:2 } });
  service.saveProductPolicy('p1',{ leadTimeDays:7, safetyStock:2, minimumPurchaseQuantity:5, preferredSupplierId:'sup-1' },{ userId:'manager-1',role:'manager' });
  const suggestion = service.listSuggestions({ lookbackDays:30, asOf:'2026-09-16T12:00:00Z' }).find(row => row.productId==='p1');
  assert.equal(suggestion.averageDailySales, 1);
  assert.equal(suggestion.onHand, 2);
  assert.equal(suggestion.onOrder, 3);
  assert.equal(suggestion.recommendedQuantity, 5);
  assert.equal(suggestion.preferredSupplierId, 'sup-1');
  db.close();
});
