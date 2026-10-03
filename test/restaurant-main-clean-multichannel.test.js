'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const admin={userId:'admin-clean',role:'admin',terminalId:'PDV-01'};

function headers(device,mutationId){
  return {
    'x-device-id':device.id,
    'x-device-key':device.credential,
    'content-type':'application/json',
    ...(mutationId?{'x-mutation-id':mutationId}:{})
  };
}

test('garçom tablet e QR compartilham configuração, observação e produção canônicas',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});let server;
  try{
    rt.modules.setEnabled('FOOD',true,{kind:'system',id:'system'});
    const user=rt.catalog.createUser({id:'admin-clean',username:'admin-clean',name:'Garçom QA',role:'admin',password:'Qa-Clean-12345!'},admin);
    const customer=rt.catalog.upsertCustomer({id:'customer-clean',name:'Cliente Multicanal'},admin);
    const product=rt.catalog.upsertProduct({id:'burger-clean',name:'Burger Multicanal',salePriceCents:2000,trackStock:false,menuEnabled:true,usageType:'DIRECT'},admin);
    const group=rt.catalogCustomization.upsertOptionGroup({id:'extras-clean',name:'Extras',selectionType:'MULTIPLE',minSelections:0,maxSelections:2},admin);
    const option=rt.catalogCustomization.upsertOption({id:'bacon-clean',groupId:group.id,name:'Bacon',priceDeltaCents:300},admin);
    rt.catalogCustomization.linkGroupToProduct(product.id,group.id,{required:false,sortOrder:1},admin);
    const station=rt.kitchen.upsertStation({id:'kitchen-clean',name:'Cozinha Multi'},admin);
    rt.kitchen.assignProduct(product.id,station.id,admin);
    for(const [id,label] of [['tw','Mesa Garçom'],['tt','Mesa Tablet'],['tq','Mesa QR']])rt.restaurant.upsertTable({id,label,seats:4},admin);

    const waiter=rt.mobileDevices.createDevice({id:'waiter-clean',name:'Garçom Multi',deviceType:'WAITER',userId:user.id},admin);
    const tablet=rt.mobileDevices.createDevice({id:'tablet-clean',name:'Tablet Multi',deviceType:'TABLET',tableId:'tt'},admin);
    rt.restaurant.openTable('tt',{operatorId:user.id,waiterId:user.id,partySize:2,actor:admin});

    server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'local-clean'});
    const address=await server.start();
    const base=`http://${address.host}:${address.port}`;

    const waiterContext=await fetch(`${base}/api/v1/mobile/context`,{headers:headers(waiter)});
    assert.equal(waiterContext.status,200);
    const waiterData=await waiterContext.json();
    assert.ok(waiterData.customers.some(row=>row.id===customer.id));
    assert.ok(waiterData.products.find(row=>row.id===product.id).configuration.groups.some(row=>row.id===group.id));

    const opened=await fetch(`${base}/api/v1/mobile/tables/tw/open`,{
      method:'POST',
      headers:headers(waiter,'open-clean'),
      body:JSON.stringify({partySize:4,customerId:customer.id})
    });
    assert.equal(opened.status,201);
    const waiterSession=await opened.json();
    assert.equal(waiterSession.partySize,4);
    assert.equal(waiterSession.customerId,customer.id);

    const configuredItem={productId:product.id,quantity:1,selections:[option.id],note:'sem cebola'};
    for(const [device,mutation,note] of [
      [waiter,'waiter-clean-order','sem cebola'],
      [tablet,'tablet-clean-order','molho a parte']
    ]){
      const response=await fetch(`${base}/api/v1/mobile/orders`,{
        method:'POST',
        headers:headers(device,mutation),
        body:JSON.stringify(device===waiter?{sessionId:waiterSession.id,items:[{...configuredItem,note}]}:{items:[{...configuredItem,note}]})
      });
      assert.equal(response.status,201);
    }

    const access=rt.publicOrdering.issueTableAccess('tq',admin);
    const qrOrder=await fetch(`${base}/api/v1/public/menu/${access.token}/orders`,{
      method:'POST',
      headers:{'content-type':'application/json','x-mutation-id':'qr-clean-order'},
      body:JSON.stringify({items:[{...configuredItem,note:'bem passado'}]})
    });
    assert.equal(qrOrder.status,201);

    const sessions=['tw','tt','tq'].map(id=>rt.restaurant.currentSession(id));
    assert.deepEqual(sessions.map(session=>session.orders.length),[1,1,1]);
    const items=sessions.map(session=>session.orders[0].items[0]);
    assert.deepEqual(items.map(item=>item.unitPriceCents),[2300,2300,2300]);
    assert.deepEqual(items.map(item=>item.note),['sem cebola','molho a parte','bem passado']);
    assert.equal(rt.kitchen.listTickets().length,3);

    const mobileComposer=await fetch(`${base}/mobile/order-composer.js`);
    const menuComposer=await fetch(`${base}/menu/order-composer.js`);
    assert.equal(mobileComposer.status,200);
    assert.equal(menuComposer.status,200);
    assert.equal(await mobileComposer.text(),await menuComposer.text());
  }finally{
    if(server)await server.stop();
    rt.close();
  }
});
