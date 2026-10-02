'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

const admin={userId:'admin',role:'admin',terminalId:'PDV-01'};

test('new stock products and technical-sheet products are not added to Cardapio implicitly',()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});
  try{
    const stock=rt.catalog.upsertProduct({id:'coke',name:'Coca-Cola',salePriceCents:600,costCents:300,trackStock:true},admin);
    const ingredient=rt.catalog.upsertProduct({id:'bread',name:'Pao',salePriceCents:100,costCents:80,trackStock:true},admin);
    const prepared=rt.catalog.upsertProduct({id:'x-tudo',name:'X-Tudo',salePriceCents:2790,trackStock:false},admin);
    rt.recipes.setRecipe(prepared.id,{components:[{productId:ingredient.id,quantity:1,unit:'UN'}]},admin);
    assert.equal(stock.menuEnabled,false);
    assert.equal(prepared.menuEnabled,false);
    assert.ok(rt.recipes.getRecipe(prepared.id));
    const published=rt.catalog.upsertProduct({...stock,menuEnabled:true},admin);
    assert.equal(published.menuEnabled,true);
    assert.equal(rt.catalog.getProduct(prepared.id).menuEnabled,false);
  }finally{rt.close();}
});

test('updating stock data preserves explicit Cardapio membership unless menuEnabled is supplied',()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});
  try{
    const product=rt.catalog.upsertProduct({id:'water',name:'Agua',salePriceCents:500,trackStock:true,menuEnabled:true},admin);
    const updated=rt.catalog.upsertProduct({...product,salePriceCents:550,menuEnabled:undefined},admin);
    assert.equal(updated.menuEnabled,true);
    assert.equal(updated.salePriceCents,550);
  }finally{rt.close();}
});
