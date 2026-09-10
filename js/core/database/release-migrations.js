'use strict';

const { withTransaction } = require('./sqlite-database');

const RELEASE_SCHEMA_VERSION = 4;
const RELEASE_MIGRATION_NAME = 'pdv_release_e22_e29';

const RELEASE_SQL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    scope TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    value_type TEXT NOT NULL,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (scope,setting_key)
  );
  CREATE INDEX IF NOT EXISTS idx_app_settings_key ON app_settings(setting_key,scope);

  CREATE TABLE IF NOT EXISTS backup_records (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL,
    manifest_path TEXT NOT NULL,
    reason TEXT NOT NULL,
    app_version TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    valid INTEGER NOT NULL DEFAULT 0 CHECK (valid IN (0,1)),
    created_at TEXT NOT NULL,
    validated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_backup_records_created ON backup_records(created_at);

  CREATE TABLE IF NOT EXISTS import_batches (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    format TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    collision_policy TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('PREVIEWED','COMMITTED','FAILED')),
    rows_json TEXT NOT NULL,
    summary_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    committed_at TEXT,
    committed_by TEXT,
    UNIQUE(type,format,content_hash,collision_policy)
  );
  CREATE INDEX IF NOT EXISTS idx_import_batches_status_created ON import_batches(status,created_at);

  CREATE TABLE IF NOT EXISTS import_errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id TEXT NOT NULL,
    row_number INTEGER NOT NULL,
    message TEXT NOT NULL,
    row_json TEXT,
    FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_import_errors_batch ON import_errors(batch_id,row_number);

  CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL CHECK(level IN('debug','info','warn','error')),
    subsystem TEXT NOT NULL,
    message TEXT NOT NULL,
    correlation_id TEXT,
    terminal_id TEXT,
    context_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_system_logs_created ON system_logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_system_logs_filter ON system_logs(level,subsystem,terminal_id,created_at);

  CREATE TABLE IF NOT EXISTS pilot_checks (
    check_key TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    optional INTEGER NOT NULL DEFAULT 0 CHECK(optional IN(0,1)),
    status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN('NOT_STARTED','IN_PROGRESS','READY','BLOCKED','BLOCKED_EXTERNAL')),
    note TEXT,
    evidence_json TEXT,
    updated_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pilot_checks_status ON pilot_checks(status,category);
`;

function runReleaseMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= RELEASE_SCHEMA_VERSION) return RELEASE_SCHEMA_VERSION;

  withTransaction(db, () => {
    db.exec(RELEASE_SQL);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(RELEASE_SCHEMA_VERSION, RELEASE_MIGRATION_NAME, now());
  });
  return RELEASE_SCHEMA_VERSION;
}

module.exports = {
  RELEASE_SCHEMA_VERSION,
  RELEASE_MIGRATION_NAME,
  RELEASE_SQL,
  runReleaseMigrations
};
