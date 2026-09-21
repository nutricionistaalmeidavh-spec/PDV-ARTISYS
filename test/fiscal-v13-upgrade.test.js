'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runReleaseMigrations}=require('../js/core/database/release-migrations');
const {runVerticalMigrations}=require('../js/core/database/vertical-migrations');
const {runKitComboMigrations}=require('../js/core/database/kit-combo-migrations');
const {runEnterpriseDepthMigrations}=require('../js/core/database/enterprise-depth-migrations');
const {runSalesEnhancementMigrations}=require('../js/core/database/sales-enhancement-migrations');
const {runCommercialMediaMigrations}=require('../js/core/database/commercial-media-migrations');
const {runFiscalMigrations,FISCAL_SCHEMA_VERSION}=require('../js/core/database/fiscal-migrations');

test('upgrade v12 -> v13 is additive, idempotent and preserves legacy rows',()=>{
  const db=openDatabase(':memory:');
  const now=()=> '2026-09-20T18:00:00.000Z';
  try{
    runMigrations(db,now);
    runReleaseMigrations(db,now);
    runVerticalMigrations(db,now);
    runKitComboMigrations(db,now);
    runEnterpriseDepthMigrations(db,now);
    runSalesEnhancementMigrations(db,now);
    runCommercialMediaMigrations(db,now);
    assert.equal(Number(db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v),12);

    db.prepare("INSERT INTO categories(id,name,active,created_at,updated_at) VALUES('cat-fiscal','Fiscal',1,?,?)").run(now(),now());
    db.prepare(`INSERT INTO products(id,category_id,name,sku,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at)
      VALUES('prod-existing','cat-fiscal','Produto Existente','EX-1','UN',1000,500,1,0,1,?,?)`).run(now(),now());
    const before=db.prepare("SELECT id,name,sku,sale_price_cents FROM products WHERE id='prod-existing'").get();

    assert.equal(runFiscalMigrations(db,now),FISCAL_SCHEMA_VERSION);
    assert.equal(runFiscalMigrations(db,now),FISCAL_SCHEMA_VERSION);
    assert.deepEqual(db.prepare("SELECT id,name,sku,sale_price_cents FROM products WHERE id='prod-existing'").get(),before);
    assert.equal(Number(db.prepare('SELECT COUNT(*) AS c FROM schema_migrations WHERE version=13').get().c),1);
    assert.equal(Number(db.prepare('PRAGMA foreign_keys').get().foreign_keys),1);
  }finally{db.close();}
});
