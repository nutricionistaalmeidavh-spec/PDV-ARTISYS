'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runReleaseMigrations } = require('../js/core/database/release-migrations');
const { runVerticalMigrations } = require('../js/core/database/vertical-migrations');
const { runKitComboMigrations } = require('../js/core/database/kit-combo-migrations');
const { runHardwareMigrations } = require('../js/core/database/hardware-migrations');
const { runSaleObservationMigrations } = require('../js/core/database/sale-observation-migrations');
const { runSalesEnhancementMigrations, SALES_ENHANCEMENT_SCHEMA_VERSION } = require('../js/core/database/sales-enhancement-migrations');
const { SqliteOutboxStore } = require('../js/core/database/outbox-store');
const { createCatalogService } = require('../js/domains/catalog/catalog-service');
const { createSaleService } = require('../js/domains/sales/sale-service');
const { createReportingService } = require('../js/domains/reports/reporting-service');

function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  runReleaseMigrations(db);
  runVerticalMigrations(db);
  runKitComboMigrations(db);
  runHardwareMigrations(db);
  runSaleObservationMigrations(db);
  runSalesEnhancementMigrations(db);
  let sequence = 0;
  const idFactory = prefix => `${prefix}-${++sequence}`;
  const now = () => '2026-09-15T12:00:00.000Z';
  const catalog = createCatalogService({ db, now, idFactory });
  catalog.createUser({ id:'op1', username:'caixa', name:'Operador Caixa', role:'cashier', password:'senha-caixa-123' });
  catalog.createUser({ id:'seller1', username:'maria', name:'Maria Garçom', role:'cashier', password:'senha-maria-123' });
  catalog.createUser({ id:'manager1', username:'gerente', name:'Gerente', role:'manager', password:'senha-gerente-123' });
  catalog.upsertProduct({ id:'p1', sku:'P1', name:'Produto', salePriceCents:1000 });
  const sales = createSaleService({ db, outbox:new SqliteOutboxStore(db), now, idFactory });
  return { db, sales };
}

test('schema v11 is additive, idempotent and preserves existing sales', () => {
  const db = openDatabase(':memory:');
  runMigrations(db);
  db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES ('u1','u1','Usuário','cashier','h','s',1,'x','x')").run();
  db.prepare("INSERT INTO sales (id,sale_number,terminal_id,operator_id,status,opened_at,updated_at) VALUES ('s1','1','T1','u1','OPEN','x','x')").run();
  assert.equal(runSalesEnhancementMigrations(db), SALES_ENHANCEMENT_SCHEMA_VERSION);
  assert.equal(runSalesEnhancementMigrations(db), SALES_ENHANCEMENT_SCHEMA_VERSION);
  const preserved = db.prepare("SELECT seller_id,seller_name_snapshot FROM sales WHERE id='s1'").get();
  assert.equal(preserved.seller_id, 'u1');
  assert.equal(preserved.seller_name_snapshot, 'Usuário');
  const saleColumns = new Set(db.prepare('PRAGMA table_info(sales)').all().map(row => row.name));
  const itemColumns = new Set(db.prepare('PRAGMA table_info(sale_items)').all().map(row => row.name));
  for (const name of ['seller_id','seller_name_snapshot']) assert.equal(saleColumns.has(name), true, name);
  for (const name of ['catalog_unit_price_cents','price_override_reason','price_changed_by_id','price_authorized_by_id']) assert.equal(itemColumns.has(name), true, name);
  db.close();
});

test('sale records seller separately from operator and preserves seller name snapshot', () => {
  const { db, sales } = setup();
  const sale = sales.openSale({ id:'s1', saleNumber:'1', terminalId:'T1', operatorId:'op1', sellerId:'seller1' });
  assert.equal(sale.operatorId, 'op1');
  assert.equal(sale.sellerId, 'seller1');
  assert.equal(sale.sellerName, 'Maria Garçom');
  db.prepare("UPDATE users SET name='Maria Atualizada' WHERE id='seller1'").run();
  assert.equal(sales.getSale('s1').sellerName, 'Maria Garçom');
  db.close();
});

test('manager price override preserves catalog price, reason and authorization', () => {
  const { db, sales } = setup();
  sales.openSale({ id:'s1', saleNumber:'1', terminalId:'T1', operatorId:'op1', sellerId:'seller1' });
  const withItem = sales.addItem('s1', { productId:'p1', quantity:2 });
  const itemId = withItem.items[0].id;
  assert.throws(() => sales.overrideItemPrice('s1', itemId, { unitPriceCents:800, reason:'Oferta', actor:{ userId:'op1', role:'cashier' } }), /gerente/i);
  const changed = sales.overrideItemPrice('s1', itemId, { unitPriceCents:800, reason:'Oferta anunciada', actor:{ userId:'manager1', role:'manager' } });
  assert.equal(changed.items[0].catalogUnitPriceCents, 1000);
  assert.equal(changed.items[0].unitPriceCents, 800);
  assert.equal(changed.items[0].totalCents, 1600);
  assert.equal(changed.items[0].priceOverrideReason, 'Oferta anunciada');
  assert.equal(changed.items[0].priceChangedById, 'manager1');
  assert.equal(changed.items[0].priceAuthorizedById, 'manager1');
  assert.equal(db.prepare("SELECT action FROM audit_log WHERE entity_id=? ORDER BY id DESC").get(itemId).action, 'sale.item-price-override');
  db.close();
});

test('sales report filters by period and seller and aggregates sellers', () => {
  const { db } = setup();
  const insert = db.prepare(`INSERT INTO sales (id,sale_number,terminal_id,operator_id,seller_id,seller_name_snapshot,status,subtotal_cents,total_cents,opened_at,completed_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  insert.run('s1','1','T1','op1','seller1','Maria Garçom','COMPLETED',1000,1000,'2026-09-15T09:00:00Z','2026-09-15T09:05:00Z','2026-09-15T09:05:00Z');
  insert.run('s2','2','T1','op1','manager1','Gerente','COMPLETED',2000,2000,'2026-09-16T09:00:00Z','2026-09-16T09:05:00Z','2026-09-16T09:05:00Z');
  const report = createReportingService({ db }).buildSalesSummary({ from:'2026-09-15T00:00:00.000Z', to:'2026-09-15T23:59:59.999Z', sellerId:'seller1' });
  assert.equal(report.salesCount, 1);
  assert.equal(report.sellers[0].sellerId, 'seller1');
  assert.equal(report.sellers[0].sellerName, 'Maria Garçom');
  assert.equal(report.sellers[0].salesCents, 1000);
  db.close();
});
