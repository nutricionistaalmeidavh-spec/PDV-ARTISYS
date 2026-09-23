'use strict';
const { runErpFinanceMigrations }=require('../../core/database/erp-finance-migrations');
const { createFinanceDimensionsService }=require('./finance-dimensions');
const { createFinanceService }=require('./finance-service');
const { createProcurementService }=require('../procurement/procurement-service');
const { createFinanceManagementService }=require('./finance-management');
const { createStatementImport }=require('./statement-import');
const { createReconciliation }=require('./reconciliation');

function ensurePdvFinance(runtime,{now=()=>new Date().toISOString(),idFactory}={}){
  if(!runtime?.db||!runtime?.inventory)throw new TypeError('PDV runtime invalido para extensao financeira.');
  if(runtime.__pdvFinanceP0P3Attached)return runtime;
  runErpFinanceMigrations(runtime.db,now);
  const common={db:runtime.db,now};if(idFactory)common.idFactory=idFactory;
  const financeDimensions=createFinanceDimensionsService(common);
  const finance=createFinanceService({...common,dimensions:financeDimensions});
  const procurement=createProcurementService({...common,inventory:runtime.inventory,finance});
  const financeManagement=createFinanceManagementService({db:runtime.db,finance,reports:runtime.reports,dimensions:financeDimensions,now});
  const bankStatements=createStatementImport({...common,finance});
  const financeReconciliation=createReconciliation({...common,finance,statements:bankStatements});
  Object.assign(runtime,{financeDimensions,finance,procurement,financeManagement,bankStatements,financeReconciliation});
  Object.defineProperty(runtime,'__pdvFinanceP0P3Attached',{value:true,enumerable:false,configurable:false});
  return runtime;
}

module.exports={ensurePdvFinance};
