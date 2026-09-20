'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { roundQuantity } = require('../inventory/inventory-rules');

function createInventoryLogisticsService({db,inventory,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!inventory)throw new TypeError('db and inventory are required.');
  const norm=v=>String(v||'').trim();
  const loc=v=>norm(v)||'MAIN';

  function listLocations({includeInactive=false}={}){return db.prepare(`SELECT id,name,type,active,created_at AS createdAt,updated_at AS updatedAt FROM stock_locations${includeInactive?'':' WHERE active=1'} ORDER BY name,id`).all().map(r=>({...r,active:Boolean(r.active)}));}
  function createLocation(input={},actor=null){const id=norm(input.id||idFactory('loc'));const name=norm(input.name);const type=norm(input.type||'OTHER').toUpperCase();if(!name)throw new Error('Nome do local de estoque obrigatorio.');if(!['STORE','WAREHOUSE','INTERNAL','OTHER'].includes(type))throw new Error('Tipo de local de estoque invalido.');const ts=now();db.prepare('INSERT INTO stock_locations(id,name,type,active,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,name,type,input.active===false?0:1,ts,ts);writeAudit(db,{action:'inventory.location.create',entity:'stock-location',entityId:id,actor,context:{name,type}},now);return listLocations({includeInactive:true}).find(x=>x.id===id);}

  function getAvailability(productId,locationId='MAIN',{excludeSourceType=null,excludeSourceId=null}={}){
    const physicalQuantity=inventory.getBalance(productId,{locationId:loc(locationId)});
    const clauses=["product_id=?","location_id=?","status='ACTIVE'"];const params=[String(productId),loc(locationId)];
    if(excludeSourceType&&excludeSourceId){clauses.push('NOT (source_type=? AND source_id=?)');params.push(String(excludeSourceType),String(excludeSourceId));}
    const row=db.prepare(`SELECT COALESCE(SUM(quantity-consumed_quantity),0) AS q FROM inventory_reservations WHERE ${clauses.join(' AND ')}`).get(...params);
    const reservedQuantity=roundQuantity(Number(row?.q||0));
    return{physicalQuantity:roundQuantity(physicalQuantity),reservedQuantity,availableQuantity:roundQuantity(physicalQuantity-reservedQuantity)};
  }

  function mapReservation(row){return row&&{id:row.id,productId:row.product_id,locationId:row.location_id,quantity:roundQuantity(row.quantity),consumedQuantity:roundQuantity(row.consumed_quantity),remainingQuantity:roundQuantity(row.quantity-row.consumed_quantity),sourceType:row.source_type,sourceId:row.source_id,boundSaleId:row.bound_sale_id,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at};}
  function createReservation(input={},actor=null){
    return withTransaction(db,()=>{
      const productId=norm(input.productId),locationId=loc(input.locationId),sourceType=norm(input.sourceType),sourceId=norm(input.sourceId),quantity=roundQuantity(input.quantity);
      if(!productId||!sourceType||!sourceId||quantity<=0)throw new Error('Reserva de estoque invalida.');
      const existing=db.prepare('SELECT * FROM inventory_reservations WHERE source_type=? AND source_id=? AND product_id=? AND location_id=?').get(sourceType,sourceId,productId,locationId);
      if(existing){if(existing.status==='ACTIVE'&&roundQuantity(existing.quantity-existing.consumed_quantity)===quantity)return mapReservation(existing);throw new Error('Ja existe reserva para esta origem/produto/local.');}
      const availability=getAvailability(productId,locationId);
      if(quantity>availability.availableQuantity)throw new Error(`Estoque disponivel insuficiente. Disponivel: ${availability.availableQuantity}.`);
      const id=norm(input.id||idFactory('reserve'));const ts=now();
      db.prepare(`INSERT INTO inventory_reservations(id,product_id,location_id,quantity,consumed_quantity,source_type,source_id,status,created_at,updated_at) VALUES(?,?,?,?,0,?,?, 'ACTIVE',?,?)`).run(id,productId,locationId,quantity,sourceType,sourceId,ts,ts);
      writeAudit(db,{action:'inventory.reserve',entity:'inventory-reservation',entityId:id,actor,context:{productId,locationId,quantity,sourceType,sourceId}},now);
      return mapReservation(db.prepare('SELECT * FROM inventory_reservations WHERE id=?').get(id));
    });
  }
  function listReservations(filters={}){const clauses=[];const params=[];if(filters.status){clauses.push('status=?');params.push(String(filters.status).toUpperCase());}if(filters.sourceType){clauses.push('source_type=?');params.push(String(filters.sourceType));}if(filters.sourceId){clauses.push('source_id=?');params.push(String(filters.sourceId));}if(filters.locationId){clauses.push('location_id=?');params.push(loc(filters.locationId));}return db.prepare(`SELECT * FROM inventory_reservations${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at,id`).all(...params).map(mapReservation);}
  function releaseSourceReservations(sourceType,sourceId,actor=null){const ts=now();const info=db.prepare("UPDATE inventory_reservations SET status='RELEASED',released_at=?,updated_at=? WHERE source_type=? AND source_id=? AND status='ACTIVE'").run(ts,ts,String(sourceType),String(sourceId));if(info.changes)writeAudit(db,{action:'inventory.reservations.release',entity:'inventory-reservation-source',entityId:`${sourceType}:${sourceId}`,actor,context:{count:info.changes}},now);return info.changes;}
  function bindSourceReservationsToSale(sourceType,sourceId,saleId){const info=db.prepare("UPDATE inventory_reservations SET bound_sale_id=?,updated_at=? WHERE source_type=? AND source_id=? AND status='ACTIVE'").run(String(saleId),now(),String(sourceType),String(sourceId));return info.changes;}
  function consumeSaleReservations(saleId){
    return withTransaction(db,()=>{
      const sale=db.prepare('SELECT stock_location_id AS locationId FROM sales WHERE id=?').get(String(saleId));if(!sale)return 0;
      const items=db.prepare('SELECT product_id AS productId,quantity FROM sale_items WHERE sale_id=?').all(String(saleId));
      let changed=0;
      for(const item of items){let remaining=roundQuantity(item.quantity);const rows=db.prepare("SELECT * FROM inventory_reservations WHERE bound_sale_id=? AND product_id=? AND location_id=? AND status='ACTIVE' ORDER BY created_at,id").all(String(saleId),String(item.productId),loc(sale.locationId));for(const row of rows){if(remaining<=0)break;const available=roundQuantity(row.quantity-row.consumed_quantity);const take=Math.min(available,remaining);const consumed=roundQuantity(row.consumed_quantity+take);const status=consumed>=roundQuantity(row.quantity)?'CONSUMED':'ACTIVE';db.prepare('UPDATE inventory_reservations SET consumed_quantity=?,status=?,consumed_at=?,updated_at=? WHERE id=?').run(consumed,status,status==='CONSUMED'?now():null,now(),row.id);remaining=roundQuantity(remaining-take);changed++;}}
      return changed;
    });
  }
  return{listLocations,createLocation,getAvailability,createReservation,listReservations,releaseSourceReservations,bindSourceReservationsToSale,consumeSaleReservations};
}
module.exports={createInventoryLogisticsService};
