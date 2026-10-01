'use strict';

const { withTransaction } = require('./sqlite-database');

const SALES_ENHANCEMENT_SCHEMA_VERSION = 12;
const SALES_ENHANCEMENT_MIGRATION_NAME = 'pdv_sale_integrity_snapshots_1_5_0';

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

function allocateDiscount(items, discountCents) {
  const total = items.reduce((sum,item) => sum + Number(item.total_cents || 0), 0);
  let remainingDiscount = Math.min(Math.max(Number(discountCents || 0), 0), total);
  let remainingBase = total;
  return items.map((item,index) => {
    const base = Number(item.total_cents || 0);
    let allocated = 0;
    if (remainingDiscount > 0 && remainingBase > 0) {
      allocated = index === items.length - 1 ? remainingDiscount : Math.round((remainingDiscount * base) / remainingBase);
      allocated = Math.min(Math.max(allocated,0), base, remainingDiscount);
    }
    remainingDiscount -= allocated;
    remainingBase -= base;
    return { id:item.id, allocatedDiscountCents:allocated, netTotalCents:base-allocated };
  });
}

function backfillNetItemValues(db) {
  const sales = db.prepare('SELECT id,discount_cents FROM sales').all();
  const itemQuery = db.prepare('SELECT id,total_cents FROM sale_items WHERE sale_id=? ORDER BY created_at,id');
  const update = db.prepare('UPDATE sale_items SET allocated_discount_cents=?,net_total_cents=? WHERE id=?');
  for (const sale of sales) {
    for (const item of allocateDiscount(itemQuery.all(sale.id), sale.discount_cents)) {
      update.run(item.allocatedDiscountCents,item.netTotalCents,item.id);
    }
  }
}

function sessionAt(db, terminalId, timestamp) {
  if (!terminalId || !timestamp) return null;
  return db.prepare(`SELECT id FROM cash_sessions
    WHERE terminal_id=? AND opened_at<=? AND (closed_at IS NULL OR closed_at>=?)
    ORDER BY opened_at DESC,id DESC LIMIT 1`).get(String(terminalId),String(timestamp),String(timestamp))?.id || null;
}

function backfillCashSessions(db) {
  const updateSale = db.prepare('UPDATE sales SET cash_session_id=? WHERE id=? AND cash_session_id IS NULL');
  for (const sale of db.prepare("SELECT id,terminal_id,completed_at FROM sales WHERE status IN ('COMPLETED','CANCELLED') AND completed_at IS NOT NULL AND cash_session_id IS NULL").all()) {
    const cashSessionId = sessionAt(db,sale.terminal_id,sale.completed_at);
    if (cashSessionId) updateSale.run(cashSessionId,sale.id);
  }
  const updateReturn = db.prepare('UPDATE return_transactions SET cash_session_id=? WHERE id=? AND cash_session_id IS NULL');
  for (const ret of db.prepare('SELECT id,terminal_id,created_at FROM return_transactions WHERE cash_session_id IS NULL').all()) {
    const cashSessionId = sessionAt(db,ret.terminal_id,ret.created_at);
    if (cashSessionId) updateReturn.run(cashSessionId,ret.id);
  }
}

function runSalesEnhancementMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= SALES_ENHANCEMENT_SCHEMA_VERSION) return current;

  withTransaction(db, () => {
    const saleColumns = columns(db, 'sales');
    if (!saleColumns.has('seller_id')) db.exec('ALTER TABLE sales ADD COLUMN seller_id TEXT REFERENCES users(id)');
    if (!saleColumns.has('seller_name_snapshot')) db.exec('ALTER TABLE sales ADD COLUMN seller_name_snapshot TEXT');
    if (!saleColumns.has('cash_session_id')) db.exec('ALTER TABLE sales ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id)');

    const itemColumns = columns(db, 'sale_items');
    if (!itemColumns.has('catalog_unit_price_cents')) db.exec('ALTER TABLE sale_items ADD COLUMN catalog_unit_price_cents INTEGER CHECK (catalog_unit_price_cents >= 0)');
    if (!itemColumns.has('price_override_reason')) db.exec('ALTER TABLE sale_items ADD COLUMN price_override_reason TEXT');
    if (!itemColumns.has('price_changed_by_id')) db.exec('ALTER TABLE sale_items ADD COLUMN price_changed_by_id TEXT REFERENCES users(id)');
    if (!itemColumns.has('price_authorized_by_id')) db.exec('ALTER TABLE sale_items ADD COLUMN price_authorized_by_id TEXT REFERENCES users(id)');
    if (!itemColumns.has('allocated_discount_cents')) db.exec('ALTER TABLE sale_items ADD COLUMN allocated_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (allocated_discount_cents >= 0)');
    if (!itemColumns.has('net_total_cents')) db.exec('ALTER TABLE sale_items ADD COLUMN net_total_cents INTEGER CHECK (net_total_cents >= 0)');

    const returnColumns = columns(db, 'return_transactions');
    if (!returnColumns.has('cash_session_id')) db.exec('ALTER TABLE return_transactions ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id)');

    db.exec(`UPDATE sales SET seller_id=operator_id WHERE seller_id IS NULL;
      UPDATE sales SET seller_name_snapshot=(SELECT name FROM users WHERE users.id=sales.seller_id) WHERE seller_name_snapshot IS NULL;
      UPDATE sale_items SET catalog_unit_price_cents=unit_price_cents WHERE catalog_unit_price_cents IS NULL;`);
    backfillNetItemValues(db);
    backfillCashSessions(db);
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_seller_completed ON sales(seller_id,completed_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_sales_cash_session ON sales(cash_session_id,completed_at)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_returns_cash_session ON return_transactions(cash_session_id,created_at)');
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(SALES_ENHANCEMENT_SCHEMA_VERSION, SALES_ENHANCEMENT_MIGRATION_NAME, now());
  });
  return SALES_ENHANCEMENT_SCHEMA_VERSION;
}

module.exports = {
  SALES_ENHANCEMENT_SCHEMA_VERSION,
  SALES_ENHANCEMENT_MIGRATION_NAME,
  runSalesEnhancementMigrations
};
