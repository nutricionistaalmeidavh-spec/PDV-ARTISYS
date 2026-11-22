'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

test('P1: venda com variacao igual soma quantidade, variacoes diferentes ficam separadas e totais corretos',()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});
  const actor={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};
  try{
    rt.catalog.createUser({id:'admin',username:'qty-admin',name:'Admin',profileId:'profile-administrator',password:'qty-admin-password'},actor);
    rt.catalog.upsertProduct({id:'pizza-qa',name:'3 sabores - 01',salePriceCents:1200,trackStock:false,active:true},actor);
    rt.sales.openSale({id:'qty-sale',saleNumber:'Q-001',terminalId:'PDV-01',operatorId:'admin'},actor);
    const same={productId:'pizza-qa',quantity:1,unitPriceCents:1200,configurationSnapshot:{variant:{id:'sabor-a',name:'Sabor A'}},mergeSameConfiguration:true};
    rt.sales.addItem('qty-sale',same);
    rt.sales.addItem('qty-sale',same);
    let sale=rt.sales.getSale('qty-sale');
    assert.equal(sale.items.length,1,'duas inclusoes da mesma variacao devem ocupar uma linha');
    assert.equal(sale.items[0].quantity,2);
    assert.equal(sale.totalCents,2400);
    rt.sales.addItem('qty-sale',{...same,configurationSnapshot:{variant:{id:'sabor-b',name:'Sabor B'}}});
    sale=rt.sales.getSale('qty-sale');
    assert.equal(sale.items.length,2,'variacoes diferentes nao podem ser mescladas');
    assert.equal(sale.totalCents,3600);
    rt.sales.updateItemQuantityById('qty-sale',sale.items.find(row=>row.quantity===2).id,3);
    assert.equal(rt.sales.getSale('qty-sale').totalCents,4800);
  }finally{rt.close();}
});
