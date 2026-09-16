'use strict';

const { withTransaction } = require('./sqlite-database');

const COMMERCIAL_CORE_SCHEMA_VERSION = 13;
const COMMERCIAL_CORE_MIGRATION_NAME = 'commercial_core_purchasing_pix_lots_credits_analytics_1_4_0';

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

function addColumn(db, table, name, definition) {
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function runCommercialCoreMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= COMMERCIAL_CORE_SCHEMA_VERSION) return current;

  withTransaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        supplier_id TEXT NOT NULL,
        order_number TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','ORDERED','PARTIAL','RECEIVED','CANCELLED')),
        expected_at TEXT,
        notes TEXT,
        subtotal_cents INTEGER NOT NULL DEFAULT 0 CHECK(subtotal_cents>=0),
        total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents>=0),
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        ordered_at TEXT,
        received_at TEXT,
        cancelled_at TEXT,
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_supplier_status ON purchase_orders(supplier_id,status,created_at);
      CREATE INDEX IF NOT EXISTS idx_purchase_orders_status_expected ON purchase_orders(status,expected_at);

      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id TEXT PRIMARY KEY,
        purchase_order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name_snapshot TEXT NOT NULL,
        sku_snapshot TEXT,
        ordered_quantity REAL NOT NULL CHECK(ordered_quantity>0),
        received_quantity REAL NOT NULL DEFAULT 0 CHECK(received_quantity>=0),
        unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0),
        total_cents INTEGER NOT NULL CHECK(total_cents>=0),
        FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_items_order ON purchase_order_items(purchase_order_id,product_id);

      CREATE TABLE IF NOT EXISTS purchase_receipts (
        id TEXT PRIMARY KEY,
        purchase_order_id TEXT NOT NULL,
        supplier_id TEXT NOT NULL,
        received_by TEXT,
        document_number TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(purchase_order_id) REFERENCES purchase_orders(id),
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY(received_by) REFERENCES users(id)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_receipts_order ON purchase_receipts(purchase_order_id,created_at);

      CREATE TABLE IF NOT EXISTS inventory_lots (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        supplier_id TEXT,
        lot_code TEXT NOT NULL,
        manufactured_at TEXT,
        expires_at TEXT,
        received_at TEXT NOT NULL,
        unit_cost_cents INTEGER CHECK(unit_cost_cents IS NULL OR unit_cost_cents>=0),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
        UNIQUE(product_id,lot_code)
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_lots_fefo ON inventory_lots(product_id,active,expires_at,received_at);

      CREATE TABLE IF NOT EXISTS inventory_lot_balances (
        lot_id TEXT PRIMARY KEY,
        quantity REAL NOT NULL DEFAULT 0 CHECK(quantity>=0),
        updated_at TEXT NOT NULL,
        FOREIGN KEY(lot_id) REFERENCES inventory_lots(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS inventory_lot_movements (
        id TEXT PRIMARY KEY,
        lot_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN('purchase','sale','sale-cancel','return','return-cancel','adjustment-in','adjustment-out')),
        quantity_delta REAL NOT NULL,
        quantity_before REAL NOT NULL,
        quantity_after REAL NOT NULL CHECK(quantity_after>=0),
        source_type TEXT,
        source_id TEXT,
        event_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(lot_id) REFERENCES inventory_lots(id),
        FOREIGN KEY(product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_lot_movements_lot ON inventory_lot_movements(lot_id,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_lot_event ON inventory_lot_movements(event_id,lot_id,type) WHERE event_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS purchase_receipt_items (
        id TEXT PRIMARY KEY,
        receipt_id TEXT NOT NULL,
        purchase_order_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity>0),
        unit_cost_cents INTEGER NOT NULL CHECK(unit_cost_cents>=0),
        lot_id TEXT,
        FOREIGN KEY(receipt_id) REFERENCES purchase_receipts(id) ON DELETE CASCADE,
        FOREIGN KEY(purchase_order_item_id) REFERENCES purchase_order_items(id),
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(lot_id) REFERENCES inventory_lots(id)
      );
      CREATE INDEX IF NOT EXISTS idx_purchase_receipt_items_receipt ON purchase_receipt_items(receipt_id,product_id);

      CREATE TABLE IF NOT EXISTS sale_item_lot_allocations (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        sale_item_id TEXT NOT NULL,
        lot_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity>0),
        created_at TEXT NOT NULL,
        FOREIGN KEY(sale_id) REFERENCES sales(id) ON DELETE CASCADE,
        FOREIGN KEY(sale_item_id) REFERENCES sale_items(id) ON DELETE CASCADE,
        FOREIGN KEY(lot_id) REFERENCES inventory_lots(id)
      );
      CREATE INDEX IF NOT EXISTS idx_sale_item_lots_item ON sale_item_lot_allocations(sale_item_id,lot_id);

      CREATE TABLE IF NOT EXISTS return_item_lot_allocations (
        id TEXT PRIMARY KEY,
        return_id TEXT NOT NULL,
        return_item_id TEXT NOT NULL,
        sale_item_id TEXT NOT NULL,
        lot_id TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity>0),
        created_at TEXT NOT NULL,
        FOREIGN KEY(return_id) REFERENCES return_transactions(id) ON DELETE CASCADE,
        FOREIGN KEY(return_item_id) REFERENCES return_items(id) ON DELETE CASCADE,
        FOREIGN KEY(sale_item_id) REFERENCES sale_items(id),
        FOREIGN KEY(lot_id) REFERENCES inventory_lots(id)
      );
      CREATE INDEX IF NOT EXISTS idx_return_item_lots_return ON return_item_lot_allocations(return_id,return_item_id);

      CREATE TABLE IF NOT EXISTS pix_charges (
        id TEXT PRIMARY KEY,
        sale_id TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','CONFIRMED','CANCELLED')),
        created_at TEXT NOT NULL,
        confirmed_at TEXT,
        confirmed_by TEXT,
        cancelled_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_pix_charges_sale ON pix_charges(sale_id,status,created_at);

      CREATE TABLE IF NOT EXISTS credit_accounts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK(type IN('CUSTOMER','GIFT_CARD')),
        customer_id TEXT,
        code_hash TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_customer ON credit_accounts(customer_id) WHERE type='CUSTOMER' AND customer_id IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_code_hash ON credit_accounts(code_hash) WHERE code_hash IS NOT NULL;

      CREATE TABLE IF NOT EXISTS credit_ledger (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN('CREDIT','DEBIT')),
        amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        note TEXT,
        actor_id TEXT,
        created_at TEXT NOT NULL,
        reversed_entry_id TEXT,
        FOREIGN KEY(account_id) REFERENCES credit_accounts(id),
        FOREIGN KEY(reversed_entry_id) REFERENCES credit_ledger(id)
      );
      CREATE INDEX IF NOT EXISTS idx_credit_ledger_account ON credit_ledger(account_id,created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_source ON credit_ledger(account_id,direction,source_type,source_id) WHERE reversed_entry_id IS NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_ledger_reversal ON credit_ledger(reversed_entry_id) WHERE reversed_entry_id IS NOT NULL;

      CREATE TABLE IF NOT EXISTS replenishment_policies (
        product_id TEXT PRIMARY KEY,
        lead_time_days INTEGER CHECK(lead_time_days IS NULL OR lead_time_days>=0),
        safety_stock REAL NOT NULL DEFAULT 0 CHECK(safety_stock>=0),
        minimum_purchase_quantity REAL NOT NULL DEFAULT 0 CHECK(minimum_purchase_quantity>=0),
        preferred_supplier_id TEXT,
        exclude_expiring_days INTEGER NOT NULL DEFAULT 0 CHECK(exclude_expiring_days>=0),
        updated_by TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(preferred_supplier_id) REFERENCES suppliers(id)
      );
    `);

    addColumn(db, 'products', 'track_lots', "INTEGER NOT NULL DEFAULT 0 CHECK(track_lots IN(0,1))");
    addColumn(db, 'sale_items', 'lot_id', 'TEXT REFERENCES inventory_lots(id)');
    addColumn(db, 'sale_items', 'lot_code_snapshot', 'TEXT');

    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(COMMERCIAL_CORE_SCHEMA_VERSION, COMMERCIAL_CORE_MIGRATION_NAME, now());
  });
  return COMMERCIAL_CORE_SCHEMA_VERSION;
}

module.exports = {
  COMMERCIAL_CORE_SCHEMA_VERSION,
  COMMERCIAL_CORE_MIGRATION_NAME,
  runCommercialCoreMigrations
};
