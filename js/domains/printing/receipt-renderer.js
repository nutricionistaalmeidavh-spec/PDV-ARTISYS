'use strict';

function money(cents) {
  const value = Number(cents || 0);
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(value));
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2,'0')}`;
}

function fit(text, width) {
  const value = String(text == null ? '' : text);
  return value.length <= width ? value : value.slice(0, Math.max(width - 1, 0)) + (width ? '…' : '');
}

function center(text, width) {
  const value = fit(text, width);
  const left = Math.max(Math.floor((width - value.length) / 2), 0);
  return `${' '.repeat(left)}${value}`;
}

function columns(left, right, width) {
  const r = fit(right, width);
  const available = Math.max(width - r.length - 1, 0);
  const l = fit(left, available);
  const gap = Math.max(width - l.length - r.length, 1);
  return fit(`${l}${' '.repeat(gap)}${r}`, width);
}

function renderSaleReceipt({ storeName = 'ArtiSys', documentLabel = 'CUPOM NAO FISCAL', sale, width = 42 } = {}) {
  const w = Number(width);
  if (![32,42,48].includes(w)) throw new Error('Largura de cupom invalida.');
  if (!sale || !sale.saleNumber) throw new Error('Venda invalida para impressao.');
  const lines = [
    center(storeName, w),
    center(documentLabel, w),
    '-'.repeat(w),
    fit(`Venda: ${sale.saleNumber}`, w),
    fit(`Data: ${sale.completedAt || sale.updatedAt || ''}`, w),
    fit(`Operador: ${sale.operatorName || sale.operatorId || ''}`, w)
  ];
  if (sale.customerName || sale.customerId) lines.push(fit(`Cliente: ${sale.customerName || sale.customerId}`, w));
  lines.push('-'.repeat(w));
  for (const item of sale.items || []) {
    lines.push(fit(item.productName || item.sku || 'Item', w));
    lines.push(columns(`${Number(item.quantity || 0)} x ${money(item.unitPriceCents)}`, money(item.totalCents), w));
  }
  lines.push('-'.repeat(w));
  lines.push(columns('Subtotal', money(sale.subtotalCents), w));
  if (Number(sale.discountCents || 0) > 0) lines.push(columns('Desconto', `-${money(sale.discountCents)}`, w));
  lines.push(columns('TOTAL', money(sale.totalCents), w));
  lines.push('-'.repeat(w));
  for (const payment of sale.payments || []) lines.push(columns(payment.method || 'Pagamento', money(payment.amountCents), w));
  if (Number(sale.changeCents || 0) > 0) lines.push(columns('Troco', money(sale.changeCents), w));
  lines.push('-'.repeat(w));
  lines.push(center('Obrigado pela preferencia', w));
  return `${lines.map(line => fit(line, w)).join('\n')}\n`;
}

module.exports = { renderSaleReceipt, money, fit, center, columns };
