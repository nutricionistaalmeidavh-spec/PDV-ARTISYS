const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { runSalesEnhancementMigrations } = require('../js/core/database/sales-enhancement-migrations');
const { runCommercialMediaMigrations } = require('../js/core/database/commercial-media-migrations');
const { runCommercialCoreMigrations, COMMERCIAL_CORE_SCHEMA_VERSION } = require('../js/core/database/commercial-core-migrations');

function setup() {
  const db = openDatabase(':memory:');
  runMigrations(db);
  runSalesEnhancementMigrations(db);
  runCommercialMediaMigrations(db);
  return db;
}

test('commercial core migration creates purchasing, lot, pix, credit and replenishment schema idempotently', () => {
  const db = setup();
  runCommercialCoreMigrations(db, () => '2026-09-16T15:00:00.000Z');
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const name of [
    'purchase_orders','purchase_order_items','purchase_receipts','purchase_receipt_items',
    'inventory_lots','inventory_lot_balances','inventory_lot_movements','sale_item_lot_allocations','return_item_lot_allocations',
    'pix_charges','credit_accounts','credit_ledger','replenishment_policies'
  ]) assert.equal(tables.has(name), true, name);

  const productColumns = new Set(db.prepare('PRAGMA table_info(products)').all().map(row => row.name));
  assert.equal(productColumns.has('track_lots'), true);
  const itemColumns = new Set(db.prepare('PRAGMA table_info(sale_items)').all().map(row => row.name));
  assert.equal(itemColumns.has('lot_id'), true);
  assert.equal(itemColumns.has('lot_code_snapshot'), true);

  runCommercialCoreMigrations(db, () => '2026-09-16T15:05:00.000Z');
  assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version, COMMERCIAL_CORE_SCHEMA_VERSION);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=?').get(COMMERCIAL_CORE_SCHEMA_VERSION).count, 1);
  db.close();
});
