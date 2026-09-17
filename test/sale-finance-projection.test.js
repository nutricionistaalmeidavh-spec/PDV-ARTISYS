'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

function actor(){return{userId:'admin',role:'manager',terminalId:'PDV-FIN'};}

function fixture(t,{priceCents=10000,stamp='2026-09-17T12:00:00.000Z'}={}){
  let seq=0;
  const runtime=createPdvRuntime({dbPath:':memory:',now:()=>stamp,idFactory:p=>`${p}-${++seq}`});
  t.after(()=>runtime.close());
  runtime.catalog.createUser({id:'admin',username:'admin-fin',name:'Admin Finance',role:'manager',password:'QaLocalOnly-12345!'});
  runtime.catalog.upsertCategory({id:'cat-fin',name:'Finance'});
  runtime.catalog.upsertProduct({id:'prod-fin',categoryId:'cat-fin',sku:'FIN-1',barcode:'7891234567890',name:'Produto Finance',salePriceCents:priceCents,costCents:1000,trackStock:true,minimumStock:0});
  runtime.catalog.upsertCustomer({id:'customer-fin',name:'Cliente Finance',document:'12345678901',creditLimitCents:50000,creditUsedCents:0,active:true});
  runtime.inventory.move({productId:'prod-fin',type:'opening',quantityDelta:50,reason:'Saldo'});
  runtime.cash.openSession({id:'cash-fin',terminalId:'PDV-FIN',operatorId:'admin',initialCashCents:10000,actor:actor()});
  async function sale(id,payments,total=priceCents){
    await runtime.dispatchPending();
    runtime.sales.openSale({id,saleNumber:`FIN-${id}`,terminalId:'PDV-FIN',operatorId:'admin',customerId:'customer-fin'},actor());
    runtime.sales.addItem(id,{productId:'prod-fin',quantity:1});
    if(total!==priceCents) throw new Error('fixture total mismatch');
    runtime.sales.completeSale(id,{payments,actor:actor(),mutationId:`mut-${id}`});
    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failed,0,JSON.stringify(dispatch));
    return runtime.sales.getSaleDetails(id);
  }
  return{runtime,sale};
}

function saleEntries(runtime,saleId){return runtime.finance.listEntries({}).filter(row=>row.sourceType==='SALE'&&row.sourceId===saleId);}

test('cash sale creates settled finance entry with stable payment origin',async t=>{
  const fx=fixture(t);
  const sale=await fx.sale('cash',[{method:'CASH',amountCents:10000}]);
  const entries=saleEntries(fx.runtime,'cash');
  assert.equal(entries.length,1);
  assert.equal(entries[0].status,'SETTLED');
  assert.equal(entries[0].amountCents,10000);
  assert.equal(entries[0].grossAmountCents,10000);
  assert.equal(entries[0].feeAmountCents,0);
  assert.equal(entries[0].netAmountCents,10000);
  assert.equal(entries[0].paymentMethod,'CASH');
  assert.equal(entries[0].sourceLineKey,sale.payments[0].id);
  assert.equal(entries[0].settlements.length,1);
  assert.equal(entries[0].settlements[0].method,'CASH');
});

test('pix sale creates settled finance entry',async t=>{
  const fx=fixture(t);
  await fx.sale('pix',[{method:'PIX',amountCents:10000}]);
  const [entry]=saleEntries(fx.runtime,'pix');
  assert.equal(entry.status,'SETTLED');
  assert.equal(entry.paymentMethod,'PIX');
  assert.equal(entry.settledCents,10000);
});

test('debit creates open net receivable with configured fee and due date',async t=>{
  const fx=fixture(t);
  fx.runtime.settings.set('finance.acquiring.debit.feeBps',250,{actor:actor()});
  fx.runtime.settings.set('finance.acquiring.debit.settlementDays',2,{actor:actor()});
  await fx.sale('debit',[{method:'DEBIT_CARD',amountCents:10000}]);
  const [entry]=saleEntries(fx.runtime,'debit');
  assert.equal(entry.status,'OPEN');
  assert.equal(entry.grossAmountCents,10000);
  assert.equal(entry.feeAmountCents,250);
  assert.equal(entry.netAmountCents,9750);
  assert.equal(entry.amountCents,9750);
  assert.equal(entry.dueAt,'2026-09-19T12:00:00.000Z');
});

test('credit 3x creates three open receivables preserving metadata and totals',async t=>{
  const fx=fixture(t,{priceCents:10001});
  fx.runtime.settings.set('finance.acquiring.credit.feeBps',299,{actor:actor()});
  fx.runtime.settings.set('finance.acquiring.credit.firstSettlementDays',30,{actor:actor()});
  fx.runtime.settings.set('finance.acquiring.credit.intervalDays',30,{actor:actor()});
  const sale=await fx.sale('credit',[{method:'CREDIT_CARD',amountCents:10001,metadata:{installments:3}}]);
  const entries=saleEntries(fx.runtime,'credit').sort((a,b)=>a.installmentNumber-b.installmentNumber);
  assert.equal(sale.payments[0].metadata.installments,3);
  assert.equal(entries.length,3);
  assert.deepEqual(entries.map(row=>row.installmentNumber),[1,2,3]);
  assert.ok(entries.every(row=>row.installmentCount===3&&row.status==='OPEN'&&row.paymentMethod==='CREDIT_CARD'));
  assert.equal(entries.reduce((sum,row)=>sum+row.grossAmountCents,0),10001);
  assert.equal(entries.reduce((sum,row)=>sum+row.feeAmountCents,0),Math.round(10001*299/10000));
  assert.equal(entries.reduce((sum,row)=>sum+row.netAmountCents,0),10001-Math.round(10001*299/10000));
  assert.deepEqual(entries.map(row=>row.sourceLineKey),[`${sale.payments[0].id}:1`,`${sale.payments[0].id}:2`,`${sale.payments[0].id}:3`]);
});

test('store credit creates open receivable and respects explicit due date metadata',async t=>{
  const fx=fixture(t);
  await fx.sale('store',[{method:'STORE_CREDIT',amountCents:10000,metadata:{dueAt:'2026-10-17T12:00:00.000Z'}}]);
  const [entry]=saleEntries(fx.runtime,'store');
  assert.equal(entry.status,'OPEN');
  assert.equal(entry.dueAt,'2026-10-17T12:00:00.000Z');
  assert.equal(entry.paymentMethod,'STORE_CREDIT');
});

test('other payment creates open receivable without assuming settlement',async t=>{
  const fx=fixture(t);
  await fx.sale('other',[{method:'OTHER',amountCents:10000}]);
  const [entry]=saleEntries(fx.runtime,'other');
  assert.equal(entry.status,'OPEN');
  assert.equal(entry.settledCents,0);
});

test('mixed payment creates independent finance lines without changing commercial sale total',async t=>{
  const fx=fixture(t);
  const sale=await fx.sale('mixed',[{method:'CASH',amountCents:4000},{method:'CREDIT_CARD',amountCents:6000,metadata:{installments:2}}]);
  const entries=saleEntries(fx.runtime,'mixed');
  assert.equal(sale.totalCents,10000);
  assert.equal(entries.length,3);
  assert.equal(entries.filter(row=>row.paymentMethod==='CASH'&&row.status==='SETTLED').length,1);
  assert.equal(entries.filter(row=>row.paymentMethod==='CREDIT_CARD'&&row.status==='OPEN').length,2);
  assert.equal(entries.reduce((sum,row)=>sum+row.grossAmountCents,0),10000);
  assert.equal(fx.runtime.reports.buildSalesSummary().grossSalesCents,10000);
});

test('re-dispatching completed sale does not duplicate finance entries',async t=>{
  const fx=fixture(t);
  await fx.sale('idem',[{method:'PIX',amountCents:10000}]);
  assert.equal(saleEntries(fx.runtime,'idem').length,1);
  const second=await fx.runtime.dispatchPending();
  assert.equal(second.failed,0);
  assert.equal(saleEntries(fx.runtime,'idem').length,1);
});
