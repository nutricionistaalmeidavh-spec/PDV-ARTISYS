'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const admin={userId:'admin',role:'admin',terminalId:'PDV-01'};

function deviceHeaders(device,mutationId){
  return{
    'x-device-id':device.id,
    'x-device-key':device.credential,
    'content-type':'application/json',
    ...(mutationId?{'x-mutation-id':mutationId}:{})
  };
}

test('garcom tablet e QR compartilham configuracao observacao e producao canonicas',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});let server;
  try{
    rt.modules.setEnabled('FOOD',true,admin);
    const user=rt.catalog.createUser({id:'admin',username:'admin-multi',name:'Garcom QA',role:'admin',password:'senha-forte-123'},admin);
    const customer=rt.catalog.upsertCustomer({id:'customer-multi',name:'Cliente Multicanal'},admin);
    const product=rt.catalog.upsertProduct({id:'burger-multi',name:'Burger Multicanal',salePriceCents:2000,trackStock:false,menuEnabled:true,usageType:'DIRECT'},admin);
    const group=rt.catalogCustomization.upsertOptionGroup({id:'extras-multi',name:'Extras',selectionType:'MULTIPLE',minSelections:0,maxSelections:2},admin);
    const option=rt.catalogCustomization.upsertOption({id:'bacon-multi',groupId:group.id,name:'Bacon',priceDeltaCents:300},admin);
    rt.catalogCustomization.linkGroupToProduct(product.id,group.id,{required:false,sortOrder:1},admin);
    const station=rt.kitchen.upsertStation({id:'kitchen-multi',name:'Cozinha Multi'},admin);
    rt.kitchen.assignProduct(product.id,station.id,admin);
    for(const [id,label] of [['tw','Mesa Garcom'],['tt','Mesa Tablet'],['tq','Mesa QR']])rt.restaurant.upsertTable({id,label,seats:4},admin);

    const waiter=rt.mobileDevices.createDevice({id:'waiter-multi',name:'Garcom Multi',deviceType:'WAITER',userId:user.id},admin);
    const tablet=rt.mobileDevices.createDevice({id:'tablet-multi',name:'Tablet Multi',deviceType:'TABLET',tableId:'tt'},admin);
    rt.restaurant.openTable('tt',{operatorId:user.id,waiterId:user.id,partySize:2,actor:admin});

    server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'local-multi'});
    const address=await server.start();const base=`http://${address.host}:${address.port}`;

    const waiterContext=await fetch(`${base}/api/v1/mobile/context`,{headers:deviceHeaders(waiter)});
    assert.equal(waiterContext.status,200);
    const waiterData=await waiterContext.json();
    assert.ok(waiterData.customers.some(row=>row.id===customer.id));
    assert.ok(waiterData.products.find(row=>row.id===product.id).configuration.groups.some(row=>row.id===group.id));

    const opened=await fetch(`${base}/api/v1/mobile/tables/tw/open`,{
      method:'POST',headers:deviceHeaders(waiter,'open-waiter-multi'),
      body:JSON.stringify({partySize:4,customerId:customer.id})
    });
    assert.equal(opened.status,201);
    const waiterSession=await opened.json();
    assert.equal(waiterSession.partySize,4);
    assert.equal(waiterSession.customerId,customer.id);

    const configuredItem={productId:product.id,quantity:1,selections:[option.id],note:'sem cebola'};
    const waiterOrder=await fetch(`${base}/api/v1/mobile/orders`,{
      method:'POST',headers:deviceHeaders(waiter,'waiter-order-multi'),
      body:JSON.stringify({sessionId:waiterSession.id,items:[configuredItem]})
    });
    assert.equal(waiterOrder.status,201);

    const tabletOrder=await fetch(`${base}/api/v1/mobile/orders`,{
      method:'POST',headers:deviceHeaders(tablet,'tablet-order-multi'),
      body:JSON.stringify({items:[{...configuredItem,note:'molho a parte'}]})
    });
    assert.equal(tabletOrder.status,201);

    const access=rt.publicOrdering.issueTableAccess('tq',admin);
    const publicContext=await fetch(`${base}/api/v1/public/menu/${access.token}`);
    assert.equal(publicContext.status,200);
    const publicData=await publicContext.json();
    assert.ok(publicData.products.find(row=>row.id===product.id).configuration.groups.some(row=>row.id===group.id));

    const qrOrder=await fetch(`${base}/api/v1/public/menu/${access.token}/orders`,{
      method:'POST',headers:{'content-type':'application/json','x-mutation-id':'qr-order-multi'},
      body:JSON.stringify({items:[{...configuredItem,note:'bem passado'}]})
    });
    assert.equal(qrOrder.status,201);

    const sessions=['tw','tt','tq'].map(id=>rt.restaurant.currentSession(id));
    assert.deepEqual(sessions.map(session=>session.orders.length),[1,1,1]);
    const items=sessions.map(session=>session.orders[0].items[0]);
    assert.deepEqual(items.map(item=>item.unitPriceCents),[2300,2300,2300]);
    assert.deepEqual(items.map(item=>item.configuration.options[0].id),[option.id,option.id,option.id]);
    assert.deepEqual(items.map(item=>item.note),['sem cebola','molho a parte','bem passado']);
    assert.equal(rt.kitchen.listTickets().length,3);

    const mobileComposer=await fetch(`${base}/mobile/order-composer.js`);
    const menuComposer=await fetch(`${base}/menu/order-composer.js`);
    assert.equal(mobileComposer.status,200);assert.equal(menuComposer.status,200);
    assert.equal(await mobileComposer.text(),await menuComposer.text());
  }finally{if(server)await server.stop();rt.close();}
});
