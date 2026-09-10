'use strict';

const {
  createReceiptDocument,
  renderPlainText,
  money,
  fit,
  center,
  columns
} = require('@artisys/printing');

function renderSaleReceipt({ storeName = 'ArtiSys', documentLabel = 'CUPOM NAO FISCAL', sale, width = 42 } = {}) {
  const w = Number(width);
  if (![32,42,48].includes(w)) throw new Error('Largura de cupom invalida.');
  if (!sale || !sale.saleNumber) throw new Error('Venda invalida para impressao.');

  const metadata = [
    ['Venda', sale.saleNumber],
    ['Data', sale.completedAt || sale.updatedAt || ''],
    ['Operador', sale.operatorName || sale.operatorId || '']
  ];
  if (sale.customerName || sale.customerId) metadata.push(['Cliente', sale.customerName || sale.customerId]);

  const totals = [['Subtotal', Number(sale.subtotalCents || 0)]];
  if (Number(sale.discountCents || 0) > 0) totals.push(['Desconto', -Number(sale.discountCents)]);
  totals.push(['TOTAL', Number(sale.totalCents || 0)]);

  const document = createReceiptDocument({
    width:w,
    title:storeName,
    documentLabel,
    metadata,
    items:(sale.items || []).map(item => ({
      name:item.productName || item.sku || 'Item',
      quantity:Number(item.quantity || 0),
      unitPriceCents:Number(item.unitPriceCents || 0),
      totalCents:Number(item.totalCents || 0)
    })),
    totals,
    payments:(sale.payments || []).map(payment => [payment.method || 'Pagamento', Number(payment.amountCents || 0)]),
    changeCents:Number(sale.changeCents || 0),
    footer:['Obrigado pela preferencia']
  });
  return renderPlainText(document);
}

module.exports = { renderSaleReceipt, money, fit, center, columns };
