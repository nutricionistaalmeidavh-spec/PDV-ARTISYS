'use strict';

const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('../inventory/inventory-rules');

function parseJson(value,fallback={}){try{return value?JSON.parse(value):fallback;}catch{return fallback;}}

function createRetailService({db,modules,sales,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules||!sales)throw new TypeError('db, modules and sales are required.');
  const gate=()=>modules.requireEnabled('RETAIL');

  function variantRow(id){
    const row=db.prepare(`SELECT v.*,p.name AS product_name,p.sale_price_cents AS base_price_cents,p.active AS product_active
      FROM product_variants v JOIN products p ON p.id=v.product_id WHERE v.id=?`).get(String(id));
    if(!row||!row.active||!row.product_active)throw new Error('Variacao de varejo nao encontrada ou inativa.');
    return row;
  }
  function mapVariant(row){
    if(!row)return null;
    const balance=db.prepare('SELECT quantity,minimum_stock FROM retail_variant_balances WHERE variant_id=?').get(row.id)||{quantity:0,minimum_stock:0};
    return{variantId:row.id,productId:row.product_id,productName:row.product_name,name:row.name,sku:row.sku,barcode:row.barcode,attributes:parseJson(row.attributes_json,{}),priceDeltaCents:row.price_delta_cents,costCents:row.cost_cents,unitPriceCents:Number(row.base_price_cents)+Number(row.price_delta_cents),quantity:Number(balance.quantity||0),minimumStock:Number(balance.minimum_stock||0)};
  }
  function getVariantStock(variantId){gate();return mapVariant(variantRow(variantId));}

  function setVariantStock(variantId,quantity,actor={}){
    gate();const row=variantRow(variantId);const next=roundQuantity(Number(quantity));if(!Number.isFinite(next)||next<0)throw new Error('Saldo da variacao invalido.');
    return withTransaction(db,()=>{
      const current=Number(db.prepare('SELECT quantity FROM retail_variant_balances WHERE variant_id=?').get(row.id)?.quantity||0);
      const delta=roundQuantity(next-current);const ts=now();
      db.prepare(`INSERT INTO retail_variant_balances(variant_id,quantity,minimum_stock,updated_at) VALUES(?,?,0,?)
        ON CONFLICT(variant_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`).run(row.id,next,ts);
      if(delta!==0)db.prepare(`INSERT INTO retail_variant_movements(id,variant_id,movement_type,quantity_delta,reference_key,created_at) VALUES(?,?,?,?,?,?)`)
        .run(idFactory('retail-move'),row.id,'ADJUSTMENT',delta,`adjustment:${idFactory('ref')}`,ts);
      writeAudit(db,{action:'retail.variant.stock.set',entity:'product_variant',entityId:row.id,actor,context:{from:current,to:next,delta}},now);
      return getVariantStock(row.id);
    });
  }

  function searchVariants(query=''){
    gate();const q=`%${String(query||'').trim().toLowerCase()}%`;
    return db.prepare(`SELECT v.*,p.name AS product_name,p.sale_price_cents AS base_price_cents,p.active AS product_active
      FROM product_variants v JOIN products p ON p.id=v.product_id
      WHERE v.active=1 AND p.active=1 AND (LOWER(v.name) LIKE ? OR LOWER(COALESCE(v.sku,'')) LIKE ? OR LOWER(COALESCE(v.barcode,'')) LIKE ? OR LOWER(p.name) LIKE ?)
      ORDER BY p.name,v.name,v.id LIMIT 100`).all(q,q,q,q).map(mapVariant);
  }

  function addVariantToSale(saleId,input={},actor={}){
    gate();const variant=mapVariant(variantRow(input.variantId));const quantity=roundQuantity(Number(input.quantity??1));if(quantity<=0)throw new Error('Quantidade da variacao invalida.');
    if(quantity>variant.quantity)throw new Error(`Estoque insuficiente para ${variant.productName} - ${variant.name}.`);
    const snapshot={version:1,retailVariant:{id:variant.variantId,name:variant.name,sku:variant.sku,barcode:variant.barcode,attributes:variant.attributes,costCents:variant.costCents}};
    const sale=sales.addItem(String(saleId),{productId:variant.productId,quantity,unitPriceCents:variant.unitPriceCents,configurationSnapshot:snapshot,forceSeparateLine:true});
    writeAudit(db,{action:'retail.variant.sale-item',entity:'sale',entityId:String(saleId),actor,context:{variantId:variant.variantId,quantity}},now);
    return sale;
  }

  function applySaleEvent(event,direction='sale'){
    gate();const factor=direction==='cancel'?1:-1;const items=Array.isArray(event?.payload?.items)?event.payload.items:[];
    return withTransaction(db,()=>{
      let applied=0;
      for(const item of items){
        const variantId=item?.configuration?.retailVariant?.id;if(!variantId)continue;
        const row=variantRow(variantId);const quantity=roundQuantity(Number(item.quantity||0));if(quantity<=0)continue;
        const referenceKey=`${event.eventId}:${String(item.itemId||item.productId||variantId)}:${direction}`;
        if(db.prepare('SELECT 1 FROM retail_variant_movements WHERE reference_key=?').get(referenceKey))continue;
        const current=Number(db.prepare('SELECT quantity FROM retail_variant_balances WHERE variant_id=?').get(row.id)?.quantity||0);const next=roundQuantity(current+(factor*quantity));
        if(next<0)throw new Error(`Estoque insuficiente para variacao ${row.name}.`);
        const ts=event.occurredAt||now();
        db.prepare(`INSERT INTO retail_variant_balances(variant_id,quantity,minimum_stock,updated_at) VALUES(?,?,0,?) ON CONFLICT(variant_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`).run(row.id,next,ts);
        db.prepare(`INSERT INTO retail_variant_movements(id,variant_id,movement_type,quantity_delta,reference_key,created_at) VALUES(?,?,?,?,?,?)`).run(idFactory('retail-move'),row.id,direction==='cancel'?'SALE_REVERSAL':'SALE',factor*quantity,referenceKey,ts);applied+=1;
      }
      return{applied};
    });
  }

  return{setVariantStock,getVariantStock,searchVariants,addVariantToSale,applySaleEvent};
}

module.exports={createRetailService};
