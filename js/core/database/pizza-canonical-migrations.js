'use strict';

const {withTransaction}=require('./sqlite-database');

const PIZZA_CANONICAL_SCHEMA_VERSION=33;
const PIZZA_CANONICAL_MIGRATION_NAME='pizza_canonical_composition_v33';

function columns(db,table){
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
}

function addColumn(db,table,name,definition){
  const current=columns(db,table);
  if(!current.has(name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
}

function runPizzaCanonicalMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(PIZZA_CANONICAL_SCHEMA_VERSION));
  const sizes=columns(db,'pizza_sizes'),flavors=columns(db,'pizza_flavors'),crusts=columns(db,'pizza_crusts');
  const canonical=sizes.has('recipe_multiplier')&&flavors.has('recipe_product_id')&&crusts.has('recipe_product_id');
  if(applied&&canonical)return PIZZA_CANONICAL_SCHEMA_VERSION;

  withTransaction(db,()=>{
    addColumn(db,'pizza_sizes','recipe_multiplier','REAL NOT NULL DEFAULT 1 CHECK(recipe_multiplier>0)');
    addColumn(db,'pizza_flavors','recipe_product_id','TEXT REFERENCES products(id)');
    addColumn(db,'pizza_crusts','recipe_product_id','TEXT REFERENCES products(id)');
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pizza_flavors_recipe_product ON pizza_flavors(recipe_product_id);
      CREATE INDEX IF NOT EXISTS idx_pizza_crusts_recipe_product ON pizza_crusts(recipe_product_id);
    `);
    if(!applied)db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(PIZZA_CANONICAL_SCHEMA_VERSION,PIZZA_CANONICAL_MIGRATION_NAME,now());
  });
  return PIZZA_CANONICAL_SCHEMA_VERSION;
}

module.exports={
  PIZZA_CANONICAL_SCHEMA_VERSION,
  PIZZA_CANONICAL_MIGRATION_NAME,
  runPizzaCanonicalMigrations
};
