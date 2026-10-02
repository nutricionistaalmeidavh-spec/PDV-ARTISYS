'use strict';

function createWholesaleService({modules,orders,pricing,now=()=>new Date().toISOString()}={}){
  if(!modules||!orders||!pricing)throw new TypeError('modules, orders and pricing are required.');
  const gate=actor=>modules.requireAccess('WHOLESALE',actor);
  const manager=actor=>{gate(actor);if(!['manager','admin'].includes(String(actor?.role||'')))throw new Error('Autorizacao de gerente necessaria para precos de atacado.');};

  function listTiers(filters={},actor={}){gate(actor);return pricing.listQuantityTiers(filters);}
  function upsertTier(input={},actor={}){manager(actor);return pricing.upsertQuantityTier(input,actor);}
  function deactivateTier(id,actor={}){manager(actor);return pricing.deactivateQuantityTier(id,actor);}
  function resolvePrice(productId,quantity,actor={}){
    gate(actor);return pricing.resolveUnitPrice({productId,quantity,channel:'WHOLESALE'});
  }
  function createQuote(input={},actor={}){
    gate(actor);
    if(!Array.isArray(input.items)||!input.items.length)throw new Error('Pedido de atacado deve possuir ao menos um item.');
    const items=input.items.map(item=>{const price=pricing.resolveUnitPrice({productId:item.productId,quantity:item.quantity,customerId:input.customerId||null,channel:'WHOLESALE'});return{productId:price.productId,quantity:price.quantity,unitPriceCents:price.unitPriceCents,pricingSnapshot:{version:1,kind:'QUANTITY_TIER',channel:'WHOLESALE',baseUnitPriceCents:price.baseUnitPriceCents,unitPriceCents:price.unitPriceCents,tierId:price.tierId,minQuantity:price.minQuantity,savingsPerUnitCents:price.savingsPerUnitCents,resolvedAt:now()}};});
    return orders.createQuote({...input,origin:'WHOLESALE',items},actor);
  }
  function requireWholesaleOrder(id,actor={}){
    gate(actor);const order=orders.getOrder(id);if(!order)throw new Error('Pedido de atacado nao encontrado.');if(String(order.origin||'STANDARD')!=='WHOLESALE')throw new Error('Pedido informado nao pertence ao Atacado.');return order;
  }
  function getOrder(id,actor={}){return requireWholesaleOrder(id,actor);}
  function listOrders(filters={},actor={}){gate(actor);return orders.listOrders({...filters,origin:'WHOLESALE'});}
  function confirmOrder(id,actor={}){requireWholesaleOrder(id,actor);return orders.confirmOrder(id,actor);}
  function cancelOrder(id,input={},actor={}){requireWholesaleOrder(id,actor);return orders.cancelOrder(id,input,actor);}
  function fulfillOrder(id,input={},actor={}){requireWholesaleOrder(id,actor);return orders.fulfillOrder(id,input,actor);}

  return{listTiers,upsertTier,deactivateTier,resolvePrice,createQuote,getOrder,listOrders,confirmOrder,cancelOrder,fulfillOrder};
}
module.exports={createWholesaleService};
