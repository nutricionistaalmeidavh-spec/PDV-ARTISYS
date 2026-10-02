'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

const admin={userId:'admin',role:'admin',terminalId:'T1'};
const manager={userId:'manager',role:'manager',terminalId:'T1'};
const cashier={userId:'cashier',role:'cashier',terminalId:'T1'};

function setup(){
  let seq=0;
  const runtime=createPdvRuntime({dbPath:':memory:',now:()=>`2026-10-02T21:30:${String(seq%60).padStart(2,'0')}.000Z`,idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.createUser({id:'admin',username:'admin-p3',name:'Admin',role:'admin',password:'senha-admin-p3-123'},admin);
  runtime.catalog.createUser({id:'manager',username:'manager-p3',name:'Gerente',role:'manager',password:'senha-manager-p3-123'},admin);
  runtime.catalog.createUser({id:'cashier',username:'cashier-p3',name:'Caixa',role:'cashier',password:'senha-cashier-p3-123'},admin);
  runtime.catalog.upsertCustomer({id:'customer',name:'Mercado Silva'},admin);
  runtime.catalog.upsertProduct({id:'product',name:'Refrigerante 2L',salePriceCents:1000,costCents:500,trackStock:true,menuEnabled:true},admin);
  runtime.inventory.move({productId:'product',type:'opening',quantityDelta:200,reason:'seed'},admin);
  runtime.cash.openSession({id:'cash-T1',terminalId:'T1',operatorId:'cashier',initialCashCents:0,actor:cashier});
  runtime.modules.setEnabled('WHOLESALE',true,admin);
  runtime.commercialPricing.upsertQuantityTier({productId:'product',minQuantity:6,unitPriceCents:900},manager);
  runtime.commercialPricing.upsertQuantityTier({productId:'product',minQuantity:12,unitPriceCents:800},manager);
  runtime.commercialPricing.upsertQuantityTier({productId:'product',minQuantity:24,unitPriceCents:700},manager);
  return runtime;
}

test('P3 applies the same quantity tiers in normal Balcao sales',()=>{
  const runtime=setup();
  try{
    const sale=runtime.sales.openSale({terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    let current=runtime.sales.addItem(sale.id,{productId:'product',quantity:5});
    assert.equal(current.items[0].unitPriceCents,1000);
    current=runtime.sales.updateItemQuantity(sale.id,'product',6);
    assert.equal(current.items[0].unitPriceCents,900);
    current=runtime.sales.updateItemQuantity(sale.id,'product',12);
    assert.equal(current.items[0].unitPriceCents,800);
    assert.equal(current.items[0].catalogUnitPriceCents,1000);
    current=runtime.sales.updateItemQuantity(sale.id,'product',24);
    assert.equal(current.items[0].unitPriceCents,700);
    current=runtime.sales.updateItemQuantity(sale.id,'product',2);
    assert.equal(current.items[0].unitPriceCents,1000);
  }finally{runtime.close();}
});

test('P3 creates human order number and cashier opens confirmed wholesale order without retyping items',async()=>{
  const runtime=setup();
  try{
    const quote=runtime.wholesale.createQuote({customerId:'customer',locationId:'MAIN',fulfillmentType:'PICKUP',items:[{productId:'product',quantity:12}]},manager);
    assert.match(quote.orderNumber,/^P-\d{6}$/);
    assert.equal(quote.items[0].unitPriceCents,800);
    runtime.wholesale.confirmOrder(quote.id,manager);

    const checkout=runtime.orders.prepareCheckout(quote.id,{terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    assert.equal(checkout.sale.status,'OPEN');
    assert.equal(checkout.sale.customerId,'customer');
    assert.equal(checkout.sale.items.length,1);
    assert.equal(checkout.sale.items[0].quantity,12);
    assert.equal(checkout.sale.items[0].unitPriceCents,800);
    assert.equal(checkout.sale.items[0].configuration.sourceDocument.orderNumber,quote.orderNumber);

    runtime.sales.completeSale(checkout.sale.id,{payments:[{method:'CASH',amountCents:9600}],actor:cashier});
    await runtime.dispatchPending();
    assert.equal(runtime.orders.getOrder(quote.id).status,'FULFILLED');
    assert.equal(runtime.sales.getSale(checkout.sale.id).status,'COMPLETED');
  }finally{runtime.close();}
});

test('P3 quoted price is immutable even if the product tier changes before checkout',()=>{
  const runtime=setup();
  try{
    const quote=runtime.wholesale.createQuote({customerId:'customer',locationId:'MAIN',fulfillmentType:'PICKUP',items:[{productId:'product',quantity:12}]},manager);
    assert.equal(quote.items[0].unitPriceCents,800);
    runtime.commercialPricing.upsertQuantityTier({productId:'product',minQuantity:12,unitPriceCents:750},manager);
    assert.equal(runtime.commercialPricing.resolveUnitPrice({productId:'product',quantity:12}).unitPriceCents,750);
    runtime.wholesale.confirmOrder(quote.id,manager);
    const checkout=runtime.orders.prepareCheckout(quote.id,{terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    assert.equal(checkout.sale.items[0].unitPriceCents,800);
  }finally{runtime.close();}
});

test('P3 quantity pricing is inactive when Atacado is disabled',()=>{
  const runtime=setup();
  try{
    runtime.modules.setEnabled('WHOLESALE',false,admin);
    const sale=runtime.sales.openSale({terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    const current=runtime.sales.addItem(sale.id,{productId:'product',quantity:24});
    assert.equal(current.items[0].unitPriceCents,1000);
  }finally{runtime.close();}
});
