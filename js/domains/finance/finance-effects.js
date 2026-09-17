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

function registerFinanceEffects({bus,financeService,saleService,settingsService,effectStore,db}={}){
  if(!bus||!financeService||!saleService||!settingsService||!effectStore||!db)throw new TypeError('Finance effect dependencies are required.');

  function createLine({sale,payment,sourceLineKey,gross,fee,net,dueAt,installmentNumber=null,installmentCount=null}){
    const existing=financeService.findBySourceLine('SALE',sale.id,sourceLineKey);
    if(existing)return existing;
    const suffix=installmentCount&&installmentCount>1?` ${installmentNumber}/${installmentCount}`:'';
    return financeService.createEntry({
      kind:'RECEIVABLE',description:`Venda ${sale.saleNumber}${suffix}`,category:'Vendas',amountCents:net,dueAt,
      sourceType:'SALE',sourceId:sale.id,sourceLineKey,paymentMethod:payment.method,
      grossAmountCents:gross,feeAmountCents:fee,netAmountCents:net,installmentNumber,installmentCount
    },{userId:'finance-projection',role:'system',terminalId:sale.terminalId});
  }

  function project(event){
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
          let entry=createLine({sale,payment,sourceLineKey:payment.id,gross:recognized,fee:0,net:recognized,dueAt:completedAt});
          if(entry.status!=='SETTLED')entry=financeService.settleEntry(entry.id,{amountCents:entry.openCents,method:'CASH',note:`Liquidação automática da venda ${sale.saleNumber}`},{userId:'finance-projection',role:'system',terminalId:sale.terminalId}).entry;
          projected.push(entry);continue;
        }
        if(payment.method==='PIX'){
          let entry=createLine({sale,payment,sourceLineKey:payment.id,gross:payment.amountCents,fee:0,net:payment.amountCents,dueAt:completedAt});
          if(entry.status!=='SETTLED')entry=financeService.settleEntry(entry.id,{amountCents:entry.openCents,method:'PIX',note:`Liquidação automática da venda ${sale.saleNumber}`},{userId:'finance-projection',role:'system',terminalId:sale.terminalId}).entry;
          projected.push(entry);continue;
        }
        if(payment.method==='DEBIT_CARD'||payment.method==='CREDIT_CARD'){
          const lines=resolveAcquiringPolicy({method:payment.method,amountCents:payment.amountCents,completedAt,metadata:payment.metadata,settings});
          for(const line of lines){
            projected.push(createLine({sale,payment,sourceLineKey:`${payment.id}:${line.sourceSuffix}`,gross:line.grossAmountCents,fee:line.feeAmountCents,net:line.netAmountCents,dueAt:line.dueAt,installmentNumber:line.installmentNumber,installmentCount:line.installmentCount}));
          }
          continue;
        }
        const dueAt=payment.method==='STORE_CREDIT'?validDueAt(payment.metadata?.dueAt,completedAt):completedAt;
        projected.push(createLine({sale,payment,sourceLineKey:payment.id,gross:payment.amountCents,fee:0,net:payment.amountCents,dueAt}));
      }
      if(changeRemaining!==0)throw new Error('Troco da venda nao pôde ser reconciliado com pagamentos em dinheiro.');
      return projected;
    });
  }

  const completed=createIdempotentDomainEffect({effectKey:'finance.sale-completed',effectStore,handler:async event=>project(event)});
  return[bus.subscribe('sale.completed',completed)];
}

module.exports={registerFinanceEffects,policySettings,KEYS};
