'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { resolvePayment, normalizeMethod } = require('../payments/payment-rules');
const { calculateSaleTotals } = require('./pricing');
const { roundQuantity } = require('../inventory/inventory-rules');
const VALID_PAYMENT_METHODS = new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT','OTHER']);

function createSaleService({ db, outbox, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}` } = {}) {
  if (!db || !outbox) throw new TypeError('Database and outbox are required.');

  function getSaleRow(id) { return db.prepare('SELECT * FROM sales WHERE id=?').get(String(id)); }
  function getItems(id) { return db.prepare(`SELECT id,product_id AS productId,product_name AS productName,sku,quantity,unit_price_cents AS unitPriceCents,total_cents AS totalCents FROM sale_items WHERE sale_id=? ORDER BY created_at,id`).all(String(id)); }
  function getPayments(id) { return db.prepare(`SELECT id,method,amount_cents AS amountCents,metadata_json AS metadataJson,created_at AS createdAt FROM payments WHERE sale_id=? ORDER BY created_at,id`).all(String(id)).map(p => ({ ...p, metadata: p.metadataJson ? JSON.parse(p.metadataJson) : null })); }
  function mapSale(row) { if (!row) return null; return { id: row.id, saleNumber: row.sale_number, terminalId: row.terminal_id, operatorId: row.operator_id, customerId: row.customer_id, status: row.status, subtotalCents: row.subtotal_cents, discountCents: row.discount_cents, totalCents: row.total_cents, changeCents: row.change_cents, cancelReason: row.cancel_reason, openedAt: row.opened_at, completedAt: row.completed_at, cancelledAt: row.cancelled_at, updatedAt: row.updated_at, items: getItems(row.id), payments: getPayments(row.id) }; }
  function getSale(id) { return mapSale(getSaleRow(id)); }
  function requireSale(id, states) { const row = getSaleRow(id); if (!row) throw new Error('Venda nao encontrada.'); if (states && !states.includes(row.status)) throw new Error(`Venda nao esta aberta para esta operacao (status ${row.status}).`); return row; }

  function listSales({ status = null, limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const normalizedStatus = status ? String(status).trim().toUpperCase() : null;
    if (normalizedStatus && !['OPEN','SUSPENDED','COMPLETED','CANCELLED'].includes(normalizedStatus)) throw new Error('Status de venda invalido.');
    const rows = normalizedStatus
      ? db.prepare('SELECT * FROM sales WHERE status=? ORDER BY opened_at DESC,id DESC LIMIT ?').all(normalizedStatus, safeLimit)
      : db.prepare('SELECT * FROM sales ORDER BY opened_at DESC,id DESC LIMIT ?').all(safeLimit);
    return rows.map(mapSale);
  }

  function recalculate(saleId, discountOverride) {
    const sale = requireSale(saleId, ['OPEN','SUSPENDED']);
    const items = getItems(saleId);
    const totals = calculateSaleTotals({ items, discountCents: discountOverride === undefined ? sale.discount_cents : discountOverride });
    db.prepare('UPDATE sales SET subtotal_cents=?,discount_cents=?,total_cents=?,updated_at=? WHERE id=?').run(totals.subtotalCents, totals.discountCents, totals.totalCents, now(), saleId);
    return totals;
  }

  function openSale(input = {}, actor = null) {
    const id = String(input.id || idFactory('sale')); const terminalId = String(input.terminalId || '').trim(); const operatorId = String(input.operatorId || '').trim();
    if (!terminalId || !operatorId) throw new Error('Terminal e operador sao obrigatorios.');
    const timestamp = now(); const saleNumber = String(input.saleNumber || id).trim();
    db.prepare(`INSERT INTO sales (id,sale_number,terminal_id,operator_id,customer_id,status,opened_at,updated_at) VALUES (?,?,?,?,?,'OPEN',?,?)`)
      .run(id, saleNumber, terminalId, operatorId, input.customerId || null, timestamp, timestamp);
    writeAudit(db, { action: 'sale.open', entity: 'sale', entityId: id, actor: actor || { userId: operatorId, role: 'cashier', terminalId }, context: { saleNumber, terminalId } }, now);
    return getSale(id);
  }

  function setCustomer(saleId, customerId) {
    return withTransaction(db, () => {
      requireSale(saleId, ['OPEN','SUSPENDED']);
      const normalized = customerId == null || String(customerId).trim() === '' ? null : String(customerId).trim();
      if (normalized) {
        const customer = db.prepare('SELECT id FROM customers WHERE id=? AND active=1').get(normalized);
        if (!customer) throw new Error('Cliente nao encontrado ou inativo.');
      }
      db.prepare('UPDATE sales SET customer_id=?,updated_at=? WHERE id=?').run(normalized, now(), saleId);
      return getSale(saleId);
    });
  }

  function addItem(saleId, input = {}) {
    return withTransaction(db, () => {
      requireSale(saleId, ['OPEN']); const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(input.productId));
      if (!product) throw new Error('Produto nao encontrado ou inativo.');
      const quantity = roundQuantity(input.quantity ?? 1); if (quantity <= 0) throw new Error('Quantidade deve ser maior que zero.');
      const existing = db.prepare('SELECT * FROM sale_items WHERE sale_id=? AND product_id=?').get(saleId, product.id); const timestamp = now();
      if (existing) { const next = roundQuantity(existing.quantity + quantity); db.prepare('UPDATE sale_items SET quantity=?,total_cents=?,updated_at=? WHERE id=?').run(next, Math.round(existing.unit_price_cents * next), timestamp, existing.id); }
      else { db.prepare(`INSERT INTO sale_items (id,sale_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(idFactory('item'), saleId, product.id, product.name, product.sku, quantity, product.sale_price_cents, Math.round(product.sale_price_cents * quantity), timestamp, timestamp); }
      recalculate(saleId); return getSale(saleId);
    });
  }

  function updateItemQuantity(saleId, productId, quantity) { return withTransaction(db, () => { requireSale(saleId, ['OPEN']); const q = roundQuantity(quantity); if (q <= 0) throw new Error('Quantidade deve ser maior que zero.'); const row = db.prepare('SELECT * FROM sale_items WHERE sale_id=? AND product_id=?').get(saleId, productId); if (!row) throw new Error('Item nao encontrado na venda.'); db.prepare('UPDATE sale_items SET quantity=?,total_cents=?,updated_at=? WHERE id=?').run(q, Math.round(row.unit_price_cents * q), now(), row.id); recalculate(saleId); return getSale(saleId); }); }
  function removeItem(saleId, productId) { return withTransaction(db, () => { requireSale(saleId, ['OPEN']); db.prepare('DELETE FROM sale_items WHERE sale_id=? AND product_id=?').run(saleId, productId); recalculate(saleId); return getSale(saleId); }); }
  function applyDiscount(saleId, { discountCents = 0 } = {}) { return withTransaction(db, () => { requireSale(saleId, ['OPEN']); recalculate(saleId, discountCents); return getSale(saleId); }); }
  function suspendSale(saleId) { requireSale(saleId, ['OPEN']); db.prepare("UPDATE sales SET status='SUSPENDED',updated_at=? WHERE id=?").run(now(), saleId); return getSale(saleId); }
  function resumeSale(saleId) { requireSale(saleId, ['SUSPENDED']); db.prepare("UPDATE sales SET status='OPEN',updated_at=? WHERE id=?").run(now(), saleId); return getSale(saleId); }

  function completeSale(saleId, { payments = [], actor = {}, mutationId = null } = {}) {
    return withTransaction(db, () => {
      const sale = requireSale(saleId, ['OPEN']); const items = getItems(saleId); if (!items.length) throw new Error('Adicione pelo menos um item antes de finalizar a venda.');
      const totals = recalculate(saleId);
      const aggregate = items.reduce((map, item) => map.set(item.productId, roundQuantity((map.get(item.productId) || 0) + item.quantity)), new Map());
      for (const [productId, quantity] of aggregate) { const product = db.prepare('SELECT track_stock AS trackStock,name FROM products WHERE id=?').get(productId); if (product?.trackStock) { const stock = db.prepare('SELECT quantity FROM inventory_balances WHERE product_id=?').get(productId)?.quantity ?? 0; if (quantity > stock) throw new Error(`Estoque insuficiente para ${product.name}.`); } }
      const customer = sale.customer_id ? db.prepare('SELECT * FROM customers WHERE id=?').get(sale.customer_id) : null;
      const normalizedPayments = payments.map(p => { const method = normalizeMethod(p.method); if (!VALID_PAYMENT_METHODS.has(method)) throw new Error(`Forma de pagamento invalida: ${method}.`); return { method, amountCents: p.amountCents, metadata: p.metadata || null }; });
      const paymentSummary = resolvePayment({ totalCents: totals.totalCents, payments: normalizedPayments, creditMethods: ['STORE_CREDIT'], changeMethods: ['CASH'], availableCreditCents: customer ? Math.max(customer.credit_limit_cents - customer.credit_used_cents, 0) : 0, customerName: customer?.name });
      if (paymentSummary.status === 'insufficient') throw new Error(`Pagamento insuficiente. Faltam ${paymentSummary.remainingTotalCents} centavos.`);
      const timestamp = now(); db.prepare('DELETE FROM payments WHERE sale_id=?').run(saleId);
      const insert = db.prepare('INSERT INTO payments (id,sale_id,method,amount_cents,metadata_json,created_at) VALUES (?,?,?,?,?,?)');
      for (const payment of normalizedPayments) insert.run(idFactory('pay'), saleId, payment.method, payment.amountCents, payment.metadata ? JSON.stringify(payment.metadata) : null, timestamp);
      if (customer && paymentSummary.creditTotalCents) db.prepare('UPDATE customers SET credit_used_cents=credit_used_cents+?,updated_at=? WHERE id=?').run(paymentSummary.creditTotalCents, timestamp, customer.id);
      db.prepare("UPDATE sales SET status='COMPLETED',subtotal_cents=?,discount_cents=?,total_cents=?,change_cents=?,completed_at=?,updated_at=? WHERE id=? AND status='OPEN'").run(totals.subtotalCents, totals.discountCents, totals.totalCents, paymentSummary.changeDueCents, timestamp, timestamp, saleId);
      const event = { eventId: idFactory('evt'), type: 'sale.completed', aggregate: 'sale', aggregateId: saleId, occurredAt: timestamp, actor: actor && typeof actor === 'object' ? actor : {}, source: 'server', mutationId, payload: { saleNumber: sale.sale_number, terminalId: sale.terminal_id, totalCents: totals.totalCents, changeCents: paymentSummary.changeDueCents, items: items.map(i => ({ productId: i.productId, quantity: i.quantity })), payments: normalizedPayments.map(p => ({ method: p.method, amountCents: p.amountCents })) } };
      outbox.insert(event); writeAudit(db, { action: 'sale.complete', entity: 'sale', entityId: saleId, actor, context: { totalCents: totals.totalCents, eventId: event.eventId } }, now); return getSale(saleId);
    });
  }

  function cancelSale(saleId, { reason = '', actor = {}, mutationId = null } = {}) {
    const text = String(reason).trim(); if (!text) throw new Error('Informe o motivo do cancelamento.');
    const current = requireSale(saleId);
    if (['OPEN','SUSPENDED'].includes(current.status)) {
      return withTransaction(db, () => {
        const timestamp = now();
        db.prepare("UPDATE sales SET status='CANCELLED',cancel_reason=?,cancelled_at=?,updated_at=? WHERE id=? AND status IN ('OPEN','SUSPENDED')").run(text, timestamp, timestamp, saleId);
        writeAudit(db, { action: 'sale.void', entity: 'sale', entityId: saleId, actor, context: { reason: text } }, now);
        return getSale(saleId);
      });
    }
    if (current.status !== 'COMPLETED') throw new Error(`Venda nao pode ser cancelada no status ${current.status}.`);
    if (!['manager','admin'].includes(String(actor.role || ''))) throw new Error('Autorizacao de gerente necessaria.');
    return withTransaction(db, () => {
      const sale = requireSale(saleId, ['COMPLETED']); const items = getItems(saleId); const payments = getPayments(saleId); const timestamp = now();
      const creditTotal = payments.filter(p => p.method === 'STORE_CREDIT').reduce((sum, p) => sum + p.amountCents, 0);
      if (sale.customer_id && creditTotal) db.prepare('UPDATE customers SET credit_used_cents=MAX(credit_used_cents-?,0),updated_at=? WHERE id=?').run(creditTotal, timestamp, sale.customer_id);
      db.prepare("UPDATE sales SET status='CANCELLED',cancel_reason=?,cancelled_at=?,updated_at=? WHERE id=? AND status='COMPLETED'").run(text, timestamp, timestamp, saleId);
      const event = { eventId: idFactory('evt'), type: 'sale.cancelled', aggregate: 'sale', aggregateId: saleId, occurredAt: timestamp, actor, source: 'server', mutationId, payload: { saleNumber: sale.sale_number, terminalId: sale.terminal_id, reason: text, items: items.map(i => ({ productId: i.productId, quantity: i.quantity })), payments: payments.map(p => ({ method: p.method, amountCents: p.amountCents })) } };
      outbox.insert(event); writeAudit(db, { action: 'sale.cancel', entity: 'sale', entityId: saleId, actor, context: { reason: text, eventId: event.eventId } }, now); return getSale(saleId);
    });
  }

  return { openSale, setCustomer, addItem, updateItemQuantity, removeItem, applyDiscount, suspendSale, resumeSale, completeSale, cancelSale, getSale, listSales };
}
module.exports = { createSaleService };
