'use strict';

const MIGRATION_VERSION=1;
const MIGRATION_NAME='pizza_canonical_composition_v1';

function hasColumn(db,table,column){
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column);
}

function runPizzeriaCompositionMigrations(db,now=()=>new Date().toISOString()){
  db.exec(`CREATE TABLE IF NOT EXISTS pizzeria_schema_migrations(
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied=db.prepare('SELECT 1 FROM pizzeria_schema_migrations WHERE version=?').get(MIGRATION_VERSION);
  if(applied)return;
  if(!hasColumn(db,'pizza_sizes','recipe_multiplier'))db.exec('ALTER TABLE pizza_sizes ADD COLUMN recipe_multiplier REAL NOT NULL DEFAULT 1');
  if(!hasColumn(db,'pizza_flavors','recipe_product_id'))db.exec('ALTER TABLE pizza_flavors ADD COLUMN recipe_product_id TEXT');
  if(!hasColumn(db,'pizza_crusts','recipe_product_id'))db.exec('ALTER TABLE pizza_crusts ADD COLUMN recipe_product_id TEXT');
  db.prepare('INSERT INTO pizzeria_schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(MIGRATION_VERSION,MIGRATION_NAME,now());
}

module.exports={runPizzeriaCompositionMigrations,MIGRATION_VERSION,MIGRATION_NAME};
