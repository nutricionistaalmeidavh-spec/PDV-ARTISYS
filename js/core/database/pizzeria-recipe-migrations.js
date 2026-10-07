'use strict';

const {withTransaction}=require('./sqlite-database');

const PIZZERIA_RECIPE_SCHEMA_VERSION=33;
const PIZZERIA_RECIPE_MIGRATION_NAME='pizzeria_recipe_components_v33';

function hasColumn(db,table,column){
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row=>row.name===column);
}

function runPizzeriaRecipeMigrations(db,now=()=>new Date().toISOString()){
  const applied=db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(PIZZERIA_RECIPE_SCHEMA_VERSION);
  if(applied)return PIZZERIA_RECIPE_SCHEMA_VERSION;
  withTransaction(db,()=>{
    if(!hasColumn(db,'pizza_sizes','recipe_multiplier')){
      db.exec('ALTER TABLE pizza_sizes ADD COLUMN recipe_multiplier REAL NOT NULL DEFAULT 1');
    }
    if(!hasColumn(db,'pizza_flavors','recipe_product_id')){
      db.exec('ALTER TABLE pizza_flavors ADD COLUMN recipe_product_id TEXT');
    }
    if(!hasColumn(db,'pizza_crusts','recipe_product_id')){
      db.exec('ALTER TABLE pizza_crusts ADD COLUMN recipe_product_id TEXT');
    }
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(PIZZERIA_RECIPE_SCHEMA_VERSION,PIZZERIA_RECIPE_MIGRATION_NAME,now());
  });
  return PIZZERIA_RECIPE_SCHEMA_VERSION;
}

module.exports={PIZZERIA_RECIPE_SCHEMA_VERSION,PIZZERIA_RECIPE_MIGRATION_NAME,runPizzeriaRecipeMigrations};
