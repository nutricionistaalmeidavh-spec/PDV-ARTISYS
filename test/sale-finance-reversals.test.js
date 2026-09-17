'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

function actor(){return{userId:'admin',role:'manager',terminalId:'PDV-FIN-REV'};}

function fixture(t,{priceCents=5000,quantity=2,stamp='2026-09-17T20:00:00.000Z',dbPath=':memory:'}={}){
  let seq=0;
  const idFactory=prefix=>`${prefix}-${++seq}`;
  const open=()=>createPdvRuntime({dbPath,now:()=>stamp,idFactory});
  let runtime=open();
  t.after(()=>{try{runtime?.close();}catch{}});
  runtime.catalog.createUser({id:'admin',username:'admin-rev',name:'Admin Reversoes',role:'manager',password:'QaLocalOnly-12345!'});
  runtime.catalog.upsertCategory({id:'cat-rev',name:'Finance reversoes'});
  runtime.catalog.upsertProduct({id:'prod-rev',categoryId:'cat-rev',sku:'REV-1',barcode:'7891234567800',name:'Produto Reversao',salePriceCents:priceCents,costCents:1000,trackStock:true,minimumStock:0});
  runtime.inventory.move({productId:'prod-rev',type:'opening',quantityDelta:20,reason:'Saldo'});
  runtime.cash.openSession({id:'cash-rev',terminalId:'PDV-FIN-REV',operatorId:'admin',initialCashCents:10000,actor:actor()});

  async function completeSale(id,payments,{itemsQuantity=quantity}={}){
    await runtime.dispatchPending();
    runtime.sales.openSale({id,saleNumber:`REV-${id}`,terminalId:'PDV-FIN-REV',operatorId:'admin'},actor());
    runtime.sales.addItem(id,{productId:'prod-rev',quantity:itemsQuantity});
    runtime.sales.completeSale(id,{payments,actor:actor(),mutationId:`complete-${id}`});
    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failed,0,JSON.stringify(dispatch));
    return runtime.sales.getSaleDetails(id);
  }

  async function createReturn({id,saleId,saleItemId,quantity:returnedQuantity,refunds}){
    const result=runtime.returns.createReturn({
      id,saleId,terminalId:'PDV-FIN-REV',operatorId:'admin',reason:`QA ${id}`,
      items:[{saleItemId,quantity:returnedQuantity}],refunds,actor:actor(),mutationId:`return-${id}`
    });
    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failed,0,JSON.stringify(dispatch));
    return result;
  }

  return{
    get runtime(){return runtime;},
    set runtime(value){runtime=value;},
    open,completeSale,createReturn
  };
}

function entriesBySource(runtime,sourceType,sourceId){
  return runtime.finance.listEntries({}).filter(row=>row.sourceType===sourceType&&row.sourceId===sourceId);
}

function settlementRows(runtime,entryId){
  return runtime.db.prepare('SELECT * FROM financial_settlements WHERE entry_id=? ORDER BY created_at,id').all(String(entryId));
}

test('P3 cancelling a settled cash sale reverses settlement then cancels finance entry exactly once',async t=>{
  const fx=fixture(t);
  await fx.completeSale('sale-cash',[{method:'CASH',amountCents:10000}]);
  let [entry]=entriesBySource(fx.runtime,'SALE','sale-cash');
  assert.equal(entry.status,'SETTLED');
  assert.equal(entry.settlements.length,1);

  fx.runtime.sales.cancelSale('sale-cash',{reason:'Cancelamento QA',actor:actor(),mutationId:'cancel-sale-cash'});
  let dispatch=await fx.runtime.dispatchPending();
  assert.equal(dispatch.failed,0,JSON.stringify(dispatch));

  [entry]=entriesBySource(fx.runtime,'SALE','sale-cash');
  assert.equal(entry.status,'CANCELLED');
  assert.equal(entry.settledCents,0);
  assert.equal(entry.settlements.length,0);
  const rows=settlementRows(fx.runtime,entry.id);
  assert.equal(rows.length,1);
  assert.ok(rows[0].reversed_at);

  dispatch=await fx.runtime.dispatchPending();
  assert.equal(dispatch.failed,0);
  assert.equal(entriesBySource(fx.runtime,'SALE','sale-cash').length,1);
  assert.equal(settlementRows(fx.runtime,entry.id).length,1);
});

test('P3 cancelling an open credit sale cancels every installment without deleting audit history',async t=>{
  const fx=fixture(t);
  fx.runtime.settings.set('finance.acquiring.credit.feeBps',300,{actor:actor()});
  await fx.completeSale('sale-credit',[{method:'CREDIT_CARD',amountCents:10000,metadata:{installments:2}}]);
  let entries=entriesBySource(fx.runtime,'SALE','sale-credit');
  assert.equal(entries.length,2);
  assert.ok(entries.every(row=>row.status==='OPEN'));

  fx.runtime.sales.cancelSale('sale-credit',{reason:'Cancelamento cartão',actor:actor(),mutationId:'cancel-sale-credit'});
  const dispatch=await fx.runtime.dispatchPending();
  assert.equal(dispatch.failed,0,JSON.stringify(dispatch));

  entries=entriesBySource(fx.runtime,'SALE','sale-credit');
  assert.equal(entries.length,2);
  assert.ok(entries.every(row=>row.status==='CANCELLED'));
  assert.equal(entries.reduce((sum,row)=>sum+row.grossAmountCents,0),10000);
});

test('P4 partial cash return creates a settled linked reversal and preserves original sale entry',async t=>{
  const fx=fixture(t);
  const sale=await fx.completeSale('sale-return',[{method:'CASH',amountCents:10000}]);
  const [original]=entriesBySource(fx.runtime,'SALE','sale-return');
  assert.equal(original.status,'SETTLED');

  await fx.createReturn({id:'return-partial',saleId:'sale-return',saleItemId:sale.items[0].id,quantity:1,refunds:[{method:'CASH',amountCents:5000}]});
  const reversals=entriesBySource(fx.runtime,'RETURN','return-partial');
  assert.equal(reversals.length,1);
  assert.equal(reversals[0].kind,'PAYABLE');
  assert.equal(reversals[0].status,'SETTLED');
  assert.equal(reversals[0].paymentMethod,'CASH');
  assert.equal(reversals[0].grossAmountCents,5000);
  assert.equal(reversals[0].netAmountCents,5000);
  assert.equal(reversals[0].originalEntryId,original.id);
  assert.equal(fx.runtime.finance.getEntry(original.id).status,'SETTLED');

  const summary=fx.runtime.finance.getSummary();
  assert.equal(summary.receivableSettledCents-summary.payableSettledCents,5000);
});

test('P4 full card return reverses gross fee and net across linked installments',async t=>{
  const fx=fixture(t);
  fx.runtime.settings.set('finance.acquiring.credit.feeBps',300,{actor:actor()});
  const sale=await fx.completeSale('sale-card-return',[{method:'CREDIT_CARD',amountCents:10000,metadata:{installments:2}}]);
  const originals=entriesBySource(fx.runtime,'SALE','sale-card-return');
  assert.equal(originals.length,2);
  assert.equal(originals.reduce((sum,row)=>sum+row.feeAmountCents,0),300);

  await fx.createReturn({id:'return-card-full',saleId:'sale-card-return',saleItemId:sale.items[0].id,quantity:2,refunds:[{method:'CREDIT_CARD',amountCents:10000}]});
  const reversals=entriesBySource(fx.runtime,'RETURN','return-card-full');
  assert.equal(reversals.reduce((sum,row)=>sum+row.grossAmountCents,0),10000);
  assert.equal(reversals.reduce((sum,row)=>sum+row.feeAmountCents,0),300);
  assert.equal(reversals.reduce((sum,row)=>sum+row.netAmountCents,0),9700);
  assert.ok(reversals.every(row=>row.kind==='PAYABLE'&&row.status==='SETTLED'));
  assert.deepEqual(new Set(reversals.map(row=>row.originalEntryId)),new Set(originals.map(row=>row.id)));
});

test('P4 mixed refund prefers same payment method then falls back without exceeding original gross',async t=>{
  const fx=fixture(t);
  const sale=await fx.completeSale('sale-mixed',[{method:'CASH',amountCents:4000},{method:'CREDIT_CARD',amountCents:6000,metadata:{installments:2}}]);
  const originals=entriesBySource(fx.runtime,'SALE','sale-mixed');
  const cashOriginal=originals.find(row=>row.paymentMethod==='CASH');
  const cardOriginals=originals.filter(row=>row.paymentMethod==='CREDIT_CARD');

  await fx.createReturn({id:'return-mixed-1',saleId:'sale-mixed',saleItemId:sale.items[0].id,quantity:1,refunds:[{method:'CASH',amountCents:5000}]});
  const first=entriesBySource(fx.runtime,'RETURN','return-mixed-1');
  assert.equal(first.reduce((sum,row)=>sum+row.grossAmountCents,0),5000);
  assert.equal(first.find(row=>row.originalEntryId===cashOriginal.id)?.grossAmountCents,4000);
  assert.equal(first.filter(row=>cardOriginals.some(card=>card.id===row.originalEntryId)).reduce((sum,row)=>sum+row.grossAmountCents,0),1000);
  assert.ok(first.every(row=>row.paymentMethod==='CASH'));

  await fx.createReturn({id:'return-mixed-2',saleId:'sale-mixed',saleItemId:sale.items[0].id,quantity:1,refunds:[{method:'CREDIT_CARD',amountCents:5000}]});
  const allReturns=[...entriesBySource(fx.runtime,'RETURN','return-mixed-1'),...entriesBySource(fx.runtime,'RETURN','return-mixed-2')];
  assert.equal(allReturns.reduce((sum,row)=>sum+row.grossAmountCents,0),10000);
  for(const original of originals){
    const reversed=allReturns.filter(row=>row.originalEntryId===original.id).reduce((sum,row)=>sum+row.grossAmountCents,0);
    assert.ok(reversed<=original.grossAmountCents,`${original.id} over-reversed`);
  }
});

test('P4 cancelling a return reverses refund settlements and cancels only its reversal entries',async t=>{
  const fx=fixture(t);
  const sale=await fx.completeSale('sale-return-cancel',[{method:'PIX',amountCents:10000}]);
  const [original]=entriesBySource(fx.runtime,'SALE','sale-return-cancel');
  await fx.createReturn({id:'return-cancel',saleId:'sale-return-cancel',saleItemId:sale.items[0].id,quantity:1,refunds:[{method:'PIX',amountCents:5000}]});
  let [reversal]=entriesBySource(fx.runtime,'RETURN','return-cancel');
  assert.equal(reversal.status,'SETTLED');

  fx.runtime.returns.cancelReturn('return-cancel',{reason:'Devolução cancelada QA',actor:actor(),mutationId:'cancel-return-cancel'});
  const dispatch=await fx.runtime.dispatchPending();
  assert.equal(dispatch.failed,0,JSON.stringify(dispatch));

  [reversal]=entriesBySource(fx.runtime,'RETURN','return-cancel');
  assert.equal(reversal.status,'CANCELLED');
  assert.equal(reversal.settledCents,0);
  assert.ok(settlementRows(fx.runtime,reversal.id)[0].reversed_at);
  assert.equal(fx.runtime.finance.getEntry(original.id).status,'SETTLED');
  const summary=fx.runtime.finance.getSummary();
  assert.equal(summary.receivableSettledCents-summary.payableSettledCents,10000);
});

test('P3/P4 finance reversals survive a real runtime restart',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-fin-rev-'));
  const dbPath=path.join(dir,'pdv.sqlite');
  let seq=0;
  const idFactory=prefix=>`${prefix}-${++seq}`;
  const open=()=>createPdvRuntime({dbPath,now:()=> '2026-09-17T20:00:00.000Z',idFactory});
  let runtime=open();
  t.after(()=>{try{runtime?.close();}catch{}fs.rmSync(dir,{recursive:true,force:true});});
  runtime.catalog.createUser({id:'admin',username:'admin-persist-rev',name:'Admin',role:'manager',password:'QaLocalOnly-12345!'});
  runtime.catalog.upsertCategory({id:'cat',name:'Persistência reversão'});
  runtime.catalog.upsertProduct({id:'p',categoryId:'cat',sku:'P-REV',name:'Produto',salePriceCents:5000,costCents:1000,trackStock:true,minimumStock:0});
  runtime.inventory.move({productId:'p',type:'opening',quantityDelta:10,reason:'Saldo'});
  runtime.cash.openSession({id:'cash',terminalId:'PDV-FIN-REV',operatorId:'admin',initialCashCents:0,actor:actor()});
  runtime.sales.openSale({id:'sale-persist',saleNumber:'REV-PERSIST',terminalId:'PDV-FIN-REV',operatorId:'admin'},actor());
  runtime.sales.addItem('sale-persist',{productId:'p',quantity:2});
  runtime.sales.completeSale('sale-persist',{payments:[{method:'CASH',amountCents:10000}],actor:actor(),mutationId:'complete-persist'});
  assert.equal((await runtime.dispatchPending()).failed,0);
  const sale=runtime.sales.getSaleDetails('sale-persist');
  runtime.returns.createReturn({id:'return-persist',saleId:'sale-persist',terminalId:'PDV-FIN-REV',operatorId:'admin',reason:'Persistir',items:[{saleItemId:sale.items[0].id,quantity:1}],refunds:[{method:'CASH',amountCents:5000}],actor:actor()});
  assert.equal((await runtime.dispatchPending()).failed,0);
  runtime.close();
  runtime=open();

  assert.equal(entriesBySource(runtime,'SALE','sale-persist').length,1);
  const reversals=entriesBySource(runtime,'RETURN','return-persist');
  assert.equal(reversals.length,1);
  assert.equal(reversals[0].status,'SETTLED');
  assert.equal(reversals[0].grossAmountCents,5000);
});
