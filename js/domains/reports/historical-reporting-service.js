'use strict';
const { createReportingService: createBaseReportingService } = require('./reporting-service');

function parseDate(value, fallback) {
  if (value == null || value === '') return fallback;
  const time = Date.parse(String(value));
  if (!Number.isFinite(time)) throw new Error('Periodo de relatorio invalido.');
  return new Date(time).toISOString();
}

function createReportingService({ db, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new TypeError('Database is required.');

  db.exec(`CREATE TRIGGER IF NOT EXISTS trg_sale_cost_snapshot
    AFTER UPDATE OF status ON sales
    WHEN NEW.status='COMPLETED' AND OLD.status<>'COMPLETED'
    BEGIN
      UPDATE sale_items
      SET cost_cents_snapshot=COALESCE(
            CASE WHEN configuration_json IS NOT NULL THEN
              (SELECT pv.cost_cents FROM product_variants pv
               WHERE pv.id=json_extract(sale_items.configuration_json,'$.variantId'))
            END,
            (SELECT p.cost_cents FROM products p WHERE p.id=sale_items.product_id),
            0
          ),
          cost_snapshot_source=CASE
            WHEN configuration_json IS NOT NULL AND EXISTS(
              SELECT 1 FROM product_variants pv
              WHERE pv.id=json_extract(sale_items.configuration_json,'$.variantId')
            ) THEN 'VARIANT'
            ELSE 'PRODUCT'
          END
      WHERE sale_id=NEW.id AND cost_cents_snapshot IS NULL;
    END`);

  const base = createBaseReportingService({ db, now });

  function buildSalesSummary(filters = {}) {
    const result = base.buildSalesSummary(filters);
    const from = parseDate(filters.from, '1970-01-01T00:00:00.000Z');
    const to = parseDate(filters.to, '9999-12-31T23:59:59.999Z');
    const sold = new Map();
    const returned = new Map();
    const uncertain = new Set();

    if (Array.isArray(result.saleIds) && result.saleIds.length) {
      const placeholders = result.saleIds.map(() => '?').join(',');
      const rows = db.prepare(`SELECT si.product_id AS productId,si.quantity,
          si.cost_cents_snapshot AS snapshotCost,p.cost_cents AS currentCost
        FROM sale_items si LEFT JOIN products p ON p.id=si.product_id
        WHERE si.sale_id IN (${placeholders})`).all(...result.saleIds);
      for (const row of rows) {
        const productId = String(row.productId);
        const unitCost = row.snapshotCost == null ? Number(row.currentCost || 0) : Number(row.snapshotCost);
        sold.set(productId, (sold.get(productId) || 0) + Math.round(unitCost * Number(row.quantity || 0)));
        if (row.snapshotCost == null) uncertain.add(productId);
      }
    }

    const returnParams = [from, to];
    let sellerClause = '';
    if (filters.sellerId) {
      sellerClause = ' AND COALESCE(s.seller_id,s.operator_id)=?';
      returnParams.push(String(filters.sellerId));
    }
    const returnRows = db.prepare(`SELECT ri.product_id AS productId,ri.quantity,
        si.cost_cents_snapshot AS snapshotCost,p.cost_cents AS currentCost
      FROM return_items ri
      JOIN return_transactions rt ON rt.id=ri.return_id
      JOIN sales s ON s.id=rt.sale_id
      LEFT JOIN sale_items si ON si.id=ri.sale_item_id
      LEFT JOIN products p ON p.id=ri.product_id
      WHERE rt.status='COMPLETED' AND rt.created_at>=? AND rt.created_at<=?${sellerClause}`)
      .all(...returnParams);
    for (const row of returnRows) {
      const productId = String(row.productId);
      const unitCost = row.snapshotCost == null ? Number(row.currentCost || 0) : Number(row.snapshotCost);
      returned.set(productId, (returned.get(productId) || 0) + Math.round(unitCost * Number(row.quantity || 0)));
      if (row.snapshotCost == null) uncertain.add(productId);
    }

    for (const item of result.productSales || []) {
      const productId = String(item.productId);
      item.estimatedCostCents = (sold.get(productId) || 0) - (returned.get(productId) || 0);
      item.estimatedMarginCents = Number(item.netCents || 0) - item.estimatedCostCents;
      item.costBasis = uncertain.has(productId) ? 'ESTIMATED_CURRENT' : 'HISTORICAL_SNAPSHOT';
    }
    result.estimatedCostCents = (result.productSales || []).reduce((sum, item) => sum + Number(item.estimatedCostCents || 0), 0);
    result.estimatedMarginCents = Number(result.netSalesCents || 0) - result.estimatedCostCents;
    return result;
  }

  return { ...base, buildSalesSummary };
}

module.exports = { createReportingService };
