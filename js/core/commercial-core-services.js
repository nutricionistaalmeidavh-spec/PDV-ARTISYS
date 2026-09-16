'use strict';

const { runCommercialCoreMigrations } = require('./database/commercial-core-migrations');
const { createLotService } = require('../domains/inventory/lot-service');
const { createPixService } = require('../domains/payments/pix-service');
const { createCreditService } = require('../domains/payments/credit-service');
const { createPurchasingService } = require('../domains/purchasing/purchasing-service');
const { createReplenishmentService } = require('../domains/inventory/replenishment-service');
const { createCommercialSaleService } = require('../domains/sales/commercial-sale-service');
const { createCommercialReturnService } = require('../domains/returns/commercial-return-service');

function createCommercialCoreServices({
  db,settings,inventory,finance,sales,returns,now=()=>new Date().toISOString(),idFactory,
  replenishmentDefaults={leadTimeDays:7,safetyStock:0}
}={}){
  if(!db||!settings||!inventory||!finance||!sales||!returns)throw new TypeError('Commercial core dependencies are required.');
  runCommercialCoreMigrations(db,now);
  const lots=createLotService({db,now,idFactory});
  const pix=createPixService({db,settings,now,idFactory});
  const credits=createCreditService({db,now,idFactory});
  const purchasing=createPurchasingService({db,inventory,finance,lots,now,idFactory});
  const commercialSales=createCommercialSaleService({db,baseSales:sales,lotService:lots,pixService:pix,creditService:credits,now});
  const commercialReturns=createCommercialReturnService({db,baseReturns:returns,lotService:lots,creditService:credits,idFactory});
  const replenishment=createReplenishmentService({db,inventory,now,defaults:replenishmentDefaults,purchasing});
  return{lots,pix,credits,purchasing,replenishment,sales:commercialSales,returns:commercialReturns};
}

module.exports={createCommercialCoreServices};
