'use strict';

const { withTransaction } = require('./sqlite-database');

const FISCAL_SCHEMA_VERSION = 13;
const FISCAL_MIGRATION_NAME = 'fiscal_configuration_tax_persistence_1_4_0';

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

function ensureColumn(db, table, name, definition) {
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function runFiscalMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= FISCAL_SCHEMA_VERSION) return current;
  if (current < 12) throw new Error('Fiscal Bloco 2 requer schema v12 antes da migracao v13.');

  withTransaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fiscal_company_settings (
        id TEXT PRIMARY KEY CHECK (id='default'),
        provider TEXT NOT NULL DEFAULT 'acbr-local' CHECK (provider IN ('acbr-local','focus')),
        document_type TEXT NOT NULL DEFAULT 'nfce' CHECK (document_type IN ('nfce','nfe')),
        environment TEXT NOT NULL DEFAULT 'homologation' CHECK (environment IN ('homologation','production')),
        auto_issue INTEGER NOT NULL DEFAULT 0 CHECK (auto_issue IN (0,1)),
        cnpj TEXT NOT NULL,
        state_registration TEXT NOT NULL,
        legal_name TEXT NOT NULL,
        trade_name TEXT,
        crt TEXT NOT NULL,
        cnae TEXT,
        series TEXT NOT NULL,
        operation_nature TEXT NOT NULL DEFAULT 'VENDA',
        csc_id TEXT,
        address_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fiscal_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ncm TEXT NOT NULL,
        cest TEXT,
        cfop TEXT NOT NULL,
        origin TEXT NOT NULL,
        csosn TEXT,
        icms_cst TEXT,
        pis_cst TEXT NOT NULL,
        cofins_cst TEXT NOT NULL,
        unit TEXT NOT NULL,
        ibs_cbs_cst TEXT,
        c_class_trib TEXT,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_fiscal_profiles_active_name ON fiscal_profiles(active,name,id);

      CREATE TABLE IF NOT EXISTS product_fiscal_data (
        product_id TEXT PRIMARY KEY,
        fiscal_profile_id TEXT NOT NULL,
        gtin TEXT,
        overrides_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (fiscal_profile_id) REFERENCES fiscal_profiles(id)
      );
      CREATE INDEX IF NOT EXISTS idx_product_fiscal_profile ON product_fiscal_data(fiscal_profile_id,product_id);

      CREATE TABLE IF NOT EXISTS fiscal_sequences (
        document_type TEXT NOT NULL CHECK (document_type IN ('nfce','nfe')),
        environment TEXT NOT NULL CHECK (environment IN ('homologation','production')),
        series TEXT NOT NULL,
        next_number INTEGER NOT NULL CHECK (next_number > 0),
        updated_at TEXT NOT NULL,
        PRIMARY KEY (document_type,environment,series)
      );

      CREATE TABLE IF NOT EXISTS fiscal_certificates_metadata (
        id TEXT PRIMARY KEY CHECK (id='default'),
        certificate_name TEXT,
        fingerprint TEXT,
        subject TEXT,
        serial_number TEXT,
        valid_from TEXT,
        valid_to TEXT,
        cnpj TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fiscal_document_events (
        id TEXT PRIMARY KEY,
        fiscal_document_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        status TEXT,
        sefaz_code TEXT,
        sefaz_message TEXT,
        protocol TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (fiscal_document_id) REFERENCES fiscal_documents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_fiscal_document_events_doc ON fiscal_document_events(fiscal_document_id,created_at,id);
    `);

    ensureColumn(db, 'fiscal_documents', 'authorization_protocol', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'xml_path', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'danfe_path', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'contingency_type', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'authorized_at', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'rejected_at', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'sefaz_code', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'sefaz_message', 'TEXT');

    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(FISCAL_SCHEMA_VERSION, FISCAL_MIGRATION_NAME, now());
  });
  return FISCAL_SCHEMA_VERSION;
}

module.exports = {
  FISCAL_SCHEMA_VERSION,
  FISCAL_MIGRATION_NAME,
  runFiscalMigrations
};
