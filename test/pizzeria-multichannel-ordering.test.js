'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const admin={userId:'pizza-admin',profileId:'profile-administrator',terminalId:'PDV-01'};
function headers(device,mutationId){return{'x-device-id':device.id,'x-device-key':device.credential,'content-type':'application/json',...(mutationId?{'x-mutation-id':mutationId}:{})};}

function seed(rt){
  rt.modules.setEnabled('FOOD',true,{kind:'system',id:'system'});
  const user=rt.catalog.createUser({id:'pizza-admin',username:'pizza-admin',name:'Garçom Pizza',profileId:'profile-administrator',password:'Pizza-123456!'},admin);
  rt.catalog.upsertProduct({id:'pizza',name:'Pizza da Casa',salePriceCents:3000,trackStock:false,menuEnabled:true},admin);
  const station=rt.kitchen.upsertStation({id:'pizza-kitchen',name:'Pizzaria',printEnabled:false},admin);
  rt.kitchen.assignProduct('pizza',station.id,admin);
  rt.restaurant.upsertTable({id:'mesa-08',label:'Mesa 08',seats:4},admin);
  rt.restaurant.upsertTable({id:'mesa-09',label:'Mesa 09',seats:4},admin);
  rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
  rt.pizzeria.upsertSize({id:'large',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500,recipeMultiplier:1},admin);
  rt.pizzeria.upsertFlavor({id:'cal',productId:'pizza',name:'Calabresa',priceDeltaCents:400},admin);
  rt.pizzeria.upsertFlavor({id:'mar',productId:'pizza',name:'Marguerita',priceDeltaCents:200},admin);
  rt.pizzeria.upsertCrust({id:'cat',productId:'pizza',name:'Catupiry',priceDeltaCents:600},admin);
  return user;
}

test('waiter and QR receive the same safe pizza composer and server ignores forged client price',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});let server;
  try{
    const user=seed(rt);
    const waiter=rt.mobileDevices.createDevice({id:'waiter-pizza',name:'Garçom Pizza',deviceType:'WAITER',userId:user.id},admin);
    server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'pizza-local'});
    const address=await server.start();const base=`http://${address.host}:${address.port}`;

    const waiterContext=await fetch(`${base}/api/v1/mobile/context`,{headers:headers(waiter)});
    assert.equal(waiterContext.status,200);
    const waiterProduct=(await waiterContext.json()).products.find(row=>row.id==='pizza');
    assert.equal(waiterProduct.pizza.sizes[0].name,'Grande');
    assert.equal(waiterProduct.pizza.flavors.length,2);
    assert.equal('recipeProductId' in waiterProduct.pizza.flavors[0],false);
    assert.equal('stockItems' in waiterProduct.pizza,false);

    const opened=await fetch(`${base}/api/v1/mobile/tables/mesa-08/open`,{method:'POST',headers:headers(waiter,'open-pizza'),body:JSON.stringify({partySize:2})});
    const session=await opened.json();
    const requestItem={productId:'pizza',quantity:1,unitPriceCents:1,pizza:{sizeId:'large',flavorIds:['cal','mar'],crustId:'cat'}};
    const waiterOrder=await fetch(`${base}/api/v1/mobile/orders`,{method:'POST',headers:headers(waiter,'waiter-pizza-order'),body:JSON.stringify({sessionId:session.id,items:[requestItem]})});
    assert.equal(waiterOrder.status,201);
    const waiterSaved=(await waiterOrder.json()).order.items[0];
    assert.equal(waiterSaved.unitPriceCents,4500);
    assert.equal(waiterSaved.configuration.pizza.displayLabel,'Grande · ½ Calabresa + ½ Marguerita · Borda Catupiry');

    const access=rt.publicOrdering.issueTableAccess('mesa-09',admin);
    const publicContext=await fetch(`${base}/api/v1/public/menu/${access.token}`);
    assert.equal(publicContext.status,200);
    const publicProduct=(await publicContext.json()).products.find(row=>row.id==='pizza');
    assert.deepEqual(publicProduct.pizza,waiterProduct.pizza);

    const qrOrder=await fetch(`${base}/api/v1/public/menu/${access.token}/orders`,{method:'POST',headers:{'content-type':'application/json','x-mutation-id':'qr-pizza-order'},body:JSON.stringify({items:[requestItem]})});
    assert.equal(qrOrder.status,201);
    const qrSaved=(await qrOrder.json()).order.items[0];
    assert.equal(qrSaved.unitPriceCents,4500);
    assert.equal(qrSaved.configuration.pizza.displayLabel,waiterSaved.configuration.pizza.displayLabel);
  }finally{if(server)await server.stop();rt.close();}
});

test('pizza configuration survives waiter -> KDS -> checkout sale canonically',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});let server;
  try{
    const user=seed(rt);
    const waiter=rt.mobileDevices.createDevice({id:'waiter-pizza-2',name:'Garçom Pizza',deviceType:'WAITER',userId:user.id},admin);
    server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'pizza-local-2'});
    const address=await server.start();const base=`http://${address.host}:${address.port}`;
    const opened=await fetch(`${base}/api/v1/mobile/tables/mesa-08/open`,{method:'POST',headers:headers(waiter,'open-pizza-2'),body:JSON.stringify({partySize:2})});
    const session=await opened.json();
    const pizza={sizeId:'large',flavorIds:['cal','mar'],crustId:'cat'};
    const response=await fetch(`${base}/api/v1/mobile/orders`,{method:'POST',headers:headers(waiter,'order-pizza-2'),body:JSON.stringify({sessionId:session.id,items:[{productId:'pizza',quantity:1,pizza}]})});
    assert.equal(response.status,201);
    const order=(await response.json()).order;

    const ticket=rt.kitchen.listTickets().find(row=>row.orderId===order.id);
    assert.equal(ticket.items[0].configuration.pizza.displayLabel,'Grande · ½ Calabresa + ½ Marguerita · Borda Catupiry');

    const checkout=rt.restaurant.checkoutToSale(session.id,{terminalId:'PDV-01',operatorId:user.id,actor:admin},rt.sales);
    assert.equal(checkout.sale.totalCents,4500);
    assert.equal(checkout.sale.items[0].configuration.pizza.displayLabel,ticket.items[0].configuration.pizza.displayLabel);
  }finally{if(server)await server.stop();rt.close();}
});
