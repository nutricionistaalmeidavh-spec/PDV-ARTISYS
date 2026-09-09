'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');
const { renderSaleReceipt } = require('./receipt-renderer');

function registerPrintEffects({ bus, effectStore, printService, saleService, storeName = 'ArtiSys', documentLabel = 'CUPOM NAO FISCAL', width = 42 } = {}) {
  if (!bus || !effectStore || !printService || !saleService) throw new TypeError('bus, effectStore, printService and saleService are required.');
  const saleCompleted = createIdempotentDomainEffect({
    effectKey:'receipt.sale-completed',
    effectStore,
    handler:async event => {
      const sale=saleService.getSaleDetails(event.aggregateId);
      if(!sale)throw new Error('Venda nao encontrada para impressao.');
      const text=renderSaleReceipt({storeName,documentLabel,sale,width});
      return printService.queueJob({
        id:`receipt-${event.eventId}`,
        type:'SALE_RECEIPT',
        entityType:'sale',
        entityId:event.aggregateId,
        width,
        payload:{text,terminalId:event.payload?.terminalId||sale.terminalId}
      });
    }
  });
  return [bus.subscribe('sale.completed',saleCompleted)];
}

module.exports={registerPrintEffects};
