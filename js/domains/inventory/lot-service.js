'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { roundQuantity } = require('./inventory-rules');

const VALID_TYPES = new Set(['purchase','sale','sale-cancel','return','return-cancel','adjustment-in','adjustment-out']);

function parseOptionalDate(value, field) {
  if (value == null || value === '') return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw new Error(`${field} invalido.`);
  return new Date(timestamp).toISOString();
}

function createLotService({ db, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');

  function mapLot(row) {
    if (!row) return null;
    return {
      id:row.id, productId:row.product_id, supplierId:row.supplier_id, lotCode:row.lot_code,
      manufacturedAt:row.manufactured_at, expiresAt:row.expires_at, receivedAt:row.received_at,
      unitCostCents:row.unit_cost_cents, active:Boolean(row.active), quantity:roundQuantity(row.quantity ?? 0),
      createdAt:row.created_at, updatedAt:row.updated_at
    };
  }

  function getLot(id) {
    return mapLot(db.prepare(`SELECT l.*,COALESCE(b.quantity,0) AS quantity FROM inventory_lots l
      LEFT JOIN inventory_lot_balances b ON b.lot_id=l.id WHERE l.id=?`).get(String(id)));
  }

  function listLots(filters = {}) {
    const clauses=[]; const params=[];
    if (filters.productId) { clauses.push('l.product_id=?'); params.push(String(filters.productId)); }
    if (filters.supplierId) { clauses.push('l.supplier_id=?'); params.push(String(filters.supplierId)); }
    if (filters.active !== undefined) { clauses.push('l.active=?'); params.push(filters.active ? 1 : 0); }
    if (filters.available === true) clauses.push('COALESCE(b.quantity,0)>0');
    if (filters.expiringBefore) { clauses.push('l.expires_at IS NOT NULL AND l.expires_at<=?'); params.push(String(filters.expiringBefore)); }
    return db.prepare(`SELECT l.*,COALESCE(b.quantity,0) AS quantity FROM inventory_lots l
      LEFT JOIN inventory_lot_balances b ON b.lot_id=l.id${clauses.length?` WHERE ${clauses.join(' AND ')}`:''}
      ORDER BY l.product_id,CASE WHEN l.expires_at IS NULL THEN 1 ELSE 0 END,l.expires_at,l.received_at,l.id`).all(...params).map(mapLot);
  }

  function createLot(input = {}, actor = null) {
    const productId=String(input.productId||'').trim();
    const lotCode=String(input.lotCode||'').trim();
    if (!productId || !lotCode) throw new Error('Produto e codigo do lote sao obrigatorios.');
    if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(productId)) throw new Error('Produto do lote nao encontrado.');
    const supplierId=String(input.supplierId||'').trim()||null;
    if (supplierId && !db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(supplierId)) throw new Error('Fornecedor do lote nao encontrado.');
    const existing=db.prepare('SELECT id FROM inventory_lots WHERE product_id=? AND lot_code=?').get(productId,lotCode);
    if (existing) return getLot(existing.id);
    const id=String(input.id||idFactory('lot'));
    const timestamp=now();
    const receivedAt=parseOptionalDate(input.receivedAt,'Data de recebimento')||timestamp;
    const manufacturedAt=parseOptionalDate(input.manufacturedAt,'Data de fabricacao');
    const expiresAt=parseOptionalDate(input.expiresAt,'Data de validade');
    if (manufacturedAt && expiresAt && Date.parse(manufacturedAt)>Date.parse(expiresAt)) throw new Error('Validade do lote nao pode ser anterior a fabricacao.');
    const unitCostCents=input.unitCostCents==null?null:Number(input.unitCostCents);
    if (unitCostCents!=null && (!Number.isSafeInteger(unitCostCents)||unitCostCents<0)) throw new Error('Custo do lote invalido.');
    db.prepare(`INSERT INTO inventory_lots(id,product_id,supplier_id,lot_code,manufactured_at,expires_at,received_at,unit_cost_cents,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,productId,supplierId,lotCode,manufacturedAt,expiresAt,receivedAt,unitCostCents,input.active===false?0:1,timestamp,timestamp);
    db.prepare('INSERT INTO inventory_lot_balances(lot_id,quantity,updated_at) VALUES(?,0,?)').run(id,timestamp);
    writeAudit(db,{action:'inventory.lot.create',entity:'inventory-lot',entityId:id,actor,context:{productId,lotCode,supplierId,expiresAt}},now);
    return getLot(id);
  }

  function move(input = {}, actor = null) {
    const lotId=String(input.lotId||'').trim();
    const lot=getLot(lotId); if(!lot) throw new Error('Lote nao encontrado.');
    const productId=String(input.productId||lot.productId).trim();
    if(productId!==lot.productId) throw new Error('Produto divergente do lote informado.');
    const type=String(input.type||'').trim(); if(!VALID_TYPES.has(type)) throw new Error('Tipo de movimento de lote invalido.');
    const eventId=String(input.eventId||'').trim()||null;
    if(eventId){const existing=db.prepare('SELECT id FROM inventory_lot_movements WHERE event_id=? AND lot_id=? AND type=?').get(eventId,lotId,type);if(existing)return getLot(lotId);}
    const delta=roundQuantity(Number(input.quantityDelta||0)); if(!delta) throw new Error('Quantidade do movimento de lote deve ser diferente de zero.');
    return withTransaction(db,()=>{
      const before=roundQuantity(db.prepare('SELECT quantity FROM inventory_lot_balances WHERE lot_id=?').get(lotId)?.quantity??0);
      const after=roundQuantity(before+delta); if(after<0) throw new Error(`Estoque insuficiente no lote ${lot.lotCode}.`);
      const timestamp=input.createdAt||now();
      const id=String(input.id||idFactory('lotmov'));
      db.prepare(`INSERT INTO inventory_lot_movements(id,lot_id,product_id,type,quantity_delta,quantity_before,quantity_after,source_type,source_id,event_id,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,lotId,productId,type,delta,before,after,input.sourceType||null,input.sourceId||null,eventId,timestamp);
      db.prepare(`INSERT INTO inventory_lot_balances(lot_id,quantity,updated_at) VALUES(?,?,?)
        ON CONFLICT(lot_id) DO UPDATE SET quantity=excluded.quantity,updated_at=excluded.updated_at`).run(lotId,after,timestamp);
      writeAudit(db,{action:'inventory.lot.move',entity:'inventory-lot',entityId:lotId,actor,context:{productId,type,delta,sourceType:input.sourceType||null,sourceId:input.sourceId||null}},now);
      return getLot(lotId);
    });
  }

  function receivePurchase({ productId, supplierId=null, lot=null, lotId=null, quantity, unitCostCents=null, sourceId, eventId=null, actor=null } = {}) {
    let resolved = lotId ? getLot(lotId) : null;
    if (!resolved) {
      if (!lot?.lotCode) throw new Error('Produto com controle de lote exige codigo do lote no recebimento.');
      resolved=createLot({ ...lot, productId, supplierId, unitCostCents:lot.unitCostCents??unitCostCents },actor);
    }
    move({lotId:resolved.id,productId,type:'purchase',quantityDelta:quantity,sourceType:'purchase-receipt',sourceId,eventId:eventId||`purchase:${sourceId}:${resolved.id}`},actor);
    return getLot(resolved.id);
  }

  function availableRows(productId, at, allowExpired) {
    const atMs=Date.parse(at||now());
    const rows=listLots({productId,active:true,available:true});
    return rows.filter(row=>allowExpired||!row.expiresAt||Date.parse(row.expiresAt)>=atMs)
      .sort((a,b)=>{
        const ae=a.expiresAt?Date.parse(a.expiresAt):Number.POSITIVE_INFINITY;
        const be=b.expiresAt?Date.parse(b.expiresAt):Number.POSITIVE_INFINITY;
        return ae-be || Date.parse(a.receivedAt)-Date.parse(b.receivedAt) || a.id.localeCompare(b.id);
      });
  }

  function allocateFefo(input = {}, actor = null) {
    const productId=String(input.productId||'').trim(); const quantity=roundQuantity(Number(input.quantity||0));
    if(!productId||quantity<=0) throw new Error('Produto e quantidade positiva sao obrigatorios para alocacao de lote.');
    const at=parseOptionalDate(input.at,'Data de alocacao')||now();
    const allowExpired=Boolean(input.allowExpired);
    if(allowExpired){
      if(!['manager','admin'].includes(String(actor?.role||''))) throw new Error('Autorizacao de gerente necessaria para usar lote vencido.');
      const reason=String(input.overrideReason||'').trim(); if(!reason) throw new Error('Informe o motivo para uso de lote vencido.');
    }
    const candidates=availableRows(productId,at,allowExpired);
    const total=roundQuantity(candidates.reduce((sum,row)=>sum+row.quantity,0));
    if(total<quantity) throw new Error(allowExpired?'Estoque de lote insuficiente.':'Estoque de lote valido insuficiente; ha lote vencido ou sem saldo disponivel.');
    return withTransaction(db,()=>{
      let remaining=quantity;const allocated=[];let index=0;
      for(const row of candidates){
        if(remaining<=0)break;
        const take=roundQuantity(Math.min(row.quantity,remaining)); if(take<=0)continue;
        const expired=Boolean(row.expiresAt&&Date.parse(row.expiresAt)<Date.parse(at));
        const eventId=input.sourceId?`${input.sourceType||'allocation'}:${input.sourceId}:${row.id}:${index++}`:null;
        move({lotId:row.id,productId,type:'sale',quantityDelta:-take,sourceType:input.sourceType||'sale',sourceId:input.sourceId||null,eventId,createdAt:at},actor);
        allocated.push({lotId:row.id,lotCode:row.lotCode,quantity:take,expiresAt:row.expiresAt,expired});
        remaining=roundQuantity(remaining-take);
      }
      if(allocated.some(item=>item.expired)) writeAudit(db,{action:'inventory.lot.expired-override',entity:'product',entityId:productId,actor,context:{quantity,reason:String(input.overrideReason||'').trim(),sourceType:input.sourceType||null,sourceId:input.sourceId||null}},now);
      return allocated;
    });
  }

  function allocateSaleItem({saleId,saleItemId,productId,quantity,at=null,allowExpired=false,overrideReason=''}={},actor=null){
    const tracked=Boolean(db.prepare('SELECT track_lots AS trackLots FROM products WHERE id=?').get(String(productId))?.trackLots);
    if(!tracked)return[];
    const existing=db.prepare(`SELECT a.lot_id AS lotId,l.lot_code AS lotCode,a.quantity,l.expires_at AS expiresAt FROM sale_item_lot_allocations a
      JOIN inventory_lots l ON l.id=a.lot_id WHERE a.sale_item_id=? ORDER BY a.created_at,a.id`).all(String(saleItemId));
    if(existing.length)return existing;
    return withTransaction(db,()=>{
      const allocations=allocateFefo({productId,quantity,at:at||now(),sourceType:'sale',sourceId:saleId,allowExpired,overrideReason},actor);
      const timestamp=now();
      for(const allocation of allocations) db.prepare(`INSERT INTO sale_item_lot_allocations(id,sale_id,sale_item_id,lot_id,quantity,created_at) VALUES(?,?,?,?,?,?)`)
        .run(idFactory('sale-lot'),String(saleId),String(saleItemId),allocation.lotId,allocation.quantity,timestamp);
      const first=allocations[0]; if(first) db.prepare('UPDATE sale_items SET lot_id=?,lot_code_snapshot=? WHERE id=?').run(first.lotId,first.lotCode,String(saleItemId));
      return allocations;
    });
  }

  function restoreSale(saleId, actor=null){
    const allocations=db.prepare(`SELECT a.*,l.product_id AS productId FROM sale_item_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.sale_id=?`).all(String(saleId));
    return withTransaction(db,()=>allocations.map(row=>move({lotId:row.lot_id,productId:row.productId,type:'sale-cancel',quantityDelta:row.quantity,sourceType:'sale',sourceId:String(saleId),eventId:`sale-cancel:${saleId}:${row.id}`},actor)));
  }

  function restoreReturnItem({returnId,returnItemId,saleItemId,quantity}={},actor=null){
    let remaining=roundQuantity(Number(quantity||0)); if(remaining<=0)return[];
    const source=db.prepare(`SELECT a.*,l.product_id AS productId,l.lot_code AS lotCode,
      COALESCE((SELECT SUM(rla.quantity) FROM return_item_lot_allocations rla JOIN return_transactions rt ON rt.id=rla.return_id WHERE rla.sale_item_id=a.sale_item_id AND rla.lot_id=a.lot_id AND rt.status='COMPLETED'),0) AS returnedQty
      FROM sale_item_lot_allocations a JOIN inventory_lots l ON l.id=a.lot_id WHERE a.sale_item_id=? ORDER BY a.created_at,a.id`).all(String(saleItemId));
    return withTransaction(db,()=>{
      const restored=[];const timestamp=now();
      for(const row of source){
        const available=roundQuantity(Number(row.quantity)-Number(row.returnedQty||0)); if(available<=0)continue;
        const take=roundQuantity(Math.min(available,remaining)); if(take<=0)continue;
        move({lotId:row.lot_id,productId:row.productId,type:'return',quantityDelta:take,sourceType:'return',sourceId:returnId,eventId:`return:${returnId}:${returnItemId}:${row.lot_id}`},actor);
        db.prepare(`INSERT INTO return_item_lot_allocations(id,return_id,return_item_id,sale_item_id,lot_id,quantity,created_at) VALUES(?,?,?,?,?,?,?)`)
          .run(idFactory('return-lot'),String(returnId),String(returnItemId),String(saleItemId),row.lot_id,take,timestamp);
        restored.push({lotId:row.lot_id,lotCode:row.lotCode,quantity:take}); remaining=roundQuantity(remaining-take); if(remaining<=0)break;
      }
      if(remaining>0) throw new Error('Nao foi possivel identificar lote original suficiente para a devolucao.');
      return restored;
    });
  }

  function cancelReturn(returnId, actor=null){
    const rows=db.prepare(`SELECT rla.*,l.product_id AS productId FROM return_item_lot_allocations rla JOIN inventory_lots l ON l.id=rla.lot_id WHERE rla.return_id=?`).all(String(returnId));
    return withTransaction(db,()=>rows.map(row=>move({lotId:row.lot_id,productId:row.productId,type:'return-cancel',quantityDelta:-Number(row.quantity),sourceType:'return',sourceId:String(returnId),eventId:`return-cancel:${returnId}:${row.id}`},actor)));
  }

  return {createLot,getLot,listLots,move,receivePurchase,allocateFefo,allocateSaleItem,restoreSale,restoreReturnItem,cancelReturn};
}

module.exports={createLotService};
