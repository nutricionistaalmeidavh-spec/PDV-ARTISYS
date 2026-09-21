'use strict';
const {withTransaction}=require('../../core/database/sqlite-database');
const NFSE_SCHEMA_VERSION=1;
function runNfseMigrations(db,now=()=>new Date().toISOString()){
 if(!db)throw new TypeError('Database is required.');
 db.exec('CREATE TABLE IF NOT EXISTS nfse_schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL)');
 const current=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM nfse_schema_migrations').get()?.version||0);if(current>=NFSE_SCHEMA_VERSION)return current;
 withTransaction(db,()=>{db.exec(`
 CREATE TABLE IF NOT EXISTS nfse_documents(
  id TEXT PRIMARY KEY, reference TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'nfse-national',
  environment TEXT NOT NULL CHECK(environment IN ('homologation','production')),
  status TEXT NOT NULL CHECK(status IN ('PENDING','PROCESSING','AUTHORIZED','REJECTED','UNKNOWN','FAILED','CANCELLED')),
  payload_json TEXT NOT NULL, signed_dps_xml TEXT NOT NULL, provider_response_json TEXT NOT NULL DEFAULT '{}',
  access_key TEXT, dps_id TEXT, authorized_xml TEXT, error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0, reconcile_required INTEGER NOT NULL DEFAULT 0 CHECK(reconcile_required IN (0,1)),
  authorized_at TEXT, cancelled_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(provider,environment,reference)
 );
 CREATE UNIQUE INDEX IF NOT EXISTS idx_nfse_access_key ON nfse_documents(access_key) WHERE access_key IS NOT NULL;
 CREATE INDEX IF NOT EXISTS idx_nfse_status ON nfse_documents(status,updated_at);
 CREATE TABLE IF NOT EXISTS nfse_events(
  id TEXT PRIMARY KEY, nfse_document_id TEXT NOT NULL, event_type TEXT NOT NULL, status TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}', response_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
  FOREIGN KEY(nfse_document_id) REFERENCES nfse_documents(id)
 );
 CREATE INDEX IF NOT EXISTS idx_nfse_events_doc ON nfse_events(nfse_document_id,created_at,id);
 `);db.prepare('INSERT INTO nfse_schema_migrations(version,name,applied_at) VALUES(1,?,?)').run('nfse_national_module_1_4_0',now());});return NFSE_SCHEMA_VERSION;
}
module.exports={NFSE_SCHEMA_VERSION,runNfseMigrations};