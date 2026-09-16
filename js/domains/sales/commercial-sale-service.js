'use strict';

const { withTransaction } = require('../../core/database/sqlite-database');
const { normalizeMethod } = require('../payments/payment-rules');

function createCommercialSaleService({db,baseSales,lotService=null,pixService=null,creditService=null,now=()=>new Date().toISOString()}={}){
  if(!db||!baseSales)throw new TypeError('Database and baseSales are required.');

  function completeSale(saleId,options={}){
    const actor=options.actor||{};
    return withTransaction(db,()=>{
      const sale=baseSales.getSale(saleId);if(!sale)throw new Error('Venda nao encontrada.');
      const payments=(options.payments||[]).map(payment=>({...payment,metadata:payment.metadata?{...payment.metadata}:null}));
      if(lotService){for(const item of sale.items||[])lotService.allocateSaleItem({saleId,saleItemId:item.id,productId:item.productId,quantity:item.quantity,at:now(),allowExpired:Boolean(options.allowExpiredLots),overrideReason:options.expiredLotOverrideReason||''},actor);}
      for(let index=0;index<payments.length;index++){
        const payment=payments[index];const method=normalizeMethod(payment.method);
        if(method==='PIX'&&payment.metadata?.pixChargeId&&pixService)pixService.assertConfirmedPayment({chargeId:payment.metadata.pixChargeId,saleId,amountCents:payment.amountCents});
        if(method==='STORE_CREDIT'&&creditService&&(payment.metadata?.creditAccountId||payment.metadata?.giftCardCode)){
          const result=creditService.redeem({accountId:payment.metadata?.creditAccountId||null,giftCardCode:payment.metadata?.giftCardCode||null,amountCents:payment.amountCents,sourceType:'sale',sourceId:`${saleId}:${index}`,note:`Venda ${sale.saleNumber}`},actor);
          payment.metadata={...(payment.metadata||{}),balanceValidatedExternally:true,creditAccountId:result.account.id,creditLedgerEntryId:result.entry.id};
        }
      }
      return baseSales.completeSale(saleId,{...options,payments});
    });
  }

  function cancelSale(saleId,options={}){
    const before=baseSales.getSale(saleId);if(!before)throw new Error('Venda nao encontrada.');
    if(before.status!=='COMPLETED')return baseSales.cancelSale(saleId,options);
    return withTransaction(db,()=>{
      const customerBefore=before.customerId?db.prepare('SELECT credit_used_cents AS used FROM customers WHERE id=?').get(before.customerId):null;
      const payments=before.payments||[];
      const legacyCredit=payments.filter(payment=>normalizeMethod(payment.method)==='STORE_CREDIT'&&payment.metadata?.balanceValidatedExternally!==true).reduce((sum,payment)=>sum+Number(payment.amountCents||0),0);
      const result=baseSales.cancelSale(saleId,options);
      if(lotService)lotService.restoreSale(saleId,options.actor||{});
      if(creditService){for(const payment of payments){const entryId=payment.metadata?.creditLedgerEntryId;if(entryId)creditService.reverse(entryId,{reason:options.reason||'Cancelamento da venda',actor:options.actor||{}});}}
      if(before.customerId&&customerBefore){const desired=Math.max(Number(customerBefore.used||0)-legacyCredit,0);db.prepare('UPDATE customers SET credit_used_cents=?,updated_at=? WHERE id=?').run(desired,now(),before.customerId);}
      return result;
    });
  }

  return{...baseSales,completeSale,cancelSale};
}

module.exports={createCommercialSaleService};
