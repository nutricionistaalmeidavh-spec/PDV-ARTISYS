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

module.exports = { registerFiscalEffects };
