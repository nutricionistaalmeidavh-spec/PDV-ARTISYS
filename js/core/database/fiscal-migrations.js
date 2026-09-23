'use strict';

const { withTransaction } = require('./sqlite-database');

const FISCAL_SCHEMA_VERSION = 17;
const FISCAL_MIGRATION_NAME = 'fiscal_contingency_state_machine_1_4_0';

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

function ensureColumn(db, table, name, definition) {
  if (!columns(db, table).has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function applyV13(db, now) {
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
      .run(13, 'fiscal_configuration_tax_persistence_1_4_0', now());
  });
}

function applyV14(db, now) {
  withTransaction(db, () => {
    ensureColumn(db, 'fiscal_documents', 'lifecycle_status', "TEXT NOT NULL DEFAULT 'PENDING' CHECK (lifecycle_status IN ('PENDING','PROCESSING','AUTHORIZED','REJECTED','UNKNOWN','FAILED','CANCELLED'))");
    ensureColumn(db, 'fiscal_documents', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)');
    ensureColumn(db, 'fiscal_documents', 'reconcile_required', 'INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_required IN (0,1))');
    ensureColumn(db, 'fiscal_documents', 'processing_started_at', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'last_transition_at', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'last_reconciled_at', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'last_reconcile_status', 'TEXT');

    db.exec(`
      UPDATE fiscal_documents
      SET lifecycle_status=CASE status
        WHEN 'ISSUED' THEN 'AUTHORIZED'
        WHEN 'FAILED' THEN 'FAILED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        ELSE 'PENDING'
      END
      WHERE lifecycle_status='PENDING';
      CREATE INDEX IF NOT EXISTS idx_fiscal_lifecycle_created ON fiscal_documents(lifecycle_status,created_at);
      CREATE INDEX IF NOT EXISTS idx_fiscal_reconcile_required ON fiscal_documents(reconcile_required,lifecycle_status,updated_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_fiscal_authorized_access_key
        ON fiscal_documents(access_key)
        WHERE access_key IS NOT NULL AND lifecycle_status='AUTHORIZED';
    `);

    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(14, 'fiscal_state_reconciliation_1_4_0', now());
  });
}

function applyV15(db, now) {
  withTransaction(db, () => {
    ensureColumn(db, 'fiscal_documents', 'cancellation_protocol', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'cancellation_xml_path', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'cancellation_reason', 'TEXT');
    ensureColumn(db, 'fiscal_documents', 'danfe_print_job_id', 'TEXT');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_fiscal_cancelled_at ON fiscal_documents(cancelled_at,created_at);
      CREATE INDEX IF NOT EXISTS idx_fiscal_authorized_at ON fiscal_documents(authorized_at,created_at);
      DROP INDEX IF EXISTS idx_fiscal_authorized_access_key;
      CREATE UNIQUE INDEX idx_fiscal_authorized_access_key
        ON fiscal_documents(access_key)
        WHERE access_key IS NOT NULL AND lifecycle_status IN ('AUTHORIZED','CANCELLED');
    `);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(15, 'fiscal_monitor_cancel_xml_danfe_1_4_0', now());
  });
}

function applyV16(db, now) {
  withTransaction(db, () => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS fiscal_production_evidence (
        check_key TEXT PRIMARY KEY,
        passed INTEGER NOT NULL CHECK (passed IN (0,1)),
        message TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        checked_at TEXT NOT NULL,
        checked_by TEXT
      );

      CREATE TABLE IF NOT EXISTS fiscal_production_activation (
        id TEXT PRIMARY KEY CHECK (id='default'),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
        activated_at TEXT,
        activated_by TEXT,
        deactivated_at TEXT,
        deactivated_by TEXT,
        check_snapshot_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS fiscal_contingency (
        fiscal_document_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('ISSUED','TRANSMITTING','RECONCILING','RESOLVED','FAILED')),
        reason TEXT NOT NULL,
        entered_at TEXT NOT NULL,
        tp_emis TEXT NOT NULL DEFAULT '9' CHECK (tp_emis='9'),
        document_json TEXT NOT NULL,
        generated_xml TEXT,
        access_key TEXT,
        transmission_attempts INTEGER NOT NULL DEFAULT 0 CHECK (transmission_attempts >= 0),
        last_attempt_at TEXT,
        last_error TEXT,
        resolved_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (fiscal_document_id) REFERENCES fiscal_documents(id)
      );
      CREATE INDEX IF NOT EXISTS idx_fiscal_contingency_status ON fiscal_contingency(status,entered_at);
    `);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(16, 'fiscal_production_contingency_1_4_0', now());
  });
}

function applyV17(db, now) {
  withTransaction(db, () => {
    db.exec(`
      DROP INDEX IF EXISTS idx_fiscal_contingency_status;
      ALTER TABLE fiscal_contingency RENAME TO fiscal_contingency_v16;
      CREATE TABLE fiscal_contingency (
        fiscal_document_id TEXT PRIMARY KEY,
        status TEXT NOT NULL CHECK (status IN ('CONTINGENCY_PENDING','ISSUED','TRANSMITTING','RECONCILING','RESOLVED','FAILED')),
        reason TEXT NOT NULL,
        entered_at TEXT NOT NULL,
        tp_emis TEXT NOT NULL DEFAULT '9' CHECK (tp_emis='9'),
        document_json TEXT NOT NULL,
        generated_xml TEXT,
        access_key TEXT,
        transmission_attempts INTEGER NOT NULL DEFAULT 0 CHECK (transmission_attempts >= 0),
        last_attempt_at TEXT,
        last_error TEXT,
        resolved_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (fiscal_document_id) REFERENCES fiscal_documents(id)
      );
      INSERT INTO fiscal_contingency(
        fiscal_document_id,status,reason,entered_at,tp_emis,document_json,generated_xml,access_key,
        transmission_attempts,last_attempt_at,last_error,resolved_at,updated_at
      )
      SELECT fiscal_document_id,
        CASE WHEN status='ISSUED' AND generated_xml IS NULL THEN 'CONTINGENCY_PENDING' ELSE status END,
        reason,entered_at,tp_emis,document_json,generated_xml,access_key,transmission_attempts,last_attempt_at,last_error,resolved_at,updated_at
      FROM fiscal_contingency_v16;
      DROP TABLE fiscal_contingency_v16;
      CREATE INDEX idx_fiscal_contingency_status ON fiscal_contingency(status,entered_at);
    `);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(17, FISCAL_MIGRATION_NAME, now());
  });
}

function runFiscalMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  // Older installations can report a newer shared schema version while
  // fiscal_documents still has the pre-v13 shape. Repair the additive v13
  // columns before any v15 index references them.
  ensureColumn(db, 'fiscal_documents', 'authorization_protocol', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'xml_path', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'danfe_path', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'contingency_type', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'authorized_at', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'rejected_at', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'sefaz_code', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'sefaz_message', 'TEXT');

  // Repair all additive columns needed by later fiscal indexes/state even when
  // an older build advanced the shared migration version incorrectly.
  ensureColumn(db, 'fiscal_documents', 'lifecycle_status', "TEXT NOT NULL DEFAULT 'PENDING' CHECK (lifecycle_status IN ('PENDING','PROCESSING','AUTHORIZED','REJECTED','UNKNOWN','FAILED','CANCELLED'))");
  ensureColumn(db, 'fiscal_documents', 'attempt_count', 'INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0)');
  ensureColumn(db, 'fiscal_documents', 'reconcile_required', 'INTEGER NOT NULL DEFAULT 0 CHECK (reconcile_required IN (0,1))');
  ensureColumn(db, 'fiscal_documents', 'processing_started_at', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'last_transition_at', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'last_reconciled_at', 'TEXT');
  ensureColumn(db, 'fiscal_documents', 'last_reconcile_status', 'TEXT');

  let current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= FISCAL_SCHEMA_VERSION) return current;
  if (current < 12) throw new Error('Fiscal requer schema v12 antes das migracoes fiscais.');
  if (current < 13) { applyV13(db, now); current = 13; }
  if (current < 14) { applyV14(db, now); current = 14; }
  if (current < 15) { applyV15(db, now); current = 15; }
  if (current < 16) { applyV16(db, now); current = 16; }
  if (current < 17) { applyV17(db, now); current = 17; }
  return current;
}

module.exports = {
  FISCAL_SCHEMA_VERSION,
  FISCAL_MIGRATION_NAME,
  runFiscalMigrations
};