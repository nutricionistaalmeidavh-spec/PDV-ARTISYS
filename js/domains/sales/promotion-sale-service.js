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
    let requested=manualOverride===undefined?previous.manualDiscountCents:assertCents(Number(manualOverride),'discountCents');
    if(requested<0) throw new Error('Desconto nao pode ser negativo.');
    const promotion=promotionService.resolvePromotions(sale.items||[],now());
    if(promotion.blocksManualDiscount&&requested>0){
      if(manualOverride!==undefined)throw new Error('Este combo nao permite desconto manual acumulado.');
      requested=0;
    }
    const calculatedSubtotal=(sale.items||[]).reduce((sum,item)=>sum+Math.round(Number(item.unitPriceCents||0)*Number(item.quantity||0)),0);
    const promotionDiscountCents=Math.min(Number(promotion.discountCents||0),calculatedSubtotal);
    const manualDiscountCents=Math.min(requested,Math.max(calculatedSubtotal-promotionDiscountCents,0));
    const combined=promotionDiscountCents+manualDiscountCents;
    const priced=baseSales.applyDiscount(saleId,{discountCents:combined});
    writeState(saleId,{manualDiscountCents,promotionDiscountCents,promotions:promotion.applied||[],blocksManualDiscount:Boolean(promotion.blocksManualDiscount)});
    return enrich(priced);
  }

  function kitSnapshot(productId) {
    const kit=promotionService.getKit?.(productId);
    if(!kit||!kit.active)return null;
    return {
      version:1,
      productId:kit.id,
      name:kit.name,
      components:(kit.components||[]).map(component=>({
        productId:component.productId,
        productName:component.productName||null,
        quantity:Number(component.quantity),
        unit:component.unit||'UN'
      }))
    };
  }

  function assertVariantStock(sale){
    const totals=new Map();
    for(const item of sale?.items||[]){
      const variant=item.configuration?.productVariant||item.configuration?.retailVariant;if(!variant?.id)continue;
      const current=totals.get(String(variant.id))||{quantity:0,label:`${item.productName} - ${variant.name||'variação'}`};
      current.quantity+=Number(item.quantity||0);totals.set(String(variant.id),current);
    }
    for(const [variantId,required] of totals){
      const row=db.prepare(`SELECT v.active,p.active AS product_active,COALESCE(b.quantity,0) AS quantity
        FROM product_variants v JOIN products p ON p.id=v.product_id LEFT JOIN retail_variant_balances b ON b.variant_id=v.id WHERE v.id=?`).get(variantId);
      if(!row||!row.active||!row.product_active)throw new Error(`Variacao inativa ou inexistente: ${required.label}.`);
      if(Number(required.quantity)>Number(row.quantity||0))throw new Error(`Estoque insuficiente para ${required.label}.`);
    }
  }

  function hasActiveVariants(productId){
    if(productId==null)return false;
    return Boolean(db.prepare('SELECT 1 FROM product_variants WHERE product_id=? AND active=1 LIMIT 1').get(String(productId)));
  }

  function openSale(input={},actor=null) {
    const sale=baseSales.openSale(input,actor);
    writeState(sale.id,{manualDiscountCents:0,promotionDiscountCents:0,promotions:[],blocksManualDiscount:false});
    return enrich(sale);
  }
  function setCustomer(id,customerId){return enrich(baseSales.setCustomer(id,customerId));}
  function addItem(id,input={}){
    const kit=kitSnapshot(input.productId);
    if(!kit&&!input.configurationSnapshot&&input.forceSeparateLine!==true&&hasActiveVariants(input.productId))throw new Error('Este produto possui variacoes. Selecione o subitem desejado.');
    if(kit&&!input.configurationSnapshot&&input.forceSeparateLine!==true){
      const current=baseSales.getSale(id);
      const existing=(current?.items||[]).find(item=>item.productId===String(input.productId)&&item.configuration?.kit?.productId===kit.productId);
      if(existing){
        const quantity=Number(existing.quantity||0)+Number(input.quantity??1);
        baseSales.updateItemQuantityById(id,existing.id,quantity);
        return reprice(id);
      }
    }
    const payload=kit?{...input,configurationSnapshot:{...(input.configurationSnapshot||{}),kit}}:input;
    baseSales.addItem(id,payload);return reprice(id);
  }
  function updateItemQuantity(id,productId,quantity){baseSales.updateItemQuantity(id,productId,quantity);return reprice(id);}
  function updateItemQuantityById(id,itemId,quantity){baseSales.updateItemQuantityById(id,itemId,quantity);return reprice(id);}
  function removeItem(id,productId){baseSales.removeItem(id,productId);return reprice(id);}
  function removeItemById(id,itemId){baseSales.removeItemById(id,itemId);return reprice(id);}
  function applyDiscount(id,{discountCents=0}={}){return reprice(id,discountCents);}
  function suspendSale(id){reprice(id);return enrich(baseSales.suspendSale(id));}
  function resumeSale(id){baseSales.resumeSale(id);return reprice(id);}
  function completeSale(id,input={}){reprice(id);const sale=baseSales.getSale(id);assertVariantStock(sale);baseSales.completeSale(id,input);return enrich(baseSales.getSale(id));}
  function cancelSale(id,input={}){return enrich(baseSales.cancelSale(id,input));}
  function getSale(id){return enrich(baseSales.getSale(id));}
  function getSaleDetails(id){return enrich(baseSales.getSaleDetails(id));}
  function listSales(filters={}){return baseSales.listSales(filters).map(enrich);}
  function listHistory(filters={}){return baseSales.listHistory(filters).map(enrich);}

  return {openSale,setCustomer,addItem,updateItemQuantity,updateItemQuantityById,removeItem,removeItemById,applyDiscount,suspendSale,resumeSale,completeSale,cancelSale,getSale,getSaleDetails,listSales,listHistory};
}

module.exports = { createPromotionSaleService };
