'use strict';

const { assertCents } = require('../shared/money');

function parsePromotions(value) { try { return value ? JSON.parse(value) : []; } catch { return []; } }

function createPromotionSaleService({ db, baseSales, promotionService, now = () => new Date().toISOString() } = {}) {
  if(!db || !baseSales || !promotionService) throw new TypeError('db, baseSales and promotionService are required.');

  function readState(sale) {
    const row=db.prepare('SELECT * FROM sale_discount_states WHERE sale_id=?').get(String(sale.id));
    if(row) return {manualDiscountCents:row.manual_discount_cents,promotionDiscountCents:row.promotion_discount_cents,promotions:parsePromotions(row.promotions_json),blocksManualDiscount:Boolean(row.blocks_manual_discount)};
    return {manualDiscountCents:Number(sale.discountCents||0),promotionDiscountCents:0,promotions:[],blocksManualDiscount:false};
  }

  function enrich(sale) {
    if(!sale) return sale;
    const state=readState(sale);
    return {...sale,manualDiscountCents:state.manualDiscountCents,promotionDiscountCents:state.promotionDiscountCents,totalDiscountCents:Number(sale.discountCents||0),promotions:state.promotions,blocksManualDiscount:state.blocksManualDiscount};
  }

  function writeState(saleId,state) {
    db.prepare(`INSERT INTO sale_discount_states(sale_id,manual_discount_cents,promotion_discount_cents,promotions_json,blocks_manual_discount,updated_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(sale_id) DO UPDATE SET manual_discount_cents=excluded.manual_discount_cents,promotion_discount_cents=excluded.promotion_discount_cents,promotions_json=excluded.promotions_json,blocks_manual_discount=excluded.blocks_manual_discount,updated_at=excluded.updated_at`)
      .run(String(saleId),state.manualDiscountCents,state.promotionDiscountCents,JSON.stringify(state.promotions||[]),state.blocksManualDiscount?1:0,now());
  }

  function reprice(saleId, manualOverride) {
    const sale=baseSales.getSale(saleId); if(!sale) throw new Error('Venda nao encontrada.');
    const previous=readState(sale);
    const requested=manualOverride===undefined?previous.manualDiscountCents:assertCents(Number(manualOverride),'discountCents');
    if(requested<0) throw new Error('Desconto nao pode ser negativo.');
    const promotion=promotionService.resolvePromotions(sale.items||[],now());
    if(promotion.blocksManualDiscount&&requested>0) throw new Error('Este combo nao permite desconto manual acumulado.');
    const subtotal=Number(sale.items||[] .reduce?.(()=>0,0));
    const calculatedSubtotal=(sale.items||[]).reduce((sum,item)=>sum+Math.round(Number(item.unitPriceCents||0)*Number(item.quantity||0)),0);
    const promotionDiscountCents=Math.min(Number(promotion.discountCents||0),calculatedSubtotal);
    const manualDiscountCents=Math.min(requested,Math.max(calculatedSubtotal-promotionDiscountCents,0));
    const combined=promotionDiscountCents+manualDiscountCents;
    const priced=baseSales.applyDiscount(saleId,{discountCents:combined});
    writeState(saleId,{manualDiscountCents,promotionDiscountCents,promotions:promotion.applied||[],blocksManualDiscount:Boolean(promotion.blocksManualDiscount)});
    return enrich(priced);
  }

  function openSale(input={},actor=null) {
    const sale=baseSales.openSale(input,actor);
    writeState(sale.id,{manualDiscountCents:0,promotionDiscountCents:0,promotions:[],blocksManualDiscount:false});
    return enrich(sale);
  }
  function setCustomer(id,customerId){return enrich(baseSales.setCustomer(id,customerId));}
  function addItem(id,input){baseSales.addItem(id,input);return reprice(id);}
  function updateItemQuantity(id,productId,quantity){baseSales.updateItemQuantity(id,productId,quantity);return reprice(id);}
  function updateItemQuantityById(id,itemId,quantity){baseSales.updateItemQuantityById(id,itemId,quantity);return reprice(id);}
  function removeItem(id,productId){baseSales.removeItem(id,productId);return reprice(id);}
  function removeItemById(id,itemId){baseSales.removeItemById(id,itemId);return reprice(id);}
  function applyDiscount(id,{discountCents=0}={}){return reprice(id,discountCents);}
  function suspendSale(id){reprice(id);return enrich(baseSales.suspendSale(id));}
  function resumeSale(id){baseSales.resumeSale(id);return reprice(id);}
  function completeSale(id,input={}){reprice(id);baseSales.completeSale(id,input);return enrich(baseSales.getSale(id));}
  function cancelSale(id,input={}){return enrich(baseSales.cancelSale(id,input));}
  function getSale(id){return enrich(baseSales.getSale(id));}
  function getSaleDetails(id){return enrich(baseSales.getSaleDetails(id));}
  function listSales(filters={}){return baseSales.listSales(filters).map(enrich);}
  function listHistory(filters={}){return baseSales.listHistory(filters).map(enrich);}

  return {openSale,setCustomer,addItem,updateItemQuantity,updateItemQuantityById,removeItem,removeItemById,applyDiscount,suspendSale,resumeSale,completeSale,cancelSale,getSale,getSaleDetails,listSales,listHistory};
}

module.exports = { createPromotionSaleService };
