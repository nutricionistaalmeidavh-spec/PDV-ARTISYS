'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const { createPdvRuntime }=require('../js/core/pdv-runtime');

function actor(){return{userId:'admin',role:'manager',terminalId:'PDV-QA'};}

function fixture(t,{stamp='2026-09-17T12:00:00.000Z'}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-integrity-'));
  const dbPath=path.join(dir,'pdv.sqlite');
  let seq=0;
  const idFactory=prefix=>`${prefix}-${++seq}`;
  const open=()=>createPdvRuntime({dbPath,now:()=>stamp,idFactory,receiptOptions:{storeName:'ArtiSys QA'}});
  let runtime=open();
  t.after(()=>{try{runtime?.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});

  runtime.catalog.createUser({id:'admin',username:'qaadmin',name:'QA Administrador',role:'manager',password:'QaLocalOnly-12345!'});
  runtime.catalog.createUser({id:'seller',username:'qavendedor',name:'QA Vendedor',role:'cashier',password:'QaLocalOnly-12345!'});
  runtime.catalog.upsertCategory({id:'cat',name:'QA Categoria'});
  runtime.catalog.upsertProduct({id:'p1',categoryId:'cat',sku:'QA-001',barcode:'7890000000001',name:'QA Produto',salePriceCents:1000,costCents:400,trackStock:true,minimumStock:1});
  runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:10,reason:'Saldo QA'});
  runtime.commissions.upsertRule({sellerId:'seller',productId:'p1',commissionBps:1000},actor());
  runtime.cash.openSession({id:'cash1',terminalId:'PDV-QA',operatorId:'admin',initialCashCents:5000,actor:actor()});

  async function completeSale(id='sale1'){
    await runtime.dispatchPending();
    runtime.sales.openSale({id,saleNumber:`QA-${id}`,terminalId:'PDV-QA',operatorId:'admin',sellerId:'seller'},actor());
    runtime.sales.addItem(id,{productId:'p1',quantity:2});
    runtime.sales.completeSale(id,{payments:[{method:'CASH',amountCents:2000}],actor:actor(),mutationId:`complete-${id}`});
    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failed,0);
    return runtime.sales.getSaleDetails(id);
  }

  return {
    get runtime(){return runtime;},
    set runtime(value){runtime=value;},
    dbPath,idFactory,open,completeSale,
  };
}

test('completed sale feeds history, stock, cash, finance, reports, commission and print queue consistently',async t=>{
  const fx=fixture(t);
  const sale=await fx.completeSale();
  const runtime=fx.runtime;

  assert.equal(sale.status,'COMPLETED');
  assert.equal(sale.totalCents,2000);
  assert.equal(sale.payments.length,1);
  assert.equal(sale.payments[0].amountCents,2000);

  const history=runtime.sales.listHistory({status:'COMPLETED',sellerId:'seller'});
  assert.equal(history.length,1);
  assert.equal(history[0].id,'sale1');
  assert.equal(runtime.inventory.getBalance('p1'),8);

  const cashMoves=runtime.cash.listSessionMovements('cash1').filter(row=>row.type==='SALE'&&row.saleId==='sale1');
  assert.equal(cashMoves.length,1);
  assert.equal(cashMoves[0].amountCents,2000);

  const financeEntries=runtime.finance.listEntries({sourceType:'SALE',saleId:'sale1'});
  assert.equal(financeEntries.length,1);
  assert.equal(financeEntries[0].paymentMethod,'CASH');
  assert.equal(financeEntries[0].status,'SETTLED');
  assert.equal(financeEntries[0].settledCents,2000);
  const financeReport=runtime.reports.buildFinanceSummary();
  assert.equal(financeReport.netSettledCents,2000);
  assert.equal(financeReport.sourceBreakdown.SALE.settledCents,2000);

  const report=runtime.reports.buildSalesSummary();
  assert.equal(report.salesCount,1);
  assert.equal(report.grossSalesCents,2000);
  assert.equal(report.netSalesCents,2000);
  assert.equal(report.paymentsByMethod.CASH,2000);
  assert.equal(report.topProducts.find(row=>row.productId==='p1')?.quantity,2);
  assert.equal(report.sellers.find(row=>row.sellerId==='seller')?.salesCents,2000);

  const commissions=runtime.commissions.report({sellerId:'seller'});
  assert.equal(commissions.totalEarnedCents,200);
  assert.equal(runtime.commissions.outstanding('seller'),200);

  const jobs=runtime.printing.listJobs({entityType:'sale',entityId:'sale1'});
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].type,'SALE_RECEIPT');
  assert.equal(jobs[0].status,'PENDING');
  assert.match(String(jobs[0].payload?.text||''),/QA Produto/);

  assert.equal((await runtime.outbox.listPending(100)).length,0);
});

test('return reverses stock, cash, finance, reports and commission without duplicating side effects',async t=>{
  const fx=fixture(t);
  const sale=await fx.completeSale();
  const runtime=fx.runtime;
  const saleItemId=sale.items[0].id;

  const returned=runtime.returns.createReturn({
    id:'return1',saleId:'sale1',terminalId:'PDV-QA',operatorId:'admin',reason:'QA devolução parcial',
    items:[{saleItemId,quantity:1}],refunds:[{method:'CASH',amountCents:1000}],actor:actor()
  });
  assert.equal(returned.totalCents,1000);
  let dispatch=await runtime.dispatchPending();
  assert.equal(dispatch.failed,0);

  assert.equal(runtime.inventory.getBalance('p1'),9);
  const reversals=runtime.cash.listSessionMovements('cash1').filter(row=>row.type==='REVERSAL'&&row.returnId===returned.id);
  assert.equal(reversals.length,1);
  assert.equal(reversals[0].amountCents,1000);

  const financeReturns=runtime.finance.listEntries({sourceType:'RETURN',sourceId:'return1'});
  assert.equal(financeReturns.length,1);
  assert.equal(financeReturns[0].kind,'PAYABLE');
  assert.equal(financeReturns[0].status,'SETTLED');
  assert.equal(financeReturns[0].grossAmountCents,1000);
  assert.equal(runtime.reports.buildFinanceSummary().netSettledCents,1000);

  const report=runtime.reports.buildSalesSummary();
  assert.equal(report.grossSalesCents,2000);
  assert.equal(report.returnedCents,1000);
  assert.equal(report.netSalesCents,1000);
  assert.equal(report.sellers.find(row=>row.sellerId==='seller')?.salesCents,1000);

  const commissions=runtime.commissions.report({sellerId:'seller'});
  assert.equal(commissions.totalEarnedCents,200);
  assert.equal(commissions.totalReversedCents,100);
  assert.equal(runtime.commissions.outstanding('seller'),100);

  dispatch=await runtime.dispatchPending();
  assert.equal(dispatch.failed,0);
  assert.equal(runtime.inventory.getBalance('p1'),9);
  assert.equal(runtime.cash.listSessionMovements('cash1').filter(row=>row.type==='REVERSAL'&&row.returnId===returned.id).length,1);
  assert.equal(runtime.finance.listEntries({sourceType:'RETURN',sourceId:'return1'}).length,1);
  assert.equal(runtime.commissions.outstanding('seller'),100);
});

test('completed sale cancellation restores inventory, cash and finance and reverses commission once',async t=>{
  const fx=fixture(t);
  await fx.completeSale();
  const runtime=fx.runtime;

  runtime.sales.cancelSale('sale1',{reason:'QA cancelamento pós-venda',actor:actor(),mutationId:'cancel-sale1'});
  let dispatch=await runtime.dispatchPending();
  assert.equal(dispatch.failed,0);

  assert.equal(runtime.sales.getSaleDetails('sale1').status,'CANCELLED');
  assert.equal(runtime.inventory.getBalance('p1'),10);
  const reversals=runtime.cash.listSessionMovements('cash1').filter(row=>row.type==='REVERSAL'&&row.saleId==='sale1');
  assert.equal(reversals.length,1);
  assert.equal(reversals[0].amountCents,2000);

  const [financeEntry]=runtime.finance.listEntries({sourceType:'SALE',saleId:'sale1'});
  assert.equal(financeEntry.status,'CANCELLED');
  assert.equal(financeEntry.settledCents,0);
  assert.equal(runtime.reports.buildFinanceSummary().netSettledCents,0);

  const report=runtime.reports.buildSalesSummary();
  assert.equal(report.salesCount,0);
  assert.equal(report.netSalesCents,0);
  assert.equal(report.cancelledSalesCount,1);
  assert.equal(report.cancelledSalesCents,2000);
  assert.equal(runtime.commissions.outstanding('seller'),0);
  assert.equal(runtime.printing.listJobs({entityType:'sale',entityId:'sale1'}).length,1,'original receipt must remain auditable');

  dispatch=await runtime.dispatchPending();
  assert.equal(dispatch.failed,0);
  assert.equal(runtime.inventory.getBalance('p1'),10);
  assert.equal(runtime.cash.listSessionMovements('cash1').filter(row=>row.type==='REVERSAL'&&row.saleId==='sale1').length,1);
  assert.equal(runtime.finance.listBySource('SALE','sale1').length,1);
  assert.equal(runtime.commissions.outstanding('seller'),0);
});

test('suspend and resume preserve one canonical sale and apply side effects only on completion',async t=>{
  const fx=fixture(t);
  const runtime=fx.runtime;
  await runtime.dispatchPending();

  runtime.sales.openSale({id:'sale-suspended',saleNumber:'QA-SUSP',terminalId:'PDV-QA',operatorId:'admin',sellerId:'seller'},actor());
  runtime.sales.addItem('sale-suspended',{productId:'p1',quantity:2});
  runtime.sales.suspendSale('sale-suspended');
  assert.equal(runtime.sales.getSale('sale-suspended').status,'SUSPENDED');
  assert.equal(runtime.inventory.getBalance('p1'),10);
  assert.equal(runtime.cash.listSessionMovements('cash1').filter(row=>row.saleId==='sale-suspended').length,0);
  assert.equal(runtime.finance.listEntries({sourceType:'SALE',saleId:'sale-suspended'}).length,0);
  assert.equal(runtime.printing.listJobs({entityType:'sale',entityId:'sale-suspended'}).length,0);

  runtime.sales.resumeSale('sale-suspended');
  runtime.sales.completeSale('sale-suspended',{payments:[{method:'PIX',amountCents:2000}],actor:actor(),mutationId:'complete-suspended'});
  const dispatch=await runtime.dispatchPending();
  assert.equal(dispatch.failed,0);

  assert.equal(runtime.sales.getSaleDetails('sale-suspended').status,'COMPLETED');
  assert.equal(runtime.sales.listHistory({status:'COMPLETED'}).filter(row=>row.id==='sale-suspended').length,1);
  assert.equal(runtime.inventory.getBalance('p1'),8);
  assert.equal(runtime.cash.listSessionMovements('cash1').filter(row=>row.type==='SALE'&&row.saleId==='sale-suspended').length,1);
  const [financeEntry]=runtime.finance.listEntries({sourceType:'SALE',saleId:'sale-suspended'});
  assert.equal(financeEntry.paymentMethod,'PIX');
  assert.equal(financeEntry.status,'SETTLED');
  assert.equal(financeEntry.settledCents,2000);
  assert.equal(runtime.printing.listJobs({entityType:'sale',entityId:'sale-suspended'}).length,1);
  assert.equal(runtime.reports.buildSalesSummary().paymentsByMethod.PIX,2000);
});

test('price override plus discount stays consistent in history, finance, report and commission base',async t=>{
  const fx=fixture(t);
  const runtime=fx.runtime;
  await runtime.dispatchPending();

  runtime.sales.openSale({id:'sale-price',saleNumber:'QA-PRICE',terminalId:'PDV-QA',operatorId:'admin',sellerId:'seller'},actor());
  let sale=runtime.sales.addItem('sale-price',{productId:'p1',quantity:2});
  const itemId=sale.items[0].id;
  sale=runtime.sales.overrideItemPrice('sale-price',itemId,{unitPriceCents:1200,reason:'QA preço negociado',actor:actor()});
  assert.equal(sale.items[0].catalogUnitPriceCents,1000);
  assert.equal(sale.items[0].unitPriceCents,1200);
  runtime.sales.applyDiscount('sale-price',{discountCents:400});
  runtime.sales.completeSale('sale-price',{payments:[{method:'CASH',amountCents:2000}],actor:actor(),mutationId:'complete-price'});
  const dispatch=await runtime.dispatchPending();
  assert.equal(dispatch.failed,0);

  sale=runtime.sales.getSaleDetails('sale-price');
  assert.equal(sale.subtotalCents,2400);
  assert.equal(sale.discountCents,400);
  assert.equal(sale.totalCents,2000);
  assert.equal(sale.items[0].catalogUnitPriceCents,1000);
  assert.equal(sale.items[0].unitPriceCents,1200);
  assert.equal(sale.items[0].priceOverrideReason,'QA preço negociado');
  assert.equal(sale.items[0].commissionBaseCents,2000);
  assert.equal(sale.items[0].commissionCents,200);

  const [financeEntry]=runtime.finance.listEntries({sourceType:'SALE',saleId:'sale-price'});
  assert.equal(financeEntry.grossAmountCents,2000);
  assert.equal(financeEntry.netAmountCents,2000);
  assert.equal(financeEntry.settledCents,2000);

  const report=runtime.reports.buildSalesSummary();
  assert.equal(report.grossSalesCents,2000);
  assert.equal(report.paymentsByMethod.CASH,2000);
  assert.equal(report.sellers.find(row=>row.sellerId==='seller')?.salesCents,2000);
  assert.equal(runtime.commissions.outstanding('seller'),200);
});

test('completed business effects including finance survive a real runtime restart on the same database',async t=>{
  const fx=fixture(t);
  await fx.completeSale();
  const before=fx.runtime.reports.buildSalesSummary();
  assert.equal(before.netSalesCents,2000);
  assert.equal(fx.runtime.reports.buildFinanceSummary().netSettledCents,2000);

  fx.runtime.close();
  fx.runtime=fx.open();
  const runtime=fx.runtime;

  assert.equal(runtime.sales.getSaleDetails('sale1').status,'COMPLETED');
  assert.equal(runtime.inventory.getBalance('p1'),8);
  assert.equal(runtime.cash.listSessionMovements('cash1').filter(row=>row.type==='SALE'&&row.saleId==='sale1').length,1);
  const [financeEntry]=runtime.finance.listEntries({sourceType:'SALE',saleId:'sale1'});
  assert.equal(financeEntry.status,'SETTLED');
  assert.equal(financeEntry.settledCents,2000);
  assert.equal(runtime.reports.buildFinanceSummary().netSettledCents,2000);
  assert.equal(runtime.reports.buildSalesSummary().netSalesCents,2000);
  assert.equal(runtime.commissions.outstanding('seller'),200);
  assert.equal(runtime.printing.listJobs({entityType:'sale',entityId:'sale1'}).length,1);
  assert.equal((await runtime.outbox.listPending(100)).length,0);
});
