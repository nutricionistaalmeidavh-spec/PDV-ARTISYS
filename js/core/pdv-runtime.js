'use strict';
const path=require('node:path');
const { randomUUID }=require('node:crypto');
const { openDatabase }=require('./database/sqlite-database');
const { runMigrations }=require('./database/migrations');
const { runReleaseMigrations }=require('./database/release-migrations');
const { runVerticalMigrations }=require('./database/vertical-migrations');
const { SqliteOutboxStore }=require('./database/outbox-store');
const { SqliteEffectStore }=require('./database/effect-store');
const { DomainEventBus }=require('./domain-event-bus');
const { DomainEventDispatcher }=require('./domain-event-dispatcher');
const { createCatalogService }=require('../domains/catalog/catalog-service');
const { createCatalogCustomizationService }=require('../domains/catalog/catalog-customization-service');
const { createInventoryService }=require('../domains/inventory/inventory-service');
const { createRecipeService }=require('../domains/inventory/recipe-service');
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
const { createNonFiscalPrintService }=require('../domains/printing/non-fiscal-service');
const { registerNonFiscalEffects }=require('../domains/printing/non-fiscal-effects');
const { createFiscalService }=require('../domains/fiscal/fiscal-service');
const { registerFiscalEffects, registerFiscalAutoIssueEffect }=require('../domains/fiscal/fiscal-effects');
const { createRestaurantService }=require('../domains/restaurant/restaurant-service');
const { createRestaurantSettlementService }=require('../domains/restaurant/restaurant-settlement-service');
const { createKitchenService }=require('../domains/restaurant/kitchen-service');
const { createMobileDeviceService }=require('../domains/restaurant/mobile-device-service');
const { createRestaurantReportingService }=require('../domains/restaurant/restaurant-reporting-service');
const { registerRestaurantEffects }=require('../domains/restaurant/restaurant-effects');
const { createPizzeriaService }=require('../domains/pizzeria/pizzeria-service');
const { createDeliveryService }=require('../domains/delivery/delivery-service');
const { createFastFoodService }=require('../domains/fast-food/fast-food-service');
const { createMarketBakeryService }=require('../domains/market-bakery/market-bakery-service');
const { createTerminalRegistry }=require('../../server/lan/terminal-registry');
const { createMutationCoordinator }=require('../../server/lan/mutation-coordinator');
const { createBackupService }=require('./backup/backup-service');
const { createSettingsService }=require('./settings/settings-service');
const { createModuleService }=require('./modules/module-service');
const { createImportService }=require('./import/import-service');
const { createSystemLogger }=require('./observability/system-logger');
const { createSystemHealth }=require('./observability/system-health');
const { createDiagnosticPackage }=require('./observability/diagnostic-package');
const { createPilotService }=require('./pilot/pilot-service');

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
  diagnosticsDir=null,
  logRetention=5000,
  appVersion=serverVersion,
  readScale=null
}={}){
  const db=openDatabase(dbPath);runMigrations(db,now);runReleaseMigrations(db,now);runVerticalMigrations(db,now);
  const outbox=new SqliteOutboxStore(db);const effectStore=new SqliteEffectStore(db);const bus=new DomainEventBus();
  const settings=createSettingsService({db,now});
  const modules=createModuleService({db,settings,now});
  const catalog=createCatalogService({db,now,idFactory});
  const catalogCustomization=createCatalogCustomizationService({db,now,idFactory});
  const inventory=createInventoryService({db,now,idFactory});
  const recipes=createRecipeService({db,now,idFactory});
  const cash=createCashService({db,outbox,now,idFactory});
  const sales=createSaleService({db,outbox,now,idFactory,stockRequirementsResolver:items=>recipes.expandItems(items)});
  const returns=createReturnService({db,outbox,now,idFactory});
  const finance=createFinanceService({db,now,idFactory});
  const reports=createReportingService({db,now});
  const printing=createPrintService({db,now,idFactory});
  const nonFiscalPrinting=createNonFiscalPrintService({printService:printing,storeName:receiptOptions.storeName||'ArtiSys',width:receiptOptions.width||42,idFactory});
  const fiscal=createFiscalService({db,outbox,now,idFactory});
  const restaurant=createRestaurantService({db,outbox,now,idFactory});
  const restaurantSettlement=createRestaurantSettlementService({db,modules,sales,now,idFactory});
  const kitchen=createKitchenService({db,now,idFactory});
  const mobileDevices=createMobileDeviceService({db,now,idFactory});
  const restaurantReports=createRestaurantReportingService({db});
  const pizzeria=createPizzeriaService({db,modules,catalogCustomization,now,idFactory});
  const delivery=createDeliveryService({db,modules,sales,now,idFactory});
  const fastFood=createFastFoodService({db,modules,now,idFactory});
  const marketBakery=createMarketBakeryService({db,modules,now,idFactory,readScale});
  const terminalOptions={db,now,idFactory,serverVersion,minimumTerminalVersion};
  if(Array.isArray(capabilities))terminalOptions.capabilities=capabilities;
  const terminals=createTerminalRegistry(terminalOptions);
  const mutations=createMutationCoordinator({db,now});
  const imports=createImportService({db,catalog,inventory,now,idFactory});
  const logger=createSystemLogger({db,now,retention:logRetention});
  const pilot=createPilotService({db,now});
  const resolvedBackupDir=dbPath!==':memory:'?(backupDir||path.join(path.dirname(dbPath),'backups')):null;
  const backups=resolvedBackupDir?createBackupService({db,dbPath,backupDir:resolvedBackupDir,now,appVersion,retention:backupRetention}):null;
  const health=createSystemHealth({db,version:appVersion,backupStatus:()=>backups?backups.getBackupStatus():({count:0,latest:null,pendingRestore:false})});
  const resolvedDiagnosticsDir=dbPath!==':memory:'?(diagnosticsDir||path.join(path.dirname(dbPath),'diagnostics')):null;
  const diagnostics=resolvedDiagnosticsDir?createDiagnosticPackage({db,health,settings,logger,diagnosticsDir:resolvedDiagnosticsDir,version:appVersion,now,idFactory}):null;

  registerInventoryEffects({bus,inventoryService:inventory,effectStore,recipeService:recipes});
  registerCashEffects({bus,cashService:cash,effectStore});
  registerReturnEffects({bus,inventoryService:inventory,cashService:cash,effectStore,recipeService:recipes});
  registerPrintEffects({bus,effectStore,printService:printing,saleService:sales,...receiptOptions});
  registerNonFiscalEffects({bus,effectStore,cashService:cash,nonFiscalPrintService:nonFiscalPrinting});
  registerRestaurantEffects({bus,effectStore,restaurantService:restaurant,kitchenService:kitchen,nonFiscalPrintService:nonFiscalPrinting});

  // Fiscal permanece apenas como compatibilidade legada interna. Novos fluxos E40-E47
  // nao chamam este servico e o produto comercial segue a regra somente NAO FISCAL.
  registerFiscalEffects({bus,effectStore,fiscalService:fiscal,providerResolver:fiscalProviderResolver});
  if(typeof fiscalAutoIssueResolver==='function'){
    registerFiscalAutoIssueEffect({bus,effectStore,fiscalService:fiscal,saleService:sales,resolveConfiguration:fiscalAutoIssueResolver});
  }

  const dispatcher=new DomainEventDispatcher({bus,outbox});
  return {
    db,outbox,effectStore,bus,dispatcher,
    catalog,catalogCustomization,inventory,recipes,sales,cash,returns,finance,reports,printing,nonFiscalPrinting,fiscal,
    modules,restaurant,restaurantSettlement,kitchen,mobileDevices,restaurantReports,pizzeria,delivery,fastFood,marketBakery,terminals,mutations,
    backups,settings,imports,logger,health,diagnostics,pilot,
    backupDir:resolvedBackupDir,diagnosticsDir:resolvedDiagnosticsDir,
    dispatchPending:()=>dispatcher.dispatchPending(),
    close(){db.close();}
  };
}
module.exports={createPdvRuntime};
