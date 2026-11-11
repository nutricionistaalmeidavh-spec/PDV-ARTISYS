'use strict';

const {withTransaction}=require('../../core/database/sqlite-database');
const {normalizeQuickStockInput}=require('../../../shared/quick-stock-rules');

function registerQuickStockProduct(runtime,input={},actor=null) {
  if(!runtime?.db||!runtime?.catalog||!runtime?.inventory)throw new TypeError('Runtime do PDV indisponível para cadastro rápido.');
  const normalized=normalizeQuickStockInput(input);
  const terminalId=String(actor?.terminalId||'').trim();
  const location=terminalId?runtime.db.prepare('SELECT location_id AS locationId FROM terminal_stock_locations WHERE terminal_id=?').get(terminalId):null;
  const locationId=String(location?.locationId||'MAIN');
  const foodEnabled=Boolean(runtime.modules?.isEnabled('FOOD'));

  return withTransaction(runtime.db,()=>{
    const initial=runtime.catalog.upsertProduct({...normalized.product,menuEnabled:false},actor);
    if(normalized.openingQuantity>0){
      runtime.inventory.move({
        productId:initial.id,locationId,type:'opening',
        quantityDelta:normalized.openingQuantity,
        reason:'Estoque inicial pelo cadastro rápido'
      },actor);
    }
    // O destino direto também é salvo para itens aguardando a primeira entrada.
    // Assim, ao adicionar saldo, o item pode ser publicado sem reconfiguração técnica.
    if(foodEnabled){
      runtime.kitchen.configureProductRoute(initial.id,{mode:'DIRECT',stationId:null},actor);
    }
    const product=normalized.publish?runtime.catalog.upsertProduct({...initial,menuEnabled:true},actor):initial;
    const stockQuantity=runtime.inventory.getBalance(product.id,{locationId});
    return {
      product,stockQuantity,locationId,
      published:Boolean(product.menuEnabled),
      availableForSale:Boolean(product.menuEnabled&&stockQuantity>0)
    };
  });
}

module.exports={registerQuickStockProduct};
