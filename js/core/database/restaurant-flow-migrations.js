'use strict';

const { withTransaction } = require('./sqlite-database');

const RESTAURANT_FLOW_SCHEMA_VERSION = 20;
const RESTAURANT_FLOW_MIGRATION_NAME = 'restaurant_waiter_assignment_v20';

function hasColumn(db,table,column){
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column);
}

function runRestaurantFlowMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const current=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version||0);
  if(hasColumn(db,'table_sessions','waiter_id'))return Math.max(current,RESTAURANT_FLOW_SCHEMA_VERSION);
  withTransaction(db,()=>{
    db.exec('ALTER TABLE table_sessions ADD COLUMN waiter_id TEXT REFERENCES users(id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_table_sessions_waiter_status ON table_sessions(waiter_id,status,opened_at)');
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(RESTAURANT_FLOW_SCHEMA_VERSION,RESTAURANT_FLOW_MIGRATION_NAME,now());
  });
  return RESTAURANT_FLOW_SCHEMA_VERSION;
}

module.exports={
  RESTAURANT_FLOW_SCHEMA_VERSION,
  RESTAURANT_FLOW_MIGRATION_NAME,
  runRestaurantFlowMigrations
};
