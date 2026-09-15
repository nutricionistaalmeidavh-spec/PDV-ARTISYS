'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeSaleObservation, formatReceiptObservation } = require('../js/domains/sales/sale-observation');
const { createSaleObservationService } = require('../js/domains/sales/sale-observation-service');

test('observacao interna preserva ate 500 caracteres', () => {
  const source = 'A'.repeat(550);
  assert.equal(sanitizeSaleObservation(source).length, 500);
});

test('observacao impressa fica limitada a 120 caracteres e quatro linhas', () => {
  const source = Array.from({ length: 20 }, (_, index) => `linha-${index + 1}`).join('\n');
  const formatted = formatReceiptObservation(source, 32);
  assert.ok(formatted.length > 0);
  assert.ok(formatted.replace(/\n/g, '').length <= 120);
  assert.ok(formatted.split('\n').length <= 4);
});

test('observacao impressa quebra palavras conforme a largura do cupom', () => {
  const formatted = formatReceiptObservation('Cliente retira amanha as 10h e levar duas caixas separadas.', 32);
  for (const line of formatted.split('\n')) assert.ok(line.length <= 32);
});

test('decorador grava observacao vinculada a venda e preserva flag de impressao', () => {
  const rows = new Map([['s1', { observation:null, print_observation:0 }]]);
  const db = {
    prepare(sql) {
      if (sql.startsWith('UPDATE sales SET observation=')) return { run(note, print, _updatedAt, id) { rows.set(id, { observation:note, print_observation:print }); return { changes:1 }; } };
      if (sql.startsWith('SELECT observation,print_observation')) return { get(id) { return rows.get(id); } };
      throw new Error(`SQL inesperado: ${sql}`);
    }
  };
  const baseSales = {
    completeSale(id) { return { id, saleNumber:'0001', customerId:'c1', status:'COMPLETED' }; },
    getSale(id) { return { id, saleNumber:'0001', customerId:'c1', status:'COMPLETED' }; },
    getSaleDetails(id) { return this.getSale(id); },
    listSales() { return [this.getSale('s1')]; },
    listHistory() { return [this.getSale('s1')]; }
  };
  const sales = createSaleObservationService({ db, baseSales, now:()=> '2026-09-15T12:00:00.000Z' });
  const sale = sales.completeSale('s1', { payments:[{ method:'CASH', amountCents:1000, saleObservation:'Retirar amanha', printObservation:true }] });
  assert.equal(sale.observation, 'Retirar amanha');
  assert.equal(sale.printObservation, true);
  assert.equal(sale.customerId, 'c1');
  assert.equal(sales.getSale('s1').observation, 'Retirar amanha');
});
