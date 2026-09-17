'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

const STAMP='2026-09-17T23:30:00.000Z';
function actor(){return{userId:'admin',role:'manager',terminalId:'PDV-FIN-REL'};}

function fixture(t,{persistent=false}={}){
  const dir=persistent?fs.mkdtempSync(path.join(os.tmpdir(),'pdv-fin-release-')):null;
  const dbPath=persistent?path.join(dir,'pdv.sqlite'):':memory:';
  let seq=0;
  const idFactory=prefix=>`${prefix}-${++seq}`;
  const open=()=>createPdvRuntime({dbPath,now:()=>STAMP,idFactory});
  let runtime=open();
  t.after(()=>{try{runtime?.close();}catch{}if(dir)fs.rmSync(dir,{recursive:true,force:true});});
  runtime.catalog.createUser({id:'admin',username:'admin-fin-rel',name:'Admin Finance Release',role:'manager',password:'QaLocalOnly-12345!'});
  runtime.catalog.createUser({id:'seller',username:'seller-fin-rel',name:'Vendedor Finance Release',role:'cashier',password:'QaLocalOnly-12345!'});
  runtime.catalog.upsertCustomer({id:'customer',name:'Cliente Finance Release',document:'98765432100',creditLimitCents:100000,creditUsedCents:0,active:true});
  runtime.catalog.upsertCategory({id:'cat',name:'Finance Release'});
  runtime.catalog.upsertProduct({id:'prod',categoryId:'cat',sku:'FIN-REL-1',name:'Produto Finance Release',salePriceCents:10000,costCents:3000,trackStock:true,minimumStock:0});
  runtime.inventory.move({productId:'prod',type:'opening',quantityDelta:100,reason:'Saldo release'});
  runtime.cash.openSession({id:'cash',terminalId:'PDV-FIN-REL',operatorId:'admin',initialCashCents:0,actor:actor()});

  async function completeSale(id,payments){
    runtime.sales.openSale({id,saleNumber:`REL-${id}`,terminalId:'PDV-FIN-REL',operatorId:'admin',sellerId:'seller',customerId:'customer'},actor());
    runtime.sales.addItem(id,{productId:'prod',quantity:1});
    runtime.sales.completeSale(id,{payments,actor:actor(),mutationId:`complete-${id}`});
    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failed,0,JSON.stringify(dispatch));
    return runtime.sales.getSaleDetails(id);
  }

  return{
    get runtime(){return runtime;},set runtime(value){runtime=value;},open,completeSale,dbPath
  };
}

function bySale(runtime,saleId){return runtime.finance.listEntries({sourceType:'SALE',saleId});}
function byReturn(runtime,returnId){return runtime.finance.listEntries({sourceType:'RETURN',sourceId:returnId});}

test('P9 release gate covers cash pix credit and mixed payment projections',async t=>{
  const fx=fixture(t);
  await fx.completeSale('cash',[{method:'CASH',amountCents:10000}]);
  await fx.completeSale('pix',[{method:'PIX',amountCents:10000}]);
  fx.runtime.settings.set('finance.acquiring.credit.feeBps',300,{actor:actor()});
  await fx.completeSale('credit',[{method:'CREDIT_CARD',amountCents:10000,metadata:{installments:2}}]);
  await fx.completeSale('mixed',[{method:'CASH',amountCents:4000},{method:'CREDIT_CARD',amountCents:6000,metadata:{installments:2}}]);

  const cash=bySale(fx.runtime,'cash');
  assert.equal(cash.length,1);assert.equal(cash[0].status,'SETTLED');assert.equal(cash[0].settledCents,10000);
  const pix=bySale(fx.runtime,'pix');
  assert.equal(pix.length,1);assert.equal(pix[0].status,'SETTLED');assert.equal(pix[0].paymentMethod,'PIX');
  const credit=bySale(fx.runtime,'credit');
  assert.equal(credit.length,2);assert.equal(credit.reduce((s,r)=>s+r.grossAmountCents,0),10000);assert.equal(credit.reduce((s,r)=>s+r.feeAmountCents,0),300);assert.ok(credit.every(r=>r.status==='OPEN'));
  const mixed=bySale(fx.runtime,'mixed');
  assert.equal(mixed.length,3);assert.equal(mixed.reduce((s,r)=>s+r.grossAmountCents,0),10000);assert.equal(mixed.filter(r=>r.paymentMethod==='CASH'&&r.status==='SETTLED').length,1);assert.equal(mixed.filter(r=>r.paymentMethod==='CREDIT_CARD'&&r.status==='OPEN').length,2);
});

test('P9/P10 cancel and return lifecycle preserves audit trail and correct net finance',async t=>{
  const fx=fixture(t);
  const sale=await fx.completeSale('returnable',[{method:'CASH',amountCents:10000}]);
  const [original]=bySale(fx.runtime,'returnable');
  fx.runtime.returns.createReturn({id:'ret-partial',saleId:sale.id,terminalId:'PDV-FIN-REL',operatorId:'admin',reason:'Release parcial',items:[{saleItemId:sale.items[0].id,quantity:0.5}],refunds:[{method:'CASH',amountCents:5000}],actor:actor(),mutationId:'ret-partial'});
  assert.equal((await fx.runtime.dispatchPending()).failed,0);
  const [partial]=byReturn(fx.runtime,'ret-partial');
  assert.equal(partial.kind,'PAYABLE');assert.equal(partial.status,'SETTLED');assert.equal(partial.originalEntryId,original.id);assert.equal(partial.grossAmountCents,5000);
  let report=fx.runtime.reports.buildFinanceSummary();
  assert.equal(report.receivableSettledCents,10000);assert.equal(report.payableSettledCents,5000);assert.equal(report.netSettledCents,5000);

  fx.runtime.returns.cancelReturn('ret-partial',{reason:'Release desfaz devolução',actor:actor(),mutationId:'cancel-ret-partial'});
  assert.equal((await fx.runtime.dispatchPending()).failed,0);
  assert.equal(byReturn(fx.runtime,'ret-partial')[0].status,'CANCELLED');
  report=fx.runtime.reports.buildFinanceSummary();
  assert.equal(report.netSettledCents,10000);

  fx.runtime.sales.cancelSale('returnable',{reason:'Release cancela venda',actor:actor(),mutationId:'cancel-sale-release'});
  assert.equal((await fx.runtime.dispatchPending()).failed,0);
  const [cancelled]=bySale(fx.runtime,'returnable');
  assert.equal(cancelled.status,'CANCELLED');assert.equal(cancelled.settledCents,0);assert.equal(fx.runtime.finance.listBySource('SALE','returnable').length,1,'audit trail must remain');
  report=fx.runtime.reports.buildFinanceSummary();
  assert.equal(report.netSettledCents,0);
});

test('P10 business-origin idempotency survives replay with a distinct event identity',t=>{
  const fx=fixture(t);
  const input={kind:'RECEIVABLE',description:'Replay release',category:'Release',amountCents:2500,dueAt:STAMP,sourceType:'SALE',sourceId:'sale-replay-release',sourceLineKey:'payment-replay-release',paymentMethod:'PIX',grossAmountCents:2500,feeAmountCents:0,netAmountCents:2500};
  const first=fx.runtime.finance.createSourceEntry(input,actor());
  const replay=fx.runtime.finance.createSourceEntry({...input,description:'Replay com outro evento'},actor());
  assert.equal(replay.id,first.id);
  assert.equal(fx.runtime.finance.listBySource('SALE','sale-replay-release').length,1);
});

test('P10 finance effects and origin links survive real SQLite restart',async t=>{
  const fx=fixture(t,{persistent:true});
  await fx.completeSale('persist',[{method:'PIX',amountCents:10000}]);
  const before=bySale(fx.runtime,'persist');
  assert.equal(before.length,1);assert.equal(before[0].status,'SETTLED');
  fx.runtime.close();
  fx.runtime=fx.open();
  const after=bySale(fx.runtime,'persist');
  assert.equal(after.length,1);assert.equal(after[0].status,'SETTLED');assert.equal(after[0].saleId,'persist');assert.equal(after[0].sellerId,'seller');assert.equal(after[0].customerId,'customer');
  const report=fx.runtime.reports.buildFinanceSummary({sellerId:'seller'});
  assert.equal(report.netSettledCents,10000);assert.equal(report.sourceBreakdown.SALE.settledCents,10000);
});
