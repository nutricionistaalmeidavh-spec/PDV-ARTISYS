'use strict';
const { withTransaction } = require('../../core/database/sqlite-database');
const { roundQuantity } = require('../inventory/inventory-rules');

function createAvailabilitySaleService({db,baseSales,logistics,stockRequirementsResolver=null,now=()=>new Date().toISOString()}={}){
  if(!db||!baseSales||!logistics)throw new TypeError('db, baseSales and logistics are required.');
  function locationFor(id){return String(db.prepare("SELECT COALESCE(stock_location_id,'MAIN') AS id FROM sales WHERE id=?").get(String(id))?.id||'MAIN');}
  function enrich(sale){return sale?{...sale,stockLocationId:locationFor(sale.id)}:sale;}
  function pendingOrderFulfillment(saleId){
    const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sales_order_fulfillments'").get();
    if(!exists)return null;
    return db.prepare("SELECT * FROM sales_order_fulfillments WHERE sale_id=? AND status='PENDING' ORDER BY created_at DESC LIMIT 1").get(String(saleId))||null;
  }
  function finalizeOrderFulfillment(fulfillment){
    if(!fulfillment)return;
    const ts=now();
    const items=db.prepare('SELECT * FROM sales_order_fulfillment_items WHERE fulfillment_id=?').all(fulfillment.id);
    for(const item of items)db.prepare('UPDATE sales_order_items SET fulfilled_quantity=MIN(quantity,fulfilled_quantity+?),updated_at=? WHERE id=?').run(Number(item.quantity||0),ts,item.order_item_id);
    const remaining=Number(db.prepare('SELECT COUNT(*) AS n FROM sales_order_items WHERE order_id=? AND fulfilled_quantity < quantity').get(fulfillment.order_id)?.n||0);
    const status=remaining?'PARTIALLY_FULFILLED':'FULFILLED';
    db.prepare('UPDATE sales_orders SET status=?,fulfilled_at=?,updated_at=? WHERE id=?').run(status,status==='FULFILLED'?ts:null,ts,fulfillment.order_id);
    db.prepare("UPDATE sales_order_fulfillments SET status='COMPLETED',completed_at=? WHERE id=?").run(ts,fulfillment.id);
  }
  function requirements(items){const expanded=typeof stockRequirementsResolver==='function'?stockRequirementsResolver(items||[]):(items||[]);const totals=new Map();for(const item of expanded||[]){const id=String(item.productId);totals.set(id,roundQuantity((totals.get(id)||0)+Number(item.quantity||0)));}return totals;}
  function openSale(input={},actor=null){const sale=baseSales.openSale(input,actor);const locationId=String(input.stockLocationId||'MAIN').trim()||'MAIN';const location=db.prepare('SELECT id FROM stock_locations WHERE id=? AND active=1').get(locationId);if(!location){baseSales.cancelSale(sale.id,{reason:'Local de estoque invalido',actor:actor||{}});throw new Error('Local de estoque nao encontrado ou inativo.');}db.prepare('UPDATE sales SET stock_location_id=?,updated_at=? WHERE id=?').run(locationId,new Date().toISOString(),sale.id);return enrich(baseSales.getSale(sale.id));}
  function completeSale(id,input={}){
    return withTransaction(db,()=>{
      const sale=baseSales.getSale(id);if(!sale)throw new Error('Venda nao encontrada.');const locationId=locationFor(id);
      const linkedFulfillment=pendingOrderFulfillment(id);const source=input.reservationSource||(linkedFulfillment?{type:'sales-order',id:linkedFulfillment.order_id}:null);
      for(const [productId,quantity] of requirements(sale.items)){const tracked=db.prepare('SELECT track_stock AS tracked,name FROM products WHERE id=?').get(productId);if(!tracked?.tracked)continue;const availability=logistics.getAvailability(productId,locationId,{excludeSourceType:source?.type||null,excludeSourceId:source?.id||null});if(quantity>availability.availableQuantity)throw new Error(`Estoque disponivel insuficiente para ${tracked.name}. Disponivel: ${availability.availableQuantity}.`);}
      if(source?.type&&source?.id)logistics.bindSourceReservationsToSale(source.type,source.id,id);
      const completed=enrich(baseSales.completeSale(id,{...input,reservationSource:source}));
      finalizeOrderFulfillment(linkedFulfillment);
      return completed;
    });
  }
  const proxy={
    setCustomer:(...a)=>enrich(baseSales.setCustomer(...a)),setSeller:(...a)=>enrich(baseSales.setSeller(...a)),addItem:(...a)=>enrich(baseSales.addItem(...a)),
    updateItemQuantity:(...a)=>enrich(baseSales.updateItemQuantity(...a)),updateItemQuantityById:(...a)=>enrich(baseSales.updateItemQuantityById(...a)),overrideItemPrice:(...a)=>enrich(baseSales.overrideItemPrice(...a)),
    removeItem:(...a)=>enrich(baseSales.removeItem(...a)),removeItemById:(...a)=>enrich(baseSales.removeItemById(...a)),applyDiscount:(...a)=>enrich(baseSales.applyDiscount(...a)),suspendSale:(...a)=>enrich(baseSales.suspendSale(...a)),resumeSale:(...a)=>enrich(baseSales.resumeSale(...a)),
    cancelSale:(id,input={})=>withTransaction(db,()=>{const linked=pendingOrderFulfillment(id);const result=enrich(baseSales.cancelSale(id,input));if(linked&&['CANCELLED'].includes(result?.status)){db.prepare("UPDATE sales_order_fulfillments SET status='FAILED',completed_at=? WHERE id=? AND status='PENDING'").run(now(),linked.id);}return result;}),getSale:id=>enrich(baseSales.getSale(id)),getSaleDetails:id=>enrich(baseSales.getSaleDetails(id)),listSales:f=>baseSales.listSales(f).map(enrich),listHistory:f=>baseSales.listHistory(f).map(enrich)
  };
  return{openSale,completeSale,...proxy};
}
module.exports={createAvailabilitySaleService};
