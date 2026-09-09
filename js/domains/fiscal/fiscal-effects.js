'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');

function registerFiscalEffects({ bus, effectStore, fiscalService, providerResolver } = {}) {
  if (!bus || !effectStore || !fiscalService || typeof providerResolver !== 'function') {
    throw new TypeError('bus, effectStore, fiscalService and providerResolver are required.');
  }

  const issueRequested = createIdempotentDomainEffect({
    effectKey:'fiscal.issue-requested',
    effectStore,
    handler:async event => {
      const document = fiscalService.getDocument(event.aggregateId);
      if (!document) throw new Error('Documento fiscal nao encontrado para emissao.');
      if (document.status === 'ISSUED' || document.status === 'CANCELLED') return document;
      let provider;
      try {
        provider = await providerResolver(document);
      } catch (error) {
        return fiscalService.markFailed(document.id,{status:0,error:error?.message || String(error)},event.actor || {});
      }
      if (!provider || typeof provider.issue !== 'function') {
        return fiscalService.markFailed(document.id,{status:0,error:'Provedor fiscal indisponivel.'},event.actor || {});
      }
      let result;
      try {
        result = await provider.issue({
          documentType:document.documentType,
          reference:document.reference,
          payload:document.requestPayload
        });
      } catch (error) {
        result = {ok:false,status:0,error:error?.message || String(error)};
      }
      return result?.ok
        ? fiscalService.markIssued(document.id,result,event.actor || {})
        : fiscalService.markFailed(document.id,result || {error:'Falha na emissao fiscal.'},event.actor || {});
    }
  });

  return [bus.subscribe('fiscal.issue-requested',issueRequested)];
}

function registerFiscalAutoIssueEffect({ bus, effectStore, fiscalService, saleService, resolveConfiguration } = {}) {
  if (!bus || !effectStore || !fiscalService || !saleService || typeof resolveConfiguration !== 'function') {
    throw new TypeError('bus, effectStore, fiscalService, saleService and resolveConfiguration are required.');
  }
  const autoIssue = createIdempotentDomainEffect({
    effectKey:'fiscal.sale-completed.auto-issue',
    effectStore,
    handler:async event => {
      const sale = saleService.getSaleDetails(event.aggregateId);
      if (!sale) throw new Error('Venda nao encontrada para emissao fiscal automatica.');
      const config = await resolveConfiguration({ event, sale });
      if (!config || config.configured === false || config.autoIssue === false) return { skipped:true, reason:'not-configured' };
      return fiscalService.requestIssue({
        saleId:sale.id,
        provider:config.provider,
        environment:config.environment,
        documentType:config.documentType,
        reference:config.reference || sale.saleNumber || sale.id,
        payload:config.payload || {},
        actor:event.actor || {},
        mutationId:event.mutationId || null
      });
    }
  });
  return [bus.subscribe('sale.completed',autoIssue)];
}

module.exports = { registerFiscalEffects, registerFiscalAutoIssueEffect };
