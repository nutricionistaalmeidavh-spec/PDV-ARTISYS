'use strict';

const { randomUUID }=require('node:crypto');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('../inventory/inventory-rules');
const { assertCents }=require('../shared/money');

function createWholesaleService({db,modules,orders,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules||!orders)throw new TypeError('db, modules and orders are required.');
  const gate=actor=>modules.requireAccess('WHOLESALE',actor);
  const manager=actor=>{gate(actor);if(!['manager','admin'].includes(String(actor?.role||'')))throw new Error('Autorizacao de gerente necessaria para precos de atacado.');};
  const text=value=>String(value||'').trim();

  function product(productId){
    const row=db.prepare('SELECT id,name,sale_price_cents AS salePriceCents,active FROM products WHERE id=?').get(text(productId));
    if(!row||!row.active)throw new Error('Produto nao encontrado ou inativo.');
    return row;
  }
  function mapTier(row){
    if(!row)return null;
    const p=db.prepare('SELECT name,sale_price_cents AS salePriceCents FROM products WHERE id=?').get(row.product_id);
    return{id:row.id,productId:row.product_id,productName:p?.name||null,minQuantity:roundQuantity(row.min_quantity),unitPriceCents:Number(row.unit_price_cents),baseUnitPriceCents:Number(p?.salePriceCents||0),active:Boolean(row.active),createdBy:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at};
  }
  function listTiers({productId=null,includeInactive=false}={},actor={}){
    gate(actor);const clauses=[];const params=[];
    if(productId){clauses.push('product_id=?');params.push(text(productId));}
    if(!includeInactive)clauses.push('active=1');
    return db.prepare(`SELECT * FROM wholesale_price_tiers${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY product_id,min_quantity,id`).all(...params).map(mapTier);
  }
  function upsertTier(input={},actor={}){
    manager(actor);
    const p=product(input.productId);
    const minQuantity=roundQuantity(Number(input.minQuantity));
    if(!Number.isFinite(minQuantity)||minQuantity<=0)throw new Error('Quantidade minima da faixa deve ser maior que zero.');
    const unitPriceCents=assertCents(Number(input.unitPriceCents),'unitPriceCents');
    if(unitPriceCents>Number(p.salePriceCents))throw new Error('Preco de atacado nao pode ser maior que o preco base atual.');
    const id=text(input.id||idFactory('wholesale-tier'));const ts=now();
    const collision=db.prepare('SELECT id FROM wholesale_price_tiers WHERE product_id=? AND min_quantity=? AND id<>?').get(p.id,minQuantity,id);
    if(collision)throw new Error('Ja existe uma faixa para esta quantidade minima.');
    const existing=db.prepare('SELECT id,created_at FROM wholesale_price_tiers WHERE id=?').get(id);
    if(existing)db.prepare('UPDATE wholesale_price_tiers SET product_id=?,min_quantity=?,unit_price_cents=?,active=?,updated_at=? WHERE id=?').run(p.id,minQuantity,unitPriceCents,input.active===false?0:1,ts,id);
    else db.prepare('INSERT INTO wholesale_price_tiers(id,product_id,min_quantity,unit_price_cents,active,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(id,p.id,minQuantity,unitPriceCents,input.active===false?0:1,actor?.userId||null,ts,ts);
    writeAudit(db,{action:'wholesale.price-tier.upsert',entity:'wholesale-price-tier',entityId:id,actor,context:{productId:p.id,minQuantity,unitPriceCents}},now);
    return mapTier(db.prepare('SELECT * FROM wholesale_price_tiers WHERE id=?').get(id));
  }
  function deactivateTier(id,actor={}){
    manager(actor);const row=db.prepare('SELECT * FROM wholesale_price_tiers WHERE id=?').get(text(id));if(!row)throw new Error('Faixa de atacado nao encontrada.');
    db.prepare('UPDATE wholesale_price_tiers SET active=0,updated_at=? WHERE id=?').run(now(),row.id);
    writeAudit(db,{action:'wholesale.price-tier.deactivate',entity:'wholesale-price-tier',entityId:row.id,actor,context:{productId:row.product_id,minQuantity:row.min_quantity}},now);
    return mapTier(db.prepare('SELECT * FROM wholesale_price_tiers WHERE id=?').get(row.id));
  }
  function resolvePrice(productId,quantity,actor={}){
    gate(actor);const p=product(productId);const q=roundQuantity(Number(quantity));
    if(!Number.isFinite(q)||q<=0)throw new Error('Quantidade deve ser maior que zero.');
    const tier=db.prepare('SELECT * FROM wholesale_price_tiers WHERE product_id=? AND active=1 AND min_quantity<=? ORDER BY min_quantity DESC,id LIMIT 1').get(p.id,q);
    const base=Number(p.salePriceCents);const tierPrice=tier?Number(tier.unit_price_cents):base;const effective=Math.min(base,tierPrice);
    const applied=tier&&tierPrice<=base?tier:null;
    return{productId:p.id,productName:p.name,quantity:q,baseUnitPriceCents:base,unitPriceCents:effective,tierId:applied?.id||null,minQuantity:applied?roundQuantity(applied.min_quantity):null,savingsPerUnitCents:Math.max(0,base-effective),totalCents:Math.round(effective*q)};
  }
  function createQuote(input={},actor={}){
    gate(actor);
    if(!Array.isArray(input.items)||!input.items.length)throw new Error('Pedido de atacado deve possuir ao menos um item.');
    const items=input.items.map(item=>{const price=resolvePrice(item.productId,item.quantity,actor);return{productId:price.productId,quantity:price.quantity,unitPriceCents:price.unitPriceCents,pricingSnapshot:{version:1,kind:'WHOLESALE_QUANTITY_TIER',baseUnitPriceCents:price.baseUnitPriceCents,unitPriceCents:price.unitPriceCents,tierId:price.tierId,minQuantity:price.minQuantity,savingsPerUnitCents:price.savingsPerUnitCents,resolvedAt:now()}};});
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
