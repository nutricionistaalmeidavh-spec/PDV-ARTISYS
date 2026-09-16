'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { normalizeMethod } = require('../payments/payment-rules');

function createCommercialReturnService({db,baseReturns,lotService=null,creditService=null,idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!baseReturns)throw new TypeError('Database and baseReturns are required.');

  function createReturn(input={}){
    const id=String(input.id||idFactory('return'));
    return withTransaction(db,()=>{
      const result=baseReturns.createReturn({...input,id});
      if(lotService){for(const item of result.items||[]){const tracked=Boolean(db.prepare('SELECT track_lots AS trackLots FROM products WHERE id=?').get(item.productId)?.trackLots);if(tracked)lotService.restoreReturnItem({returnId:id,returnItemId:item.id,saleItemId:item.saleItemId,quantity:item.quantity},input.actor||{});}}
      if(creditService){for(let index=0;index<(input.refunds||[]).length;index++){const refund=input.refunds[index];if(normalizeMethod(refund.method)!=='STORE_CREDIT')continue;let accountId=refund.metadata?.creditAccountId||null;if(!accountId&&refund.metadata?.giftCardCode)accountId=creditService.findGiftCard(refund.metadata.giftCardCode)?.id||null;if(accountId)creditService.refund({accountId,amountCents:refund.amountCents,sourceType:'return',sourceId:`${id}:${index}`,note:`Devolucao ${id}`},input.actor||{});}}
      return baseReturns.getReturn(id);
    });
  }

  function cancelReturn(id,options={}){
    return withTransaction(db,()=>{
      const result=baseReturns.cancelReturn(id,options);
      if(lotService)lotService.cancelReturn(id,options.actor||{});
      if(creditService){const entries=db.prepare(`SELECT id FROM credit_ledger cl WHERE source_type='return' AND source_id LIKE ? AND reversed_entry_id IS NULL
        AND NOT EXISTS(SELECT 1 FROM credit_ledger r WHERE r.reversed_entry_id=cl.id)`).all(`${String(id)}:%`);for(const entry of entries)creditService.reverse(entry.id,{reason:options.reason||'Cancelamento da devolucao',actor:options.actor||{}});}
      return result;
    });
  }

  return{...baseReturns,createReturn,cancelReturn};
}

module.exports={createCommercialReturnService};
