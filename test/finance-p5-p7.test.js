'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

function actor(userId='manager',role='manager'){return{userId,role,terminalId:'PDV-P57'};}

function fixture(t){
  let seq=0;
  const runtime=createPdvRuntime({dbPath:':memory:',now:()=> '2026-09-17T21:00:00.000Z',idFactory:p=>`${p}-${++seq}`});
  t.after(()=>runtime.close());
  runtime.catalog.createUser({id:'manager',username:'manager-p57',name:'Gerente P57',role:'manager',password:'QaLocalOnly-12345!'});
  runtime.catalog.createUser({id:'seller',username:'seller-p57',name:'Vendedor P57',role:'cashier',password:'QaLocalOnly-12345!'});
  runtime.catalog.upsertCustomer({id:'customer',name:'Cliente P57',document:'12345678909',creditLimitCents:50000,creditUsedCents:0,active:true});
  runtime.catalog.upsertCategory({id:'cat',name:'P57'});
  runtime.catalog.upsertProduct({id:'prod',categoryId:'cat',sku:'P57-1',name:'Produto P57',salePriceCents:5000,costCents:1000,trackStock:true,minimumStock:0});
  runtime.inventory.move({productId:'prod',type:'opening',quantityDelta:20,reason:'Saldo P57'});
  runtime.cash.openSession({id:'cash',terminalId:'PDV-P57',operatorId:'manager',initialCashCents:0,actor:actor()});

  async function completedSale(id='sale-p57'){
    runtime.sales.openSale({id,saleNumber:`P57-${id}`,terminalId:'PDV-P57',operatorId:'manager',customerId:'customer'},actor());
    runtime.sales.setSeller(id,'seller',actor());
    runtime.sales.addItem(id,{productId:'prod',quantity:2});
    runtime.sales.completeSale(id,{payments:[{method:'CASH',amountCents:10000}],actor:actor(),mutationId:`complete-${id}`});
    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failed,0,JSON.stringify(dispatch));
    return runtime.sales.getSaleDetails(id);
  }
  return{runtime,completedSale};
}

test('P5 finance entries expose sale context and filter by origin payment seller customer and sale',async t=>{
  const fx=fixture(t);
  await fx.completedSale();
  const rows=fx.runtime.finance.listEntries({sourceType:'SALE',paymentMethod:'CASH',sellerId:'seller',customerId:'customer',saleId:'sale-p57'});
  assert.equal(rows.length,1);
  const [entry]=rows;
  assert.equal(entry.saleId,'sale-p57');
  assert.equal(entry.saleNumber,'P57-sale-p57');
  assert.equal(entry.sellerId,'seller');
  assert.equal(entry.sellerName,'Vendedor P57');
  assert.equal(entry.customerId,'customer');
  assert.equal(entry.customerName,'Cliente P57');
  assert.equal(fx.runtime.finance.listEntries({sourceType:'RETURN'}).length,0);
  assert.equal(fx.runtime.finance.listEntries({sellerId:'missing'}).length,0);
});

test('P5 return finance entries inherit navigable sale context',async t=>{
  const fx=fixture(t);
  const sale=await fx.completedSale('sale-return-p57');
  fx.runtime.returns.createReturn({id:'return-p57',saleId:sale.id,terminalId:'PDV-P57',operatorId:'manager',reason:'P57 return',items:[{saleItemId:sale.items[0].id,quantity:1}],refunds:[{method:'CASH',amountCents:5000}],actor:actor(),mutationId:'return-p57'});
  const dispatch=await fx.runtime.dispatchPending();
  assert.equal(dispatch.failed,0,JSON.stringify(dispatch));
  const rows=fx.runtime.finance.listEntries({sourceType:'RETURN',saleId:sale.id,sellerId:'seller',customerId:'customer'});
  assert.equal(rows.length,1);
  assert.equal(rows[0].returnId,'return-p57');
  assert.equal(rows[0].saleId,sale.id);
  assert.equal(rows[0].saleNumber,'P57-sale-return-p57');
});

test('P6 financial report is a separate perspective with net settled and source breakdown',async t=>{
  const fx=fixture(t);
  const sale=await fx.completedSale('sale-report-p57');
  fx.runtime.returns.createReturn({id:'return-report-p57',saleId:sale.id,terminalId:'PDV-P57',operatorId:'manager',reason:'P57 report return',items:[{saleItemId:sale.items[0].id,quantity:1}],refunds:[{method:'CASH',amountCents:5000}],actor:actor()});
  assert.equal((await fx.runtime.dispatchPending()).failed,0);
  const summary=fx.runtime.reports.buildFinanceSummary({sellerId:'seller'});
  assert.equal(summary.perspective,'FINANCIAL');
  assert.equal(summary.receivableSettledCents,10000);
  assert.equal(summary.payableSettledCents,5000);
  assert.equal(summary.netSettledCents,5000);
  assert.equal(summary.sourceBreakdown.SALE.settledCents,10000);
  assert.equal(summary.sourceBreakdown.RETURN.settledCents,5000);
  assert.equal(Object.prototype.hasOwnProperty.call(summary,'combinedRevenueCents'),false);
  assert.equal(fx.runtime.reports.buildFinanceSummary({sellerId:'missing'}).receivableTotalCents,0);
});

test('P7 createSourceEntry is idempotent for the same business origin',t=>{
  const fx=fixture(t);
  const input={kind:'RECEIVABLE',description:'Origem idempotente',category:'QA',amountCents:1234,dueAt:'2026-09-17T21:00:00.000Z',sourceType:'SALE',sourceId:'sale-idem-p57',sourceLineKey:'pay-idem-p57',paymentMethod:'PIX',grossAmountCents:1234,feeAmountCents:0,netAmountCents:1234};
  const first=fx.runtime.finance.createSourceEntry(input,actor());
  const second=fx.runtime.finance.createSourceEntry(input,actor());
  assert.equal(second.id,first.id);
  assert.equal(fx.runtime.finance.listBySource('SALE','sale-idem-p57').length,1);
});

test('P7 finance effects use source-idempotent creation in completed sale and return projections',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','js','domains','finance','finance-effects.js'),'utf8');
  assert.match(source,/createSourceEntry\(/);
  assert.doesNotMatch(source,/function createSaleLine[\s\S]*?financeService\.createEntry\(/);
  assert.doesNotMatch(source,/function createReturnLine[\s\S]*?financeService\.createEntry\(/);
});

test('P5/P6 renderer exposes finance filters and bidirectional sale navigation without combined revenue UI',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','finance-p5-p6-ui.js'),'utf8');
  for(const token of ['ops-finance-p5-filter','sourceType','paymentMethod','sellerId','customerId','data-finance-view-sale','data-sale-view-finance'])assert.match(source,new RegExp(token));
  assert.match(source,/Visões separadas|Visoes separadas/);
  assert.match(source,/não devem ser somadas|nao devem ser somadas/i);
  assert.doesNotMatch(source,/combinedRevenueCents/);
});
