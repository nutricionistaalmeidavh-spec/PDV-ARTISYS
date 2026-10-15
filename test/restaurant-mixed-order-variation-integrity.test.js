'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {renderTablePreBill}=require('../js/domains/printing/non-fiscal-renderer');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};
function fixture(){
  let next=10000;
  const runtime=createPdvRuntime({dbPath:':memory:',now:()=> '2026-10-15T12:00:00.000Z',idFactory:prefix=>prefix+'-'+String(next--)});
  runtime.modules.setEnabled('FOOD',true,admin);
  runtime.catalog.createUser({id:'admin',username:'admin',name:'Administrador',profileId:'profile-administrator',password:'senha-forte-123'},admin);
  for(const [id,name,price] of [
    ['fries','Porção de fritas',0],['soda','Coca lata',200],['juice','Suco',1400],['water','Água',200]
  ]){
    runtime.catalog.upsertProduct({id,name,salePriceCents:price,menuEnabled:true,trackStock:false,usageType:'DIRECT',active:true},admin);
    runtime.kitchen.configureProductRoute(id,{mode:'DIRECT'},admin);
  }
  runtime.catalogCustomization.upsertVariant({id:'fries-small',productId:'fries',name:'150g',priceDeltaCents:1000},admin);
  runtime.catalogCustomization.upsertVariant({id:'fries-large',productId:'fries',name:'300g',priceDeltaCents:1800},admin);
  runtime.catalogCustomization.upsertVariant({id:'juice-strawberry',productId:'juice',name:'Morango',priceDeltaCents:100},admin);
  runtime.restaurant.upsertTable({id:'t1',label:'Mesa 1'},admin);
  const token=runtime.publicOrdering.issueTableAccess('t1',admin).token;
  return{runtime,token,close:()=>runtime.close()};
}

test('public multi-item QR order preserves price and variation for EACH inserted product even with inverse randomized IDs',()=>{
  const {runtime:rt,token,close}=fixture();
  try{
    const result=rt.publicOrdering.submitOrder(token,{items:[
      {productId:'fries',quantity:1,variantId:'fries-small',note:'sem queijo'},
      {productId:'soda',quantity:2},
      {productId:'juice',quantity:1,variantId:'juice-strawberry'},
      {productId:'fries',quantity:1,variantId:'fries-large'}
    ]});
    assert.equal(result.items.length,4);
    assert.equal(result.totalCents,1000+400+1500+1800);
    // An ID-based sort intentionally returns a different order from insertion.
    assert.notDeepEqual(result.items.map(x=>x.productId),['fries','soda','juice','fries']);
    const fries=result.items.filter(x=>x.productId==='fries');
    assert.deepEqual(new Set(fries.map(x=>x.unitPriceCents)),new Set([1000,1800]));
    assert.equal(fries.find(x=>x.unitPriceCents===1000).configuration.variant.name,'150g');
    assert.equal(fries.find(x=>x.unitPriceCents===1000).note,'sem queijo');
    assert.equal(fries.find(x=>x.unitPriceCents===1800).configuration.variant.name,'300g');
    const soda=result.items.find(x=>x.productId==='soda');
    assert.equal(soda.unitPriceCents,200);
    assert.equal(soda.quantity,2);
    assert.equal(soda.configuration.variant,null);
    const juice=result.items.find(x=>x.productId==='juice');
    assert.equal(juice.unitPriceCents,1500);
    assert.equal(juice.configuration.variant.name,'Morango');
    const prebill=renderTablePreBill({storeName:'ArtiSys',session:rt.restaurant.currentSession('t1')});
    assert.match(prebill,/150g/);
    assert.match(prebill,/300g/);
    assert.match(prebill,/Morango/);
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS n FROM restaurant_orders').get().n,1);
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS n FROM restaurant_order_items').get().n,4);
  }finally{close();}
});

test('updating a variant with a different product ID never moves that variant to an unrelated item',()=>{
  const {runtime:rt,close}=fixture();
  try{
    assert.throws(()=>rt.catalogCustomization.upsertVariant({id:'fries-small',productId:'juice',name:'Variação indevida',priceDeltaCents:10},admin),/pertence a outro produto/);
    const current=rt.catalogCustomization.getProductConfiguration('fries').variants.find(v=>v.id==='fries-small');
    assert.equal(current.name,'150g');
    assert.equal(rt.catalogCustomization.getProductConfiguration('juice').variants.some(v=>v.id==='fries-small'),false);
  }finally{close();}
});

test('destination error identifies the exact unconfigured product and creates no order',()=>{
  const {runtime:rt,token,close}=fixture();
  try{
    rt.catalog.upsertProduct({id:'unrouted',name:'Batata sem destino',salePriceCents:600,menuEnabled:true,trackStock:false,usageType:'DIRECT'},admin);
    assert.throws(()=>rt.publicOrdering.submitOrder(token,{items:[{productId:'soda',quantity:1},{productId:'unrouted',quantity:1}]}),/Batata sem destino/);
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS n FROM restaurant_orders').get().n,0);
  }finally{close();}
});

test('customer cart reuses mutation key for retries and shows price and variation details',()=>{
  const script=fs.readFileSync(path.join(__dirname,'..','server/customer-menu/app.js'),'utf8');
  assert.match(script,/state\.pendingOrder\?\.signature!==signature/);
  assert.match(script,/mutationKey:state\.pendingOrder\.id/);
  assert.match(script,/function cartLineDetails/);
  assert.match(script,/Confira o preço zerado/);
});

test('inventory warns when no KDS exists and does not silently claim save after failed route persist',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','desktop/renderer/app.js'),'utf8');
  assert.match(source,/Nenhum setor KDS ativo/);
  assert.match(source,/savedProduct=saved/);
  assert.match(source,/api\.removeProduct\(savedProduct\.id\)/);
});
