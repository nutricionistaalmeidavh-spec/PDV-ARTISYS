'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runReleaseMigrations}=require('../js/core/database/release-migrations');
const {runVerticalMigrations}=require('../js/core/database/vertical-migrations');
const {runKitComboMigrations}=require('../js/core/database/kit-combo-migrations');
const {createCatalogService}=require('../js/domains/catalog/catalog-service');
const {createRecipeService}=require('../js/domains/inventory/recipe-service');
const {createKitComboService}=require('../js/domains/catalog/kit-combo-service');

test('maxApplicationsPerSale is global across all participating products',()=>{
  const db=openDatabase(':memory:');runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);runKitComboMigrations(db);
  let seq=0;const idFactory=p=>`${p}-${++seq}`;const now=()=> '2026-09-12T12:00:00.000Z';
  const catalog=createCatalogService({db,now,idFactory});const recipes=createRecipeService({db,now,idFactory});const service=createKitComboService({db,catalog,recipes,now,idFactory});
  catalog.upsertProduct({id:'a',name:'A',salePriceCents:500,trackStock:true});
  catalog.upsertProduct({id:'b',name:'B',salePriceCents:500,trackStock:true});
  service.upsertPromotionalCombo({id:'limit-one',name:'2 por 8',selectionMode:'SAME_PRODUCT',requiredQuantity:2,bundlePriceCents:800,maxApplicationsPerSale:1,productIds:['a','b']});
  const promo=service.resolvePromotions([{productId:'a',quantity:2,unitPriceCents:500},{productId:'b',quantity:2,unitPriceCents:500}]);
  assert.equal(promo.discountCents,200);
  assert.equal(promo.applied[0].applications,1);
  db.close();
});

test('kit cannot contain another kit even when nested kit is inactive',()=>{
  const db=openDatabase(':memory:');runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);runKitComboMigrations(db);
  let seq=0;const idFactory=p=>`${p}-${++seq}`;const now=()=> '2026-09-12T12:00:00.000Z';
  const catalog=createCatalogService({db,now,idFactory});const recipes=createRecipeService({db,now,idFactory});const service=createKitComboService({db,catalog,recipes,now,idFactory});
  catalog.upsertProduct({id:'base',name:'Base',salePriceCents:100,trackStock:true});
  service.upsertKit({id:'kit-a',name:'Kit A',salePriceCents:150,components:[{productId:'base',quantity:1}],active:false});
  assert.throws(()=>service.upsertKit({id:'kit-b',name:'Kit B',salePriceCents:200,components:[{productId:'kit-a',quantity:1}]}),/Kit dentro de kit nao e suportado/);
  db.close();
});
