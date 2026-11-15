'use strict';
const {withTransaction}=require('./sqlite-database');
const {DEFAULT_PROFILE_IDS}=require('../auth/default-profiles');

const CASH_MANAGEMENT_SCHEMA_VERSION=34;
const CASH_MANAGEMENT_MIGRATION_NAME='pdv_cash_management_audit_v34';

function columns(db,table){
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
}

function runCashManagementMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  const existing=columns(db,'cash_sessions');
  if(!existing.has('closed_at'))throw new Error('Migracao de caixa requer tabelas operacionais instaladas.');
  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(CASH_MANAGEMENT_SCHEMA_VERSION));
  withTransaction(db,()=>{
    for(const [name,definition] of [
      ['closed_by_id','TEXT REFERENCES users(id)'],
      ['annulled_at','TEXT'],
      ['annulled_by_id','TEXT REFERENCES users(id)'],
      ['annul_reason','TEXT']
    ]){
      if(!existing.has(name))db.exec(`ALTER TABLE cash_sessions ADD COLUMN ${name} ${definition}`);
    }
    if(!columns(db,'cash_movements').has('actor_id')){
      db.exec('ALTER TABLE cash_movements ADD COLUMN actor_id TEXT REFERENCES users(id)');
    }
    // Sessões antigas já possuem autoria do fechamento no log; preservá-la.
    db.exec(`UPDATE cash_sessions SET closed_by_id=(
      SELECT a.actor_id FROM audit_log a JOIN users u ON u.id=a.actor_id
      WHERE a.entity='cash-session' AND a.entity_id=cash_sessions.id AND a.action='cash.close'
      ORDER BY a.created_at DESC,a.id DESC LIMIT 1
    ) WHERE status='CLOSED' AND closed_by_id IS NULL AND EXISTS(
      SELECT 1 FROM audit_log a JOIN users u ON u.id=a.actor_id
      WHERE a.entity='cash-session' AND a.entity_id=cash_sessions.id AND a.action='cash.close'
    )`);
    db.exec(`
      CREATE TABLE IF NOT EXISTS cash_session_corrections(
        id TEXT PRIMARY KEY,
        cash_session_id TEXT NOT NULL REFERENCES cash_sessions(id),
        previous_counted_cash_cents INTEGER NOT NULL CHECK(previous_counted_cash_cents>=0),
        counted_cash_cents INTEGER NOT NULL CHECK(counted_cash_cents>=0),
        reason TEXT NOT NULL CHECK(length(trim(reason))>=10),
        actor_id TEXT NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_cash_corrections_session ON cash_session_corrections(cash_session_id,created_at,id);
      CREATE INDEX IF NOT EXISTS idx_cash_annulled ON cash_sessions(annulled_at);
    `);
    db.prepare('INSERT OR IGNORE INTO profile_permissions(profile_id,permission_id,created_at) VALUES(?,?,?)')
      .run(DEFAULT_PROFILE_IDS.ADMINISTRATOR,'cash.manage',now());
    if(!applied){
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
        .run(CASH_MANAGEMENT_SCHEMA_VERSION,CASH_MANAGEMENT_MIGRATION_NAME,now());
    }
  });
  return CASH_MANAGEMENT_SCHEMA_VERSION;
}
module.exports={CASH_MANAGEMENT_SCHEMA_VERSION,CASH_MANAGEMENT_MIGRATION_NAME,runCashManagementMigrations};
