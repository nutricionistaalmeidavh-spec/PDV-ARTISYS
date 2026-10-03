'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

const actor={userId:'admin',role:'admin',terminalId:'PDV-01'};

test('restaurant session preserves waiter people customer through checkout and releases table after payment',async()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    runtime.modules.setEnabled('FOOD',true,actor);
    const user=runtime.catalog.createUser({
      id:'admin',
      username:'admin-session-context',
      name:'Admin Restaurante',
      role:'admin',
      password:'senha-forte-123'
    },actor);
    const customer=runtime.catalog.upsertCustomer({
      id:'customer-session-context',
      name:'Cliente da Mesa'
    },actor);
    const product=runtime.catalog.upsertProduct({
      id:'product-session-context',
      name:'Água da Casa',
      sku:'AGUA-CONTEXT',
      salePriceCents:700,
      costCents:200,
      trackStock:false,
      menuEnabled:true,
      usageType:'DIRECT'
    },actor);
    runtime.kitchen.configureProductRoute(product.id,{mode:'DIRECT'},actor);
    const table=runtime.restaurant.upsertTable({id:'table-session-context',label:'Mesa Contexto',seats:4},actor);

    const session=runtime.restaurant.openTable(table.id,{
      operatorId:user.id,
      waiterId:user.id,
      partySize:3,
      customerId:customer.id,
      actor
    });

    assert.equal(session.waiterId,user.id);
    assert.equal(session.partySize,3);
    assert.equal(session.customerId,customer.id);
    assert.equal(session.customerName,customer.name);

    runtime.restaurant.addOrder(session.id,{
      items:[{productId:product.id,quantity:2}],
      source:'DESKTOP',
      actor
    });
    await runtime.dispatchPending();

    const tableProjection=runtime.restaurant.listTables().find(item=>item.id===table.id);
    assert.equal(tableProjection.waiterId,user.id);
    assert.equal(tableProjection.partySize,3);
    assert.equal(tableProjection.customerId,customer.id);
    assert.equal(tableProjection.customerName,customer.name);

    runtime.cash.openSession({
      terminalId:'PDV-01',
      operatorId:user.id,
      initialCashCents:0,
      actor
    });

    const checkout=runtime.restaurant.checkoutToSale(session.id,{
      terminalId:'PDV-01',
      operatorId:user.id,
      actor
    },runtime.sales);

    assert.equal(checkout.sale.customerId,customer.id);
    assert.equal(checkout.sale.totalCents,1400);

    runtime.sales.completeSale(checkout.sale.id,{
      payments:[{method:'CASH',amountCents:1400}],
      actor
    });
    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failures.length,0,JSON.stringify(dispatch.failures));

    assert.equal(runtime.restaurant.getSession(session.id).status,'CLOSED');
    assert.equal(runtime.restaurant.listTables().find(item=>item.id===table.id).status,'FREE');
  }finally{
    runtime.close();
  }
});
