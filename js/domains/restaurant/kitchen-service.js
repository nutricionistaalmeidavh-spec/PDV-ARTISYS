'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');

const TICKET_STATUSES = new Set(['NEW','PREPARING','READY','CANCELLED']);

function createKitchenService({ db, now = () => new Date().toISOString(), idFactory = prefix => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');

  function mapStation(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      printerName: row.printer_name,
      printEnabled: Boolean(row.print_enabled),
      active: Boolean(row.active),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function mapTicket(row) {
    if (!row) return null;
    const items = db.prepare(`SELECT id,order_item_id AS orderItemId,product_name AS productName,quantity,note
      FROM kitchen_ticket_items WHERE ticket_id=? ORDER BY id`).all(row.id);
    return {
      id: row.id,
      orderId: row.order_id,
      stationId: row.station_id,
      stationName: row.station_name,
      printerName: row.printer_name,
      printEnabled: Boolean(row.print_enabled),
      tableSessionId: row.table_session_id,
      tableLabel: row.table_label,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items
    };
  }

  function stationSelect(where = '') {
    return `SELECT * FROM kitchen_stations ${where}`;
  }

  function ticketSelect(where = '') {
    return `SELECT kt.*,ks.name AS station_name,ks.printer_name,ks.print_enabled,o.table_session_id,t.label AS table_label
      FROM kitchen_tickets kt
      JOIN kitchen_stations ks ON ks.id=kt.station_id
      JOIN restaurant_orders o ON o.id=kt.order_id
      JOIN table_sessions ts ON ts.id=o.table_session_id
      JOIN restaurant_tables t ON t.id=ts.table_id ${where}`;
  }

  function getStation(id) {
    return mapStation(db.prepare(stationSelect('WHERE id=?')).get(String(id)));
  }

  function upsertStation(input = {}, actor = {}) {
    const id = String(input.id || idFactory('station')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome do setor de producao obrigatorio.');
    const printerName = String(input.printerName || '').trim() || null;
    const printEnabled = input.printEnabled === false ? 0 : 1;
    const active = input.active === false ? 0 : 1;
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0;
    const timestamp = now();
    db.prepare(`INSERT INTO kitchen_stations(id,name,printer_name,print_enabled,active,sort_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,printer_name=excluded.printer_name,print_enabled=excluded.print_enabled,
        active=excluded.active,sort_order=excluded.sort_order,updated_at=excluded.updated_at`)
      .run(id,name,printerName,printEnabled,active,sortOrder,timestamp,timestamp);
    writeAudit(db,{action:'restaurant.kitchen.station.upsert',entity:'kitchen_station',entityId:id,actor,context:{name,printerName,printEnabled:Boolean(printEnabled),active:Boolean(active)}},now);
    return getStation(id);
  }

  function listStations({ includeInactive = false } = {}) {
    return db.prepare(`${stationSelect(includeInactive ? '' : 'WHERE active=1')} ORDER BY sort_order,name,id`).all().map(mapStation);
  }

  function assignProduct(productId, stationId, actor = {}) {
    const product = db.prepare('SELECT id,name FROM products WHERE id=? AND active=1').get(String(productId));
    if (!product) throw new Error('Produto nao encontrado ou inativo.');
    const station = db.prepare('SELECT id,name FROM kitchen_stations WHERE id=? AND active=1').get(String(stationId));
    if (!station) throw new Error('Setor de producao nao encontrado ou inativo.');
    db.prepare(`INSERT INTO product_kitchen_stations(product_id,station_id,updated_at) VALUES(?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET station_id=excluded.station_id,updated_at=excluded.updated_at`)
      .run(product.id,station.id,now());
    writeAudit(db,{action:'restaurant.kitchen.product.assign',entity:'product',entityId:product.id,actor,context:{stationId:station.id,stationName:station.name}},now);
    return { productId:product.id, productName:product.name, stationId:station.id, stationName:station.name };
  }

  function unassignProduct(productId, actor = {}) {
    const result = db.prepare('DELETE FROM product_kitchen_stations WHERE product_id=?').run(String(productId));
    if (result.changes) writeAudit(db,{action:'restaurant.kitchen.product.unassign',entity:'product',entityId:String(productId),actor,context:{}},now);
    return { productId:String(productId), removed:Boolean(result.changes) };
  }

  function listAssignments() {
    return db.prepare(`SELECT p.id AS productId,p.name AS productName,ks.id AS stationId,ks.name AS stationName,ks.printer_name AS printerName,ks.print_enabled AS printEnabled
      FROM product_kitchen_stations pks JOIN products p ON p.id=pks.product_id JOIN kitchen_stations ks ON ks.id=pks.station_id
      ORDER BY p.name,p.id`).all().map(row => ({...row,printEnabled:Boolean(row.printEnabled)}));
  }

  function getTicket(id) {
    return mapTicket(db.prepare(ticketSelect('WHERE kt.id=?')).get(String(id)));
  }

  function routeOrder(orderId) {
    const order = db.prepare("SELECT id,status FROM restaurant_orders WHERE id=? AND status<>'CANCELLED'").get(String(orderId));
    if (!order) throw new Error('Pedido nao encontrado ou cancelado.');
    const routed = db.prepare(`SELECT i.id AS orderItemId,i.product_name AS productName,i.quantity,i.note,ks.id AS stationId
      FROM restaurant_order_items i
      JOIN product_kitchen_stations pks ON pks.product_id=i.product_id
      JOIN kitchen_stations ks ON ks.id=pks.station_id AND ks.active=1
      WHERE i.order_id=? ORDER BY ks.sort_order,ks.name,i.id`).all(order.id);
    if (!routed.length) return [];

    return withTransaction(db, () => {
      const stationIds = [...new Set(routed.map(item => item.stationId))];
      const tickets = [];
      for (const stationId of stationIds) {
        let ticket = db.prepare('SELECT id FROM kitchen_tickets WHERE order_id=? AND station_id=?').get(order.id,stationId);
        if (!ticket) {
          const id = idFactory('kitchen-ticket');
          const timestamp = now();
          db.prepare(`INSERT INTO kitchen_tickets(id,order_id,station_id,status,created_at,updated_at) VALUES(?,?,?,'NEW',?,?)`)
            .run(id,order.id,stationId,timestamp,timestamp);
          const insert = db.prepare(`INSERT INTO kitchen_ticket_items(id,ticket_id,order_item_id,product_name,quantity,note) VALUES(?,?,?,?,?,?)`);
          for (const item of routed.filter(entry => entry.stationId === stationId)) {
            insert.run(idFactory('kitchen-item'),id,item.orderItemId,item.productName,item.quantity,item.note || null);
          }
          ticket = { id };
        }
        tickets.push(getTicket(ticket.id));
      }
      return tickets;
    });
  }

  function listTickets({ status = null, stationId = null, limit = 200 } = {}) {
    const clauses=[]; const params=[];
    if (status) {
      const normalized=String(status).toUpperCase();
      if (!TICKET_STATUSES.has(normalized)) throw new Error('Status de cozinha invalido.');
      clauses.push('kt.status=?'); params.push(normalized);
    }
    if (stationId) { clauses.push('kt.station_id=?'); params.push(String(stationId)); }
    const safeLimit=Math.min(Math.max(Number(limit)||200,1),500);
    params.push(safeLimit);
    return db.prepare(`${ticketSelect(clauses.length ? `WHERE ${clauses.join(' AND ')}` : '')} ORDER BY kt.created_at,kt.id LIMIT ?`).all(...params).map(mapTicket);
  }

  function syncOrderStatus(orderId) {
    const rows=db.prepare('SELECT status,COUNT(*) AS count FROM kitchen_tickets WHERE order_id=? GROUP BY status').all(String(orderId));
    if (!rows.length) return;
    const counts=Object.fromEntries(rows.map(row => [row.status,Number(row.count)]));
    let next='NEW';
    if ((counts.READY||0) === rows.reduce((sum,row)=>sum+Number(row.count),0)) next='READY';
    else if ((counts.PREPARING||0) > 0 || (counts.READY||0) > 0) next='PREPARING';
    db.prepare("UPDATE restaurant_orders SET status=?,updated_at=? WHERE id=? AND status<>'CANCELLED'").run(next,now(),String(orderId));
  }

  function updateTicketStatus(id, status, actor = {}) {
    const normalized=String(status||'').toUpperCase();
    if (!TICKET_STATUSES.has(normalized)) throw new Error('Status de cozinha invalido.');
    return withTransaction(db,()=>{
      const current=getTicket(id);
      if (!current) throw new Error('Ticket de cozinha nao encontrado.');
      db.prepare('UPDATE kitchen_tickets SET status=?,updated_at=? WHERE id=?').run(normalized,now(),String(id));
      syncOrderStatus(current.orderId);
      writeAudit(db,{action:'restaurant.kitchen.ticket.status',entity:'kitchen_ticket',entityId:String(id),actor,context:{from:current.status,to:normalized,orderId:current.orderId}},now);
      return getTicket(id);
    });
  }

  return { upsertStation,getStation,listStations,assignProduct,unassignProduct,listAssignments,routeOrder,getTicket,listTickets,updateTicketStatus,TICKET_STATUSES };
}

module.exports={createKitchenService};
