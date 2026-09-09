'use strict';

function parseDate(value, fallback) {
  if (value == null || value === '') return fallback;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) throw new Error('Periodo de relatorio invalido.');
  return new Date(time).toISOString();
}

function csvCell(value) {
  const text = String(value == null ? '' : value);
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function createReportingService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('Database is required.');

  function period(filters = {}, dateColumn = 's.completed_at') {
    const from = parseDate(filters.from, '1970-01-01T00:00:00.000Z');
    const to = parseDate(filters.to, '9999-12-31T23:59:59.999Z');
    return { from, to, clause: `${dateColumn}>=? AND ${dateColumn}<=?` };
  }

  function completedSales(filters = {}) {
    const p = period(filters);
    return db.prepare(`SELECT s.*,u.name AS operator_name,c.name AS customer_name
      FROM sales s
      LEFT JOIN users u ON u.id=s.operator_id
      LEFT JOIN customers c ON c.id=s.customer_id
      WHERE s.status='COMPLETED' AND ${p.clause}
      ORDER BY s.completed_at,s.id`).all(p.from, p.to);
  }

  function completedReturns(filters = {}) {
    const p = period(filters, 'rt.created_at');
    return db.prepare(`SELECT rt.* FROM return_transactions rt
      WHERE rt.status='COMPLETED' AND ${p.clause}
      ORDER BY rt.created_at,rt.id`).all(p.from, p.to);
  }

  function buildSalesSummary(filters = {}) {
    const sales = completedSales(filters);
    const saleIds = new Set(sales.map(s => s.id));
    const grossSalesCents = sales.reduce((sum, sale) => sum + Number(sale.total_cents || 0), 0);
    const returns = completedReturns(filters);
    const returnedCents = returns.reduce((sum, row) => sum + Number(row.total_cents || 0), 0);
    const netSalesCents = grossSalesCents - returnedCents;
    const averageTicketCents = sales.length ? Math.round(grossSalesCents / sales.length) : 0;

    const paymentsByMethod = {};
    const products = new Map();
    const operators = new Map();
    let costCents = 0;

    for (const sale of sales) {
      const payments = db.prepare('SELECT method,amount_cents FROM payments WHERE sale_id=?').all(sale.id);
      for (const payment of payments) paymentsByMethod[payment.method] = (paymentsByMethod[payment.method] || 0) + Number(payment.amount_cents || 0);

      const items = db.prepare(`SELECT si.product_id AS productId,si.product_name AS productName,si.quantity,si.total_cents AS totalCents,p.cost_cents AS costCents
        FROM sale_items si LEFT JOIN products p ON p.id=si.product_id WHERE si.sale_id=?`).all(sale.id);
      for (const item of items) {
        const current = products.get(item.productId) || { productId:item.productId, productName:item.productName, quantity:0, grossCents:0 };
        current.quantity = Math.round((current.quantity + Number(item.quantity || 0)) * 1000) / 1000;
        current.grossCents += Number(item.totalCents || 0);
        products.set(item.productId, current);
        costCents += Math.round(Number(item.costCents || 0) * Number(item.quantity || 0));
      }

      const operator = operators.get(sale.operator_id) || { operatorId:sale.operator_id, operatorName:sale.operator_name || 'Nao identificado', salesCount:0, salesCents:0 };
      operator.salesCount += 1;
      operator.salesCents += Number(sale.total_cents || 0);
      operators.set(sale.operator_id, operator);
    }

    let returnedCostCents = 0;
    for (const ret of returns) {
      const items = db.prepare(`SELECT ri.product_id AS productId,ri.quantity,p.cost_cents AS costCents
        FROM return_items ri LEFT JOIN products p ON p.id=ri.product_id WHERE ri.return_id=?`).all(ret.id);
      for (const item of items) returnedCostCents += Math.round(Number(item.costCents || 0) * Number(item.quantity || 0));
    }

    return {
      from: filters.from || null,
      to: filters.to || null,
      salesCount: sales.length,
      grossSalesCents,
      returnedCents,
      netSalesCents,
      averageTicketCents,
      paymentsByMethod,
      topProducts: [...products.values()].sort((a,b) => b.quantity-a.quantity || b.grossCents-a.grossCents || a.productName.localeCompare(b.productName)),
      estimatedCostCents: costCents - returnedCostCents,
      estimatedMarginCents: netSalesCents - (costCents - returnedCostCents),
      operators: [...operators.values()].sort((a,b) => b.salesCents-a.salesCents || a.operatorName.localeCompare(b.operatorName)),
      saleIds: [...saleIds]
    };
  }

  function buildInventorySummary() {
    const items = db.prepare(`SELECT p.id AS productId,p.sku,p.name,p.unit,p.cost_cents AS costCents,p.sale_price_cents AS salePriceCents,
      p.minimum_stock AS minimumStock,COALESCE(b.quantity,0) AS quantity
      FROM products p LEFT JOIN inventory_balances b ON b.product_id=p.id
      WHERE p.active=1 AND p.track_stock=1 ORDER BY p.name,p.id`).all().map(row => ({
        ...row,
        quantity: Math.round(Number(row.quantity || 0) * 1000) / 1000,
        minimumStock: Math.round(Number(row.minimumStock || 0) * 1000) / 1000,
        lowStock: Number(row.quantity || 0) <= Number(row.minimumStock || 0),
        costValueCents: Math.round(Number(row.costCents || 0) * Number(row.quantity || 0)),
        saleValueCents: Math.round(Number(row.salePriceCents || 0) * Number(row.quantity || 0))
      }));
    return {
      skuCount: items.length,
      lowStockCount: items.filter(item => item.lowStock).length,
      quantityTotal: Math.round(items.reduce((sum,item)=>sum+item.quantity,0)*1000)/1000,
      costValueCents: items.reduce((sum,item)=>sum+item.costValueCents,0),
      saleValueCents: items.reduce((sum,item)=>sum+item.saleValueCents,0),
      items
    };
  }

  function buildCashSummary(filters = {}) {
    const from = parseDate(filters.from, '1970-01-01T00:00:00.000Z');
    const to = parseDate(filters.to, '9999-12-31T23:59:59.999Z');
    const rows = db.prepare(`SELECT id,terminal_id AS terminalId,operator_id AS operatorId,expected_cash_cents AS expectedCashCents,
      counted_cash_cents AS countedCashCents,divergence_cents AS divergenceCents,opened_at AS openedAt,closed_at AS closedAt
      FROM cash_sessions WHERE status='CLOSED' AND closed_at>=? AND closed_at<=? ORDER BY closed_at,id`).all(from,to);
    return {
      closedSessions: rows.length,
      expectedCashCents: rows.reduce((sum,row)=>sum+Number(row.expectedCashCents||0),0),
      countedCashCents: rows.reduce((sum,row)=>sum+Number(row.countedCashCents||0),0),
      divergenceCents: rows.reduce((sum,row)=>sum+Number(row.divergenceCents||0),0),
      divergentSessions: rows.filter(row=>Number(row.divergenceCents||0)!==0).length,
      sessions: rows
    };
  }

  function buildFinanceSummary({ from = null, to = null, asOf = now() } = {}) {
    const clauses = ["fe.status<>'CANCELLED'"];
    const params = [];
    if (from) { clauses.push('fe.due_at>=?'); params.push(String(from)); }
    if (to) { clauses.push('fe.due_at<=?'); params.push(String(to)); }
    const rows = db.prepare(`SELECT fe.*,
      COALESCE((SELECT SUM(fs.amount_cents) FROM financial_settlements fs WHERE fs.entry_id=fe.id AND fs.reversed_at IS NULL),0) AS settled_cents
      FROM financial_entries fe WHERE ${clauses.join(' AND ')} ORDER BY fe.due_at,fe.id`).all(...params);
    const result = { payableTotalCents:0,payableSettledCents:0,payableOpenCents:0,receivableTotalCents:0,receivableSettledCents:0,receivableOpenCents:0,overduePayableCents:0,overdueReceivableCents:0 };
    const asOfMs = Date.parse(String(asOf));
    for (const row of rows) {
      const amount=Number(row.amount_cents||0); const settled=Number(row.settled_cents||0); const open=Math.max(amount-settled,0);
      const prefix=row.kind==='PAYABLE'?'payable':'receivable';
      result[`${prefix}TotalCents`]+=amount; result[`${prefix}SettledCents`]+=settled; result[`${prefix}OpenCents`]+=open;
      if(open>0 && Date.parse(row.due_at)<asOfMs) result[row.kind==='PAYABLE'?'overduePayableCents':'overdueReceivableCents']+=open;
    }
    return result;
  }

  function exportSalesCsv(filters = {}) {
    const rows = completedSales(filters);
    const lines = ['venda;data;operador;status;total_centavos;formas_pagamento;cliente'];
    for (const row of rows) {
      const methods = db.prepare('SELECT method FROM payments WHERE sale_id=? ORDER BY created_at,id').all(row.id).map(p=>p.method).join('+');
      lines.push([
        row.sale_number,row.completed_at,row.operator_name||'',row.status,row.total_cents,methods,row.customer_name||''
      ].map(csvCell).join(';'));
    }
    return `${lines.join('\n')}\n`;
  }

  return { buildSalesSummary, buildInventorySummary, buildCashSummary, buildFinanceSummary, exportSalesCsv };
}

module.exports = { createReportingService, csvCell };
