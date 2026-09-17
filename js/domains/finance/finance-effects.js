'use strict';

const {createIdempotentDomainEffect}=require('../../core/idempotent-domain-effect');
const {withTransaction}=require('../../core/database/sqlite-database');
const {resolveAcquiringPolicy}=require('./acquiring-policy');

const KEYS=Object.freeze({
  debitFeeBps:'finance.acquiring.debit.feeBps',
  debitSettlementDays:'finance.acquiring.debit.settlementDays',
  creditFeeBps:'finance.acquiring.credit.feeBps',
  creditFirstSettlementDays:'finance.acquiring.credit.firstSettlementDays',
  creditIntervalDays:'finance.acquiring.credit.intervalDays'
});

function policySettings(settingsService){
  return{
    debitFeeBps:Number(settingsService.get(KEYS.debitFeeBps,{defaultValue:0})||0),
    debitSettlementDays:Number(settingsService.get(KEYS.debitSettlementDays,{defaultValue:0})||0),
    creditFeeBps:Number(settingsService.get(KEYS.creditFeeBps,{defaultValue:0})||0),
    creditFirstSettlementDays:Number(settingsService.get(KEYS.creditFirstSettlementDays,{defaultValue:0})||0),
    creditIntervalDays:Number(settingsService.get(KEYS.creditIntervalDays,{defaultValue:30})??30)
  };
}

function validDueAt(value,fallback){
  if(value==null||String(value).trim()==='')return fallback;
  const text=String(value);
  if(!Number.isFinite(Date.parse(text)))throw new Error('Vencimento do pagamento a prazo invalido.');
  return new Date(text).toISOString();
}

function entryGross(entry){return Number(entry.grossAmountCents??entry.amountCents??0);}
function entryFee(entry){return Number(entry.feeAmountCents??0);}
function entryNet(entry){return Number(entry.netAmountCents??entry.amountCents??0);}

function registerFinanceEffects({bus,financeService,saleService,settingsService,effectStore,db}={}){
  if(!bus||!financeService||!saleService||!settingsService||!effectStore||!db)throw new TypeError('Finance effect dependencies are required.');

  function systemActor(terminalId=null){return{userId:'finance-projection',role:'system',terminalId:terminalId||null};}

  function createSaleLine({sale,payment,sourceLineKey,gross,fee,net,dueAt,installmentNumber=null,installmentCount=null}){
    const existing=financeService.findBySourceLine('SALE',sale.id,sourceLineKey);
    if(existing)return existing;
    const suffix=installmentCount&&installmentCount>1?` ${installmentNumber}/${installmentCount}`:'';
    return financeService.createEntry({
      kind:'RECEIVABLE',description:`Venda ${sale.saleNumber}${suffix}`,category:'Vendas',amountCents:net,dueAt,
      sourceType:'SALE',sourceId:sale.id,sourceLineKey,paymentMethod:payment.method,
      grossAmountCents:gross,feeAmountCents:fee,netAmountCents:net,installmentNumber,installmentCount
    },systemActor(sale.terminalId));
  }

  function projectSaleCompleted(event){
    const sale=saleService.getSaleDetails(event.aggregateId);
    if(!sale||!sale.completedAt)throw new Error('Venda concluida nao encontrada para projecao financeira.');
    const completedAt=sale.completedAt||event.occurredAt;
    const settings=policySettings(settingsService);
    return withTransaction(db,()=>{
      const projected=[];
      let changeRemaining=Math.max(Number(sale.changeCents||0),0);
      for(const payment of sale.payments||[]){
        if(!payment?.id)throw new Error('Pagamento persistido sem identidade estavel.');
        if(payment.method==='CASH'){
          const changeForPayment=Math.min(changeRemaining,Number(payment.amountCents||0));
          changeRemaining-=changeForPayment;
          const recognized=Number(payment.amountCents||0)-changeForPayment;
          if(recognized<=0)continue;
          let entry=createSaleLine({sale,payment,sourceLineKey:payment.id,gross:recognized,fee:0,net:recognized,dueAt:completedAt});
          if(entry.status!=='SETTLED')entry=financeService.settleEntry(entry.id,{amountCents:entry.openCents,method:'CASH',note:`Liquidacao automatica da venda ${sale.saleNumber}`},systemActor(sale.terminalId)).entry;
          projected.push(entry);continue;
        }
        if(payment.method==='PIX'){
          let entry=createSaleLine({sale,payment,sourceLineKey:payment.id,gross:payment.amountCents,fee:0,net:payment.amountCents,dueAt:completedAt});
          if(entry.status!=='SETTLED')entry=financeService.settleEntry(entry.id,{amountCents:entry.openCents,method:'PIX',note:`Liquidacao automatica da venda ${sale.saleNumber}`},systemActor(sale.terminalId)).entry;
          projected.push(entry);continue;
        }
        if(payment.method==='DEBIT_CARD'||payment.method==='CREDIT_CARD'){
          const lines=resolveAcquiringPolicy({method:payment.method,amountCents:payment.amountCents,completedAt,metadata:payment.metadata,settings});
          for(const line of lines){
            projected.push(createSaleLine({sale,payment,sourceLineKey:`${payment.id}:${line.sourceSuffix}`,gross:line.grossAmountCents,fee:line.feeAmountCents,net:line.netAmountCents,dueAt:line.dueAt,installmentNumber:line.installmentNumber,installmentCount:line.installmentCount}));
          }
          continue;
        }
        const dueAt=payment.method==='STORE_CREDIT'?validDueAt(payment.metadata?.dueAt,completedAt):completedAt;
        projected.push(createSaleLine({sale,payment,sourceLineKey:payment.id,gross:payment.amountCents,fee:0,net:payment.amountCents,dueAt}));
      }
      if(changeRemaining!==0)throw new Error('Troco da venda nao pode ser reconciliado com pagamentos em dinheiro.');
      return projected;
    });
  }

  function reverseSettlementsAndCancel(entry,reason,actor){
    let current=financeService.getEntry(entry.id);
    if(!current||current.status==='CANCELLED')return current;
    for(const settlement of current.settlements||[]){
      financeService.reverseSettlement(settlement.id,{reason,actor});
    }
    current=financeService.getEntry(entry.id);
    if(current.status!=='CANCELLED')current=financeService.cancelEntry(entry.id,{reason,actor});
    return current;
  }

  function projectSaleCancelled(event){
    const terminalId=event.payload?.terminalId||null;
    const actor=systemActor(terminalId);
    return withTransaction(db,()=>financeService.listBySource('SALE',event.aggregateId)
      .map(entry=>reverseSettlementsAndCancel(entry,`Cancelamento da venda ${event.aggregateId}`,actor)));
  }

  function activeLinkedReversals(originalEntryId,currentReturnId=null){
    return financeService.listLinkedEntries(originalEntryId,{includeCancelled:false})
      .filter(entry=>entry.sourceType==='RETURN'&&(!currentReturnId||entry.sourceId!==currentReturnId));
  }

  function remainingOriginal(entry,currentReturnId=null){
    const linked=activeLinkedReversals(entry.id,currentReturnId);
    const usedGross=linked.reduce((sum,row)=>sum+entryGross(row),0);
    const usedFee=linked.reduce((sum,row)=>sum+entryFee(row),0);
    const usedNet=linked.reduce((sum,row)=>sum+entryNet(row),0);
    const gross=Math.max(entryGross(entry)-usedGross,0);
    const fee=Math.max(entryFee(entry)-usedFee,0);
    const net=Math.max(entryNet(entry)-usedNet,0);
    return{gross,fee,net};
  }

  function sortOriginals(entries,refundMethod){
    return [...entries].sort((a,b)=>{
      const methodRankA=a.paymentMethod===refundMethod?0:1;
      const methodRankB=b.paymentMethod===refundMethod?0:1;
      if(methodRankA!==methodRankB)return methodRankA-methodRankB;
      const installmentA=Number(a.installmentNumber||0);
      const installmentB=Number(b.installmentNumber||0);
      if(installmentA!==installmentB)return installmentA-installmentB;
      const due=String(a.dueAt||'').localeCompare(String(b.dueAt||''));
      return due||String(a.id).localeCompare(String(b.id));
    });
  }

  function amountsForAllocation(original,requestedGross,returnId){
    const remaining=remainingOriginal(original,returnId);
    const gross=Math.min(Number(requestedGross||0),remaining.gross);
    if(gross<=0)return null;
    const fee=gross===remaining.gross
      ?remaining.fee
      :Math.min(remaining.fee,Math.round(gross*remaining.fee/remaining.gross));
    const net=gross-fee;
    if(net<=0)throw new Error('Estorno financeiro resultou em valor liquido invalido.');
    return{gross,fee,net};
  }

  function createReturnLine({event,refund,refundIndex,original,amounts,terminalId}){
    const sourceLineKey=`refund:${refundIndex}:${original.id}`;
    let entry=financeService.findBySourceLine('RETURN',event.aggregateId,sourceLineKey);
    if(!entry){
      entry=financeService.createEntry({
        kind:'PAYABLE',description:`Devolucao ${event.aggregateId}`,category:'Devolucoes',amountCents:amounts.net,dueAt:event.occurredAt,
        sourceType:'RETURN',sourceId:event.aggregateId,sourceLineKey,paymentMethod:refund.method,
        grossAmountCents:amounts.gross,feeAmountCents:amounts.fee,netAmountCents:amounts.net,originalEntryId:original.id,
        notes:`Estorno vinculado a venda ${event.payload?.saleId||original.sourceId}`
      },systemActor(terminalId));
    }
    if(entry.status!=='SETTLED'&&entry.status!=='CANCELLED'&&entry.openCents>0){
      entry=financeService.settleEntry(entry.id,{amountCents:entry.openCents,method:refund.method,note:`Reembolso da devolucao ${event.aggregateId}`},systemActor(terminalId)).entry;
    }
    return entry;
  }

  function projectReturnCompleted(event){
    const saleId=String(event.payload?.saleId||'').trim();
    if(!saleId)throw new Error('Devolucao sem venda de origem para projecao financeira.');
    const terminalId=event.payload?.terminalId||null;
    const originals=financeService.listBySource('SALE',saleId).filter(entry=>entry.status!=='CANCELLED');
    if(!originals.length)throw new Error('Venda sem lancamentos financeiros para estorno da devolucao.');
    const refunds=Array.isArray(event.payload?.refunds)?event.payload.refunds:[];
    if(!refunds.length)throw new Error('Devolucao sem reembolsos para projecao financeira.');

    return withTransaction(db,()=>{
      const projected=[];
      refunds.forEach((refund,refundIndex)=>{
        let pending=Number(refund.amountCents||0);
        if(!Number.isSafeInteger(pending)||pending<=0)throw new Error('Valor de reembolso financeiro invalido.');
        for(const original of sortOriginals(originals,refund.method)){
          if(pending<=0)break;
          const amounts=amountsForAllocation(original,pending,event.aggregateId);
          if(!amounts)continue;
          projected.push(createReturnLine({event,refund,refundIndex,original,amounts,terminalId}));
          pending-=amounts.gross;
        }
        if(pending!==0)throw new Error('Reembolso excede o valor financeiro disponivel da venda.');
      });
      return projected;
    });
  }

  function projectReturnCancelled(event){
    const terminalId=event.payload?.terminalId||null;
    const actor=systemActor(terminalId);
    return withTransaction(db,()=>financeService.listBySource('RETURN',event.aggregateId)
      .map(entry=>reverseSettlementsAndCancel(entry,`Cancelamento da devolucao ${event.aggregateId}`,actor)));
  }

  const completed=createIdempotentDomainEffect({effectKey:'finance.sale-completed',effectStore,handler:async event=>projectSaleCompleted(event)});
  const saleCancelled=createIdempotentDomainEffect({effectKey:'finance.sale-cancelled',effectStore,handler:async event=>projectSaleCancelled(event)});
  const returnCompleted=createIdempotentDomainEffect({effectKey:'finance.return-completed',effectStore,handler:async event=>projectReturnCompleted(event)});
  const returnCancelled=createIdempotentDomainEffect({effectKey:'finance.return-cancelled',effectStore,handler:async event=>projectReturnCancelled(event)});
  return[
    bus.subscribe('sale.completed',completed),
    bus.subscribe('sale.cancelled',saleCancelled),
    bus.subscribe('return.completed',returnCompleted),
    bus.subscribe('return.cancelled',returnCancelled)
  ];
}

module.exports={registerFinanceEffects,policySettings,KEYS};
