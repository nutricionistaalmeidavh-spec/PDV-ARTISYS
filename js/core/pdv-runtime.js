'use strict';
const path=require('node:path');
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
const { createReturnService }=require('../domains/returns/return-service');
const { registerReturnEffects }=require('../domains/returns/return-effects');
const { createFinanceService }=require('../domains/finance/finance-service');
const { createReportingService }=require('../domains/reports/reporting-service');
const { createPrintService }=require('../domains/printing/print-service');
const { registerPrintEffects }=require('../domains/printing/print-effects');
const { createFiscalService }=require('../domains/fiscal/fiscal-service');
const { registerFiscalEffects, registerFiscalAutoIssueEffect }=require('../domains/fiscal/fiscal-effects');
const { createTerminalRegistry }=require('../../server/lan/terminal-registry');
const { createMutationCoordinator }=require('../../server/lan/mutation-coordinator');
const { createBackupService }=require('./backup/backup-service');

function createPdvRuntime({
  dbPath=':memory:',
  now=()=>new Date().toISOString(),
  idFactory=p=>`${p}-${randomUUID()}`,
  fiscalProviderResolver=async()=>null,
  fiscalAutoIssueResolver=null,
  receiptOptions={},
  serverVersion='1.0.0',
  minimumTerminalVersion='1.0.0',
  capabilities,
  backupDir=null,
  backupRetention=30,
  appVersion=serverVersion
}={}){
  const db=openDatabase(dbPath);runMigrations(db,now);
  const outbox=new SqliteOutboxStore(db);const effectStore=new SqliteEffectStore(db);const bus=new DomainEventBus();
  const catalog=createCatalogService({db,now,idFactory});
  const inventory=createInventoryService({db,now,idFactory});
  const cash=createCashService({db,outbox,now,idFactory});
  const sales=createSaleService({db,outbox,now,idFactory});
  const returns=createReturnService({db,outbox,now,idFactory});
  const finance=createFinanceService({db,now,idFactory});
  const reports=createReportingService({db,now});
  const printing=createPrintService({db,now,idFactory});
  const fiscal=createFiscalService({db,outbox,now,idFactory});
  const terminalOptions={db,now,idFactory,serverVersion,minimumTerminalVersion};
  if(Array.isArray(capabilities))terminalOptions.capabilities=capabilities;
  const terminals=createTerminalRegistry(terminalOptions);
  const mutations=createMutationCoordinator({db,now});
  const resolvedBackupDir=dbPath!==':memory:'?(backupDir||path.join(path.dirname(dbPath),'backups')):null;
  const backups=resolvedBackupDir?createBackupService({db,dbPath,backupDir:resolvedBackupDir,now,appVersion,retention:backupRetention}):null;

  registerInventoryEffects({bus,inventoryService:inventory,effectStore});
  registerCashEffects({bus,cashService:cash,effectStore});
  registerReturnEffects({bus,inventoryService:inventory,cashService:cash,effectStore});
  registerPrintEffects({bus,effectStore,printService:printing,saleService:sales,...receiptOptions});
  registerFiscalEffects({bus,effectStore,fiscalService:fiscal,providerResolver:fiscalProviderResolver});
  if(typeof fiscalAutoIssueResolver==='function'){
    registerFiscalAutoIssueEffect({bus,effectStore,fiscalService:fiscal,saleService:sales,resolveConfiguration:fiscalAutoIssueResolver});
  }

  const dispatcher=new DomainEventDispatcher({bus,outbox});
  return {
    db,outbox,effectStore,bus,dispatcher,
    catalog,inventory,sales,cash,returns,finance,reports,printing,fiscal,terminals,mutations,backups,
    backupDir:resolvedBackupDir,
    dispatchPending:()=>dispatcher.dispatchPending(),
    close(){db.close();}
  };
}
module.exports={createPdvRuntime};
