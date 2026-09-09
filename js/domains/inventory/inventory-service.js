'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { roundQuantity, applyStockDelta } = require('./inventory-rules');
const VALID_TYPES=new Set(['opening','purchase','sale','sale-cancel','adjustment-in','adjustment-out','inventory-count']);

function mapMovement(row){return row&&{id:row.id,productId:row.product_id,type:row.type,quantityDelta:row.quantity_delta,quantityBefore:row.quantity_before,quantityAfter:row.quantity_after,reason:row.reason,sourceType:row.source_type,sourceId:row.source_id,eventId:row.event_id,createdAt:row.created_at};}

function createInventoryService({db,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db) throw new TypeError('Database is required.');

  function performMove(input={}){
    const productId=String(input.productId||'').trim(); if(!productId) throw new Error('Produto obrigatorio.');
    const type=String(input.type||'').trim(); if(!VALID_TYPES.has(type)) throw new Error('Tipo de movimento de estoque invalido.');
    if(input.eventId){
      const existing=db.prepare('SELECT * FROM inventory_movements WHERE event_id=? AND product_id=? AND type=?').get(String(input.eventId),productId,type);
      if(existing) return mapMovement(existing);
    }
    const product=db.prepare('SELECT id,name,track_stock AS trackStock FROM products WHERE id=?').get(productId);
    if(!product) throw new Error(`Produto ${productId} nao encontrado no catalogo.`);
    const balanceRow=db.prepare('SELECT quantity FROM inventory_balances WHERE product_id=?').get(productId);
    const current=balanceRow?.quantity??0;
    const change=applyStockDelta(current,input.quantityDelta??0);
    const id=String(input.id||idFactory('mov'));
    const createdAt=input.createdAt||now();
    db.prepare(`INSERT INTO inventory_movements
      (id,product_id,type,quantity_delta,quantity_before,quantity_after,reason,source_type,source_id,event_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(id,productId,type,change.delta,change.before,change.after,input.reason||null,input.sourceType||null,input.sourceId||null,input.eventId||null,createdAt);
    db.prepare(`INSERT INTO inventory_balances (product_id,quantity,updated_at) VALUES (?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`)
      .run(productId,change.after,createdAt);
    return mapMovement(db.prepare('SELECT * FROM inventory_movements WHERE id=?').get(id));
  }

  function move(input={},actor=null){
    const result=withTransaction(db,()=>performMove(input));
    writeAudit(db,{action:'inventory.move',entity:'inventory',entityId:result.id,actor,context:{productId:result.productId,type:result.type,delta:result.quantityDelta,sourceId:result.sourceId}},now);
    return result;
  }

  function count(input={},actor=null){
    const current=getBalance(input.productId);
    return move({...input,type:'inventory-count',quantityDelta:roundQuantity(Number(input.countedQuantity)-current)},actor);
  }

  function getBalance(productId){
    return roundQuantity(db.prepare('SELECT quantity FROM inventory_balances WHERE product_id=?').get(String(productId))?.quantity??0);
  }

  function getLowStock(){
    return db.prepare(`SELECT p.id AS productId,p.name,b.quantity,p.minimum_stock AS minimumStock
      FROM products p JOIN inventory_balances b ON b.product_id=p.id
      WHERE p.active=1 AND p.track_stock=1 AND b.quantity<=p.minimum_stock ORDER BY p.name`).all()
      .map(row=>({...row,quantity:roundQuantity(row.quantity),minimumStock:roundQuantity(row.minimumStock)}));
  }

  function listMovements(productId){
    return db.prepare('SELECT * FROM inventory_movements WHERE product_id=? ORDER BY created_at,id').all(String(productId)).map(mapMovement);
  }

  function applySaleItems({eventId,saleId,items,direction,createdAt}){
    const type=direction==='cancel'?'sale-cancel':'sale';
    const sign=direction==='cancel'?1:-1;
    return withTransaction(db,()=>{
      const results=[];
      for(const item of items||[]){
        results.push(performMove({
          id:`${type}-${eventId}-${item.productId}`,
          productId:item.productId,
          type,
          quantityDelta:roundQuantity(sign*Number(item.quantity)),
          reason:direction==='cancel'?'Cancelamento de venda':'Venda concluida',
          sourceType:'sale',sourceId:saleId,eventId,createdAt
        }));
      }
      return results;
    });
  }

  return {move,count,getBalance,getLowStock,listMovements,applySaleItems};
}
module.exports={createInventoryService};
