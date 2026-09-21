'use strict';
const { createIdempotentDomainEffect } = require('../../core/idempotent-domain-effect');
const { buildFiscalDocument } = require('./fiscal-document-builder');
const { buildNfeDocument } = require('./nfe-document-builder');
const { classifyIssueResult, classifyReconcileResult } = require('./fiscal-state-machine');

function registerFiscalEffects({ bus, effectStore, fiscalService, providerResolver, observability=null } = {}) {
  if (!bus || !effectStore || !fiscalService || typeof providerResolver !== 'function') throw new TypeError('bus, effectStore, fiscalService and providerResolver are required.');
  function observe(operation,document,started,result,outcome,retry=0){try{observability?.record?.({operation,provider:document?.provider||null,documentType:document?.documentType||null,environment:document?.environment||null,durationMs:Math.max(0,Date.now()-started),outcome,sefazCode:result?.data?.cStat??result?.data?.codigo??null,reference:document?.reference||null,retry,context:{status:Number(result?.status||0),indeterminate:Boolean(result?.indeterminate),error:result?.error||null}});}catch{/* observability never changes fiscal outcome */}}

  const issueRequested = createIdempotentDomainEffect({
    effectKey:'fiscal.issue-requested',effectStore,
    handler:async event => {
      let document = fiscalService.getDocument(event.aggregateId);
      if (!document) throw new Error('Documento fiscal nao encontrado para emissao.');
      if (['AUTHORIZED','CANCELLED'].includes(document.lifecycleStatus) || ['ISSUED','CANCELLED'].includes(document.status)) return document;
      if (document.lifecycleStatus === 'UNKNOWN') return document;
      document = fiscalService.markProcessing(document.id,event.actor || {});const started=Date.now();let provider;
      try { provider = await providerResolver(document); } catch (error) { const result={status:0,error:error?.message||String(error)};observe('issue',document,started,result,'FAILED',Math.max(0,Number(document.attemptCount||1)-1));return fiscalService.markFailed(document.id,result,event.actor||{}); }
      if (!provider || typeof provider.issue !== 'function') { const result={status:0,error:'Provedor fiscal indisponivel.'};observe('issue',document,started,result,'FAILED',Math.max(0,Number(document.attemptCount||1)-1));return fiscalService.markFailed(document.id,result,event.actor||{}); }
      let result;
      try { result = await provider.issue({documentType:document.documentType,reference:document.reference,payload:document.requestPayload}); }
      catch (error) { result = {ok:false,status:0,indeterminate:true,error:error?.message || String(error)}; }
      const classification=classifyIssueResult(result || {});observe('issue',document,started,result,classification,Math.max(0,Number(document.attemptCount||1)-1));
      if(classification==='AUTHORIZED') return fiscalService.markAuthorized(document.id,result,event.actor || {});
      if(classification==='REJECTED') return fiscalService.markRejected(document.id,result,event.actor || {});
      if(classification==='UNKNOWN') return fiscalService.markUnknown(document.id,result,event.actor || {});
      return fiscalService.markFailed(document.id,result || {error:'Falha na emissao fiscal.'},event.actor || {});
    }
  });

  const reconcileRequested=createIdempotentDomainEffect({
    effectKey:'fiscal.reconcile-requested',effectStore,
    handler:async event=>{
      const document=fiscalService.getDocument(event.aggregateId);if(!document) throw new Error('Documento fiscal nao encontrado para reconciliacao.');if(document.lifecycleStatus!=='UNKNOWN') return document;const started=Date.now();
      let provider;try{provider=await providerResolver(document);}catch(error){const result={status:0,indeterminate:true,error:error?.message||String(error)};observe('reconcile',document,started,result,'UNKNOWN');return fiscalService.markReconcileUnknown(document.id,result,event.actor||{});}
      if(!provider||typeof provider.query!=='function'){const result={status:0,error:'Provedor fiscal nao suporta reconciliacao.'};observe('reconcile',document,started,result,'UNKNOWN');return fiscalService.markReconcileUnknown(document.id,result,event.actor||{});}
      let result;try{result=await provider.query(document.reference,document.documentType,{accessKey:document.accessKey,payload:document.requestPayload});}catch(error){result={ok:false,status:0,indeterminate:true,error:error?.message||String(error)};}
      const classification=classifyReconcileResult(result||{});observe('reconcile',document,started,result,classification);
      if(classification==='AUTHORIZED') return fiscalService.markAuthorized(document.id,result,event.actor||{});
      if(classification==='REJECTED') return fiscalService.markRejected(document.id,result,event.actor||{});
      if(classification==='NOT_FOUND') return fiscalService.markReconcileNotFound(document.id,result,event.actor||{});
      return fiscalService.markReconcileUnknown(document.id,result||{},event.actor||{});
    }
  });

  const cancelRequested=createIdempotentDomainEffect({
    effectKey:'fiscal.cancel-requested',effectStore,
    handler:async event=>{
      const document=fiscalService.getDocument(event.aggregateId);if(!document)throw new Error('Documento fiscal nao encontrado para cancelamento.');if(document.lifecycleStatus==='CANCELLED')return document;if(document.lifecycleStatus!=='AUTHORIZED')return document;const started=Date.now();
      let provider;try{provider=await providerResolver(document);}catch(error){const result={status:0,indeterminate:true,error:error?.message||String(error)};observe('cancel',document,started,result,'UNKNOWN');return fiscalService.markCancelFailed(document.id,result,event.actor||{});}
      if(!provider||typeof provider.cancel!=='function'){const result={status:0,error:'Provedor fiscal nao suporta cancelamento.'};observe('cancel',document,started,result,'FAILED');return fiscalService.markCancelFailed(document.id,result,event.actor||{});}
      let result;try{result=await provider.cancel(document.reference,document.cancellationReason,document.documentType,{accessKey:document.accessKey,issuerCnpj:document.requestPayload?.issuer?.cnpj||null,payload:document.requestPayload});}catch(error){result={ok:false,status:0,indeterminate:true,error:error?.message||String(error)};}
      observe('cancel',document,started,result,result?.ok?'CANCELLED':(result?.indeterminate?'UNKNOWN':'FAILED'));
      if(result?.ok)return fiscalService.markCancelled(document.id,result,event.actor||{},document.cancellationReason);
      return fiscalService.markCancelFailed(document.id,result||{error:'Falha no cancelamento fiscal.'},event.actor||{});
    }
  });

  return [bus.subscribe('fiscal.issue-requested',issueRequested),bus.subscribe('fiscal.reconcile-requested',reconcileRequested),bus.subscribe('fiscal.cancel-requested',cancelRequested)];
}

function registerFiscalAutoIssueEffect({ bus, effectStore, fiscalService, saleService, resolveConfiguration } = {}) {
  if (!bus || !effectStore || !fiscalService || !saleService || typeof resolveConfiguration !== 'function') throw new TypeError('bus, effectStore, fiscalService, saleService and resolveConfiguration are required.');
  const autoIssue = createIdempotentDomainEffect({
    effectKey:'fiscal.sale-completed.auto-issue',effectStore,
    handler:async event => {
      const sale = saleService.getSaleDetails(event.aggregateId);if (!sale) throw new Error('Venda nao encontrada para emissao fiscal automatica.');const config = await resolveConfiguration({ event, sale });
      if (!config || config.configured === false || config.autoIssue === false) return { skipped:true, reason:'not-configured' };
      const reference = config.reference || sale.saleNumber || sale.id;const useCanonicalBuilder = config.provider === 'acbr-local' && config.fiscalContext;let payload=config.payload||{};
      if(useCanonicalBuilder){const type=String(config.documentType||'nfce').toLowerCase();payload=type==='nfe'?buildNfeDocument({sale,fiscalContext:config.fiscalContext,recipient:config.recipient||config.fiscalContext.recipient,environment:config.environment,reference}):buildFiscalDocument({sale,fiscalContext:config.fiscalContext,documentType:type,environment:config.environment,reference});}
      return fiscalService.requestIssue({saleId:sale.id,provider:config.provider,environment:config.environment,documentType:config.documentType,reference,payload,actor:event.actor || {},mutationId:event.mutationId || null});
    }
  });
  return [bus.subscribe('sale.completed',autoIssue)];
}
module.exports = { registerFiscalEffects, registerFiscalAutoIssueEffect };