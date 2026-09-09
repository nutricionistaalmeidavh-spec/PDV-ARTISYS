'use strict';
const { randomUUID }=require('node:crypto');
const { openDatabase }=require('./database/sqlite-database');
const { runMigrations }=require('./database/migrations');
const { SqliteOutboxStore }=require('./database/outbox-store');
const { SqliteEffectStore }=require('./database/effect-store');
const { DomainEventBus }=require('./domain-event-bus');
const { DomainEventDispatcher }=require('./domain-event-dispatcher');
const { createCatalogService }=require('../domains/catalog/catalog-service');
const { createInventoryService }=require('../domains/inventory/inventory-service');
const { registerInventoryEffects }=require('../domains/inventory/inventory-effects');
const { createSaleService }=require('../domains/sales/sale-service');
const { createCashService }=require('../domains/cash/cash-service');
const { registerCashEffects }=require('../domains/cash/cash-effects');

function createPdvRuntime({dbPath=':memory:',now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  const db=openDatabase(dbPath);runMigrations(db,now);
  const outbox=new SqliteOutboxStore(db);const effectStore=new SqliteEffectStore(db);const bus=new DomainEventBus();
  const catalog=createCatalogService({db,now,idFactory});
  const inventory=createInventoryService({db,now,idFactory});
  const cash=createCashService({db,outbox,now,idFactory});
  const sales=createSaleService({db,outbox,now,idFactory});
  registerInventoryEffects({bus,inventoryService:inventory,effectStore});
  registerCashEffects({bus,cashService:cash,effectStore});
  const dispatcher=new DomainEventDispatcher({bus,outbox});
  return {db,outbox,effectStore,bus,dispatcher,catalog,inventory,sales,cash,dispatchPending:()=>dispatcher.dispatchPending(),close(){db.close();}};
}
module.exports={createPdvRuntime};
