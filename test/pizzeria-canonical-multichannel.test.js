'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const admin={userId:'admin-pizza',profileId:'profile-administrator',terminalId:'PDV-01'};

function seedPizza(rt){
  rt.modules.setEnabled('FOOD',true,{kind:'system',id:'system'});
  rt.catalog.createUser({id:admin.userId,username:'admin-pizza',name:'Admin Pizza',profileId:'profile-administrator',password:'Pizza-Canonica-123!'},admin);
  const products=[
    ['pizza','Pizza da Casa',3000,false,true],
    ['base-massa','Massa',0,true,false],
    ['base-molho','Molho de tomate',0,true,false],
    ['recipe-cal','Receita sabor Calabresa',0,false,false],
    ['calabresa','Calabresa',0,true,false],
    ['cebola','Cebola',0,true,false],
    ['recipe-mar','Receita sabor Marguerita',0,false,false],
    ['mussarela','Mussarela',0,true,false],
    ['tomate','Tomate',0,true,false],
    ['manjericao','Manjericão',0,true,false],
    ['recipe-cat','Receita borda Catupiry',0,false,false],
    ['catupiry','Catupiry',0,true,false]
  ];
  for(const [id,name,salePriceCents,trackStock,menuEnabled] of products){
    rt.catalog.upsertProduct({id,name,salePriceCents,costCents:0,trackStock,menuEnabled,active:true,unit:trackStock?'KG':'UN'},admin);
  }
  for(const id of ['base-massa','base-molho','calabresa','cebola','mussarela','tomate','manjericao','catupiry']){
    rt.inventory.move({productId:id,type:'opening',quantityDelta:10,reason:'seed pizza canônica'},admin);
  }
  rt.recipes.setRecipe('pizza',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'base-massa',quantity:1,unit:'KG'},
    {productId:'base-molho',quantity:0.2,unit:'KG'}
  ]},admin);
  rt.recipes.setRecipe('recipe-cal',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'calabresa',quantity:0.2,unit:'KG'},
    {productId:'cebola',quantity:0.05,unit:'KG'}
  ]},admin);
  rt.recipes.setRecipe('recipe-mar',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'mussarela',quantity:0.2,unit:'KG'},
    {productId:'tomate',quantity:0.1,unit:'KG'},
    {productId:'manjericao',quantity:0.01,unit:'KG'}
  ]},admin);
  rt.recipes.setRecipe('recipe-cat',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'catupiry',quantity:0.15,unit:'KG'}
  ]},admin);

  rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
  rt.pizzeria.upsertSize({id:'grande',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500,recipeMultiplier:1.5},admin);
  rt.pizzeria.upsertFlavor({id:'cal',productId:'pizza',name:'Calabresa',priceDeltaCents:400,recipeProductId:'recipe-cal'},admin);
  rt.pizzeria.upsertFlavor({id:'mar',productId:'pizza',name:'Marguerita',priceDeltaCents:200,recipeProductId:'recipe-mar'},admin);
  rt.pizzeria.upsertCrust({id:'cat',productId:'pizza',name:'Catupiry',priceDeltaCents:600,recipeProductId:'recipe-cat'},admin);

  const station=rt.kitchen.upsertStation({id:'cozinha-pizza',name:'Cozinha Pizza',printEnabled:false},admin);
  rt.kitchen.configureProductRoute('pizza',{mode:'PRODUCTION',stationId:station.id},admin);
}

function genericSelection(){
  return{variantId:null,selections:['grande','cal','mar','cat'],comboSelections:[]};
}

test('canonical pizza pricing freezes proportional recipe consumption through KDS checkout and stock',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});
  try{
    seedPizza(rt);
    const config=rt.orderConfiguration.getProductConfiguration('pizza');
    assert.equal(config.configurationKind,'PIZZA');
    assert.equal(config.variants.length,0);
    assert.equal(config.groups.find(group=>group.name==='Tamanho').options[0].name,'Grande');
    assert.equal(config.groups.find(group=>group.name==='Sabores').maxSelectionsBySize.grande,2);

    const priced=rt.orderConfiguration.priceConfiguredItem({productId:'pizza',...genericSelection()});
    assert.equal(priced.unitPriceCents,4500);
    assert.deepEqual(priced.configurationSnapshot.pizza.flavors.map(row=>[row.name,row.fraction]),[['Calabresa',0.5],['Marguerita',0.5]]);
    const stock=Object.fromEntries(priced.configurationSnapshot.pizza.stockItems.map(row=>[row.productId,row.quantity]));
    assert.deepEqual(stock,{
      'base-massa':1.5,'base-molho':0.3,calabresa:0.15,cebola:0.0375,
      mussarela:0.15,tomate:0.075,manjericao:0.0075,catupiry:0.225
    });

    rt.restaurant.upsertTable({id:'mesa-pizza',label:'Mesa Pizza'},admin);
    const session=rt.restaurant.openTable('mesa-pizza',{operatorId:admin.userId,actor:admin});
    const order=rt.restaurant.addOrder(session.id,{items:[{
      productId:'pizza',quantity:1,unitPriceCents:priced.unitPriceCents,configurationSnapshot:priced.configurationSnapshot
    }],actor:admin});
    assert.equal(order.items[0].configuration.pizza.size.name,'Grande');

    const dispatched=await rt.dispatchPending();
    assert.equal(dispatched.failures.length,0,JSON.stringify(dispatched.failures));
    const ticket=rt.kitchen.listTickets().find(row=>row.orderId===order.id);
    assert.equal(ticket.items[0].configuration.pizza.crust.name,'Catupiry');

    const checkout=rt.restaurant.checkoutToSale(session.id,{terminalId:'PDV-01',operatorId:admin.userId,actor:admin},rt.sales);
    assert.equal(checkout.sale.totalCents,4500);
    assert.deepEqual(checkout.sale.items[0].configuration.pizza.stockItems,priced.configurationSnapshot.pizza.stockItems);

    rt.sales.completeSale(checkout.sale.id,{payments:[{method:'PIX',amountCents:4500}],actor:admin});
    const finalDispatch=await rt.dispatchPending();
    assert.equal(finalDispatch.failures.length,0,JSON.stringify(finalDispatch.failures));
    for(const [productId,used] of Object.entries(stock)){
      assert.equal(rt.inventory.getBalance(productId),Number((10-used).toFixed(4)),productId);
    }
  }finally{rt.close();}
});

test('waiter and QR consume the same generic pizza configuration and ignore client price tampering',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});let server;
  try{
    seedPizza(rt);
    rt.restaurant.upsertTable({id:'waiter-table',label:'Mesa Garçom'},admin);
    rt.restaurant.upsertTable({id:'qr-table',label:'Mesa QR'},admin);
    const waiter=rt.mobileDevices.createDevice({id:'waiter-pizza',name:'Garçom Pizza',deviceType:'WAITER',userId:admin.userId},admin);
    const waiterHeaders={'x-device-id':waiter.id,'x-device-key':waiter.credential,'content-type':'application/json'};

    server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'local-pizza'});
    const address=await server.start();const base=`http://${address.host}:${address.port}`;

    let response=await fetch(`${base}/api/v1/mobile/context`,{headers:waiterHeaders});
    assert.equal(response.status,200);
    const context=await response.json();
    const waiterPizza=context.products.find(row=>row.id==='pizza');
    assert.equal(waiterPizza.configuration.configurationKind,'PIZZA');
    assert.equal(waiterPizza.configuration.variants.length,0);
    assert.deepEqual(waiterPizza.configuration.groups.find(row=>row.name==='Tamanho').options.map(row=>row.name),['Grande']);
    assert.deepEqual(waiterPizza.configuration.groups.find(row=>row.name==='Sabores').options.map(row=>row.name),['Calabresa','Marguerita']);
    assert.equal(JSON.stringify(waiterPizza).includes('recipeProductId'),false);
    assert.equal(JSON.stringify(waiterPizza).includes('stockItems'),false);

    response=await fetch(`${base}/api/v1/mobile/tables/waiter-table/open`,{
      method:'POST',headers:{...waiterHeaders,'x-mutation-id':'open-pizza'},body:JSON.stringify({partySize:2})
    });
    assert.equal(response.status,201);
    const session=await response.json();

    response=await fetch(`${base}/api/v1/mobile/orders`,{
      method:'POST',headers:{...waiterHeaders,'x-mutation-id':'waiter-pizza-order'},
      body:JSON.stringify({sessionId:session.id,items:[{productId:'pizza',quantity:1,...genericSelection(),unitPriceCents:1}]})
    });
    assert.equal(response.status,201);
    const waiterOrder=(await response.json()).order;
    assert.equal(waiterOrder.totalCents,4500);
    assert.equal(waiterOrder.items[0].configuration.pizza.size.name,'Grande');

    const access=rt.publicOrdering.issueTableAccess('qr-table',admin);
    response=await fetch(`${base}/api/v1/public/menu/${access.token}`);
    assert.equal(response.status,200);
    const publicContext=await response.json();
    const qrPizza=publicContext.products.find(row=>row.id==='pizza');
    assert.deepEqual(qrPizza.configuration,waiterPizza.configuration);

    response=await fetch(`${base}/api/v1/public/menu/${access.token}/orders`,{
      method:'POST',headers:{'content-type':'application/json','x-mutation-id':'qr-pizza-order'},
      body:JSON.stringify({items:[{productId:'pizza',quantity:1,...genericSelection(),unitPriceCents:1}]})
    });
    assert.equal(response.status,201);
    const qrOrder=(await response.json()).order;
    assert.equal(qrOrder.totalCents,4500);
    assert.equal(qrOrder.items[0].configuration.pizza.crust.name,'Catupiry');
  }finally{if(server)await server.stop();rt.close();}
});
