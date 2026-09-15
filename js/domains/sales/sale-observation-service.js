'use strict';

const { sanitizeSaleObservation } = require('./sale-observation');

function createSaleObservationService({ db, baseSales, now = () => new Date().toISOString() } = {}) {
  if (!db || !baseSales) throw new TypeError('db and baseSales are required.');

  function readObservation(saleId) {
    return db.prepare('SELECT observation,print_observation FROM sales WHERE id=?').get(String(saleId)) || null;
  }

  function enrich(sale) {
    if (!sale?.id) return sale;
    const row = readObservation(sale.id);
    return {
      ...sale,
      observation: row?.observation || '',
      printObservation: Boolean(row?.print_observation)
    };
  }

  function observationFromInput(input = {}) {
    const first = Array.isArray(input.payments) ? input.payments[0] : null;
    const hasTransportFields = Boolean(first && (
      Object.prototype.hasOwnProperty.call(first, 'saleObservation') ||
      Object.prototype.hasOwnProperty.call(first, 'printObservation')
    ));
    if (!hasTransportFields) return null;
    const observation = sanitizeSaleObservation(first.saleObservation);
    return { observation, printObservation: Boolean(first.printObservation && observation.trim()) };
  }

  function cleanInput(input = {}) {
    const payments = Array.isArray(input.payments)
      ? input.payments.map(payment => {
          const { saleObservation: _saleObservation, printObservation: _printObservation, ...safe } = payment || {};
          return safe;
        })
      : [];
    return { ...input, payments };
  }

  function persist(saleId, values) {
    if (!values) return;
    db.prepare('UPDATE sales SET observation=?,print_observation=?,updated_at=? WHERE id=?')
      .run(values.observation || null, values.printObservation ? 1 : 0, now(), String(saleId));
  }

  function completeSale(id, input = {}) {
    const values = observationFromInput(input);
    persist(id, values);
    baseSales.completeSale(id, cleanInput(input));
    return enrich(baseSales.getSale(id));
  }

  function getSale(id) { return enrich(baseSales.getSale(id)); }
  function getSaleDetails(id) { return enrich(baseSales.getSaleDetails(id)); }
  function listSales(filters = {}) { return baseSales.listSales(filters).map(enrich); }
  function listHistory(filters = {}) { return baseSales.listHistory(filters).map(enrich); }

  return { ...baseSales, completeSale, getSale, getSaleDetails, listSales, listHistory };
}

module.exports = { createSaleObservationService };
