'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');
const { renderSaleReceipt } = require('./receipt-renderer');
const { resolveReceiptBranding } = require('./receipt-branding');

function registerPrintEffects({ bus, effectStore, printService, saleService, settings = null, storeName = 'ArtiSys', storeAddress = '', storePhone = '', logoDataUrl = null, documentLabel = 'CUPOM NAO FISCAL', width = 42 } = {}) {
  if (!bus || !effectStore || !printService || !saleService) throw new TypeError('bus, effectStore, printService and saleService are required.');
  const saleCompleted = createIdempotentDomainEffect({
    effectKey:'receipt.sale-completed',
    effectStore,
    handler:async event => {
      const sale=saleService.getSaleDetails(event.aggregateId);
      if(!sale)throw new Error('Venda nao encontrada para impressao.');
      const branding=resolveReceiptBranding({settings,defaults:{name:storeName,address:storeAddress,phone:storePhone,logoDataUrl}});
      const text=renderSaleReceipt({branding,documentLabel,sale,width});
      return printService.queueJob({
        id:`receipt-${event.eventId}`,
        type:'SALE_RECEIPT',
        entityType:'sale',
        entityId:event.aggregateId,
        width,
        payload:{text,terminalId:event.payload?.terminalId||sale.terminalId,...(branding.logoDataUrl?{logoDataUrl:branding.logoDataUrl}:{})}
      });
    }
  });
  return [bus.subscribe('sale.completed',saleCompleted)];
}

module.exports={registerPrintEffects};
