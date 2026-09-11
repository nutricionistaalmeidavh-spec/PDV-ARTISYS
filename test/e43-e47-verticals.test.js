'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const { createPdvRuntime }=require('../js/core/pdv-runtime');

function ids(){let n=0;return prefix=>`${prefix}-${++n}`;}
const admin={userId:'admin-1',role:'admin',terminalId:'pdv-1'};
function runtime(){return createPdvRuntime({dbPath:':memory:',idFactory:ids(),now:(()=>{let i=0;return()=>`2026-09-11T01:${String(Math.floor(i/60)).padStart(2,'0')}:${String(i++%60).padStart(2,'0')}.000Z`;})()});}
function seed(rt){
  rt.catalog.createUser({id:'admin-1',username:'admin',name:'Admin',role:'admin',password:'1234567890'},admin);
  rt.catalog.upsertProduct({id:'pizza',name:'Pizza',salePriceCents:3000,trackStock:false},admin);
  rt.catalog.upsertProduct({id:'burger',name:'Burger',salePriceCents:2000,trackStock:false},admin);
  rt.catalog.upsertProduct({id:'soda',name:'Refrigerante',salePriceCents:700,trackStock:true},admin);
  rt.catalog.upsertProduct({id:'ham',name:'Presunto kg',salePriceCents:4000,unit:'KG',trackStock:true},admin);
  rt.inventory.move({productId:'soda',type:'opening',quantityDelta:100,reason:'seed'},admin);
  rt.inventory.move({productId:'ham',type:'opening',quantityDelta:50,reason:'seed'},admin);
}

test('E43 pizzeria supports size, multi-flavor policy and crust only when module enabled',()=>{
  const rt=runtime();seed(rt);
  assert.throws(()=>rt.pizzeria.upsertProfile({productId:'pizza'} ,admin),/Modulo PIZZERIA desativado/);
  rt.modules.setEnabled('PIZZERIA',true,admin);
  rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
  const size=rt.pizzeria.upsertSize({id:'large',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500},admin);
  rt.pizzeria.upsertFlavor({id:'calabresa',productId:'pizza',name:'Calabresa',priceDeltaCents:400},admin);
  rt.pizzeria.upsertFlavor({id:'marguerita',productId:'pizza',name:'Marguerita',priceDeltaCents:200},admin);
  rt.pizzeria.upsertCrust({id:'catupiry',productId:'pizza',name:'Borda Catupiry',priceDeltaCents:600},admin);
  const priced=rt.pizzeria.pricePizza({productId:'pizza',sizeId:size.id,flavorIds:['calabresa','marguerita'],crustId:'catupiry'});
  assert.equal(priced.unitPriceCents,4500);
  assert.equal(priced.configurationSnapshot.pizza.flavors.length,2);
  assert.throws(()=>rt.pizzeria.pricePizza({productId:'pizza',sizeId:'large',flavorIds:['calabresa','marguerita','calabresa']}),/maximo de 2 sabores/i);
  rt.close();
});

test('E44 advanced restaurant can split items and apply service charge into canonical sales',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('RESTAURANT',true,admin);
  rt.restaurant.upsertTable({id:'t1',label:'1'},admin);const session=rt.restaurant.openTable('t1',{operatorId:'admin-1',actor:admin});
  const order=rt.restaurant.addOrder(session.id,{items:[{productId:'burger',quantity:2},{productId:'soda',quantity:1}],actor:admin});
  const burger=order.items.find(i=>i.productId==='burger');
  const result=rt.restaurantSettlement.createItemSettlement(session.id,{items:[{orderItemId:burger.id,quantity:1}],serviceChargePercent:10,terminalId:'pdv-1',operatorId:'admin-1'},admin);
  assert.equal(result.sale.totalCents,2200);
  assert.equal(rt.sales.getSale(result.sale.id).status,'OPEN');
  const balance=rt.restaurantSettlement.getRemainingBalance(session.id);
  assert.equal(balance.items.length,2);
  rt.close();
});

test('E45 delivery enforces lifecycle and keeps payment manual',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('DELIVERY',true,admin);
  const order=rt.delivery.create({customerName:'Ana',phone:'16999999999',fulfillmentType:'DELIVERY',address:{street:'Rua A',number:'10'},region:'Centro',feeCents:500,paymentMethod:'PIX'},admin);
  assert.equal(order.status,'NEW');assert.equal(order.feeCents,500);assert.equal(order.paymentMethod,'PIX');
  assert.throws(()=>rt.delivery.updateStatus(order.id,'DELIVERED',admin),/Transicao de delivery invalida/);
  rt.delivery.updateStatus(order.id,'PREPARING',admin);rt.delivery.updateStatus(order.id,'READY',admin);rt.delivery.updateStatus(order.id,'OUT_FOR_DELIVERY',admin);const done=rt.delivery.updateStatus(order.id,'DELIVERED',admin);
  assert.equal(done.status,'DELIVERED');
  rt.close();
});

test('E46 fast food generates daily sequential numbers and ready board projection',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('FAST_FOOD',true,admin);
  const a=rt.fastFood.create({note:'sem cebola'},admin);const b=rt.fastFood.create({},admin);
  assert.equal(a.dailyNumber,1);assert.equal(b.dailyNumber,2);
  rt.fastFood.updateStatus(a.id,'PREPARING',admin);rt.fastFood.updateStatus(a.id,'READY',admin);
  assert.deepEqual(rt.fastFood.readyBoard(),[{number:1,status:'READY'}]);
  rt.close();
});

test('E47 market/bakery prices grams, parses configured labels and manages bakery pickup',()=>{
  const rt=runtime();seed(rt);rt.modules.setEnabled('MARKET_BAKERY',true,admin);
  assert.equal(rt.marketBakery.priceWeightedItem({productId:'ham',grams:250}).totalCents,1000);
  rt.marketBakery.upsertWeightBarcodeProfile({id:'scale-1',name:'Balanca',prefix:'20',totalLength:13,productStart:2,productLength:5,weightStart:7,weightLength:5,decimalPlaces:3},admin);
  const parsed=rt.marketBakery.parseWeightBarcode('2000123002500');
  assert.equal(parsed.productCode,'00123');assert.equal(parsed.weight,2.5);
  const bakery=rt.marketBakery.createBakeryOrder({customerName:'Bia',requestedPickupAt:'2026-09-12T10:00:00-03:00',items:[{productId:'soda',quantity:2}]},admin);
  assert.equal(bakery.status,'OPEN');assert.equal(rt.marketBakery.updateBakeryOrderStatus(bakery.id,'READY',admin).status,'READY');
  rt.close();
});
