'use strict';

const {withTransaction}=require('./sqlite-database');

const PRODUCTION_OPERATIONS_SCHEMA_VERSION=28;
const PRODUCTION_OPERATIONS_MIGRATION_NAME='pdv_production_device_stations_v28';

function runProductionOperationsMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(PRODUCTION_OPERATIONS_SCHEMA_VERSION));
  const present=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_device_kitchen_stations'").get());
  if(applied&&present)return PRODUCTION_OPERATIONS_SCHEMA_VERSION;
  withTransaction(db,()=>{
    db.exec(`
      CREATE TABLE IF NOT EXISTS mobile_device_kitchen_stations (
        device_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(device_id,station_id),
        FOREIGN KEY(device_id) REFERENCES mobile_devices(id) ON DELETE CASCADE,
        FOREIGN KEY(station_id) REFERENCES kitchen_stations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_device_kitchen_station ON mobile_device_kitchen_stations(station_id,device_id);
    `);
    if(!applied)db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(PRODUCTION_OPERATIONS_SCHEMA_VERSION,PRODUCTION_OPERATIONS_MIGRATION_NAME,now());
  });
  return PRODUCTION_OPERATIONS_SCHEMA_VERSION;
}

module.exports={
  PRODUCTION_OPERATIONS_SCHEMA_VERSION,
  PRODUCTION_OPERATIONS_MIGRATION_NAME,
  runProductionOperationsMigrations
};
