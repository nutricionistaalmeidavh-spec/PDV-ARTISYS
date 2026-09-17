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

test('completed sale feeds history, stock, cash, reports, commission and print queue consistently',async t=>{
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

test('return reverses stock, cash, reports and commission without duplicating side effects',async t=>{
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
  assert.equal(runtime.commissions.outstanding('seller'),100);
});

test('completed business effects survive a real runtime restart on the same database',async t=>{
  const fx=fixture(t);
  await fx.completeSale();
  const before=fx.runtime.reports.buildSalesSummary();
  assert.equal(before.netSalesCents,2000);

  fx.runtime.close();
  fx.runtime=fx.open();
  const runtime=fx.runtime;

  assert.equal(runtime.sales.getSaleDetails('sale1').status,'COMPLETED');
  assert.equal(runtime.inventory.getBalance('p1'),8);
  assert.equal(runtime.cash.listSessionMovements('cash1').filter(row=>row.type==='SALE'&&row.saleId==='sale1').length,1);
  assert.equal(runtime.reports.buildSalesSummary().netSalesCents,2000);
  assert.equal(runtime.commissions.outstanding('seller'),200);
  assert.equal(runtime.printing.listJobs({entityType:'sale',entityId:'sale1'}).length,1);
  assert.equal((await runtime.outbox.listPending(100)).length,0);
});
