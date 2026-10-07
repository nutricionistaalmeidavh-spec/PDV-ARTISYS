'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

function ids(){let n=0;return prefix=>`${prefix}-${++n}`;}
const admin={userId:'admin-1',profileId:'profile-administrator',terminalId:'PDV-01'};

function setup(){
  const rt=createPdvRuntime({dbPath:':memory:',idFactory:ids(),now:(()=>{let i=0;return()=>`2026-10-07T18:30:${String(i++%60).padStart(2,'0')}.000Z`;})()});
  rt.catalog.createUser({id:'admin-1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'1234567890'},admin);
  rt.modules.setEnabled('FOOD',true,admin);
  rt.catalog.upsertProduct({id:'pizza',name:'Pizza',salePriceCents:3000,trackStock:false,menuEnabled:true},admin);
  for(const [id,name,unit] of [
    ['dough','Massa','UN'],['sauce','Molho de tomate','LT'],['cheese','Mussarela','KG'],
    ['calabresa','Calabresa','KG'],['onion','Cebola','KG'],['tomato','Tomate','KG'],
    ['basil','Manjericao','KG'],['catupiry','Catupiry','KG']
  ])rt.catalog.upsertProduct({id,name,unit,salePriceCents:0,costCents:100,trackStock:true,menuEnabled:false,usageType:'INGREDIENT'},admin);
  for(const [id,name] of [['flavor-cal','Ficha Calabresa'],['flavor-mar','Ficha Marguerita'],['crust-cat','Ficha Borda Catupiry']]){
    rt.catalog.upsertProduct({id,name,salePriceCents:0,trackStock:false,menuEnabled:false},admin);
  }
  rt.recipes.setRecipe('pizza',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'dough',quantity:1},{productId:'sauce',quantity:.2,unit:'LT'},{productId:'cheese',quantity:.3,unit:'KG'}
  ]},admin);
  rt.recipes.setRecipe('flavor-cal',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'calabresa',quantity:.2,unit:'KG'},{productId:'onion',quantity:.05,unit:'KG'}
  ]},admin);
  rt.recipes.setRecipe('flavor-mar',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'tomato',quantity:.1,unit:'KG'},{productId:'basil',quantity:.02,unit:'KG'}
  ]},admin);
  rt.recipes.setRecipe('crust-cat',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'catupiry',quantity:.15,unit:'KG'}
  ]},admin);
  for(const id of ['dough','sauce','cheese','calabresa','onion','tomato','basil','catupiry']){
    rt.inventory.move({productId:id,type:'opening',quantityDelta:10,reason:'seed'},admin);
  }
  rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
  rt.pizzeria.upsertSize({id:'large',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500,recipeMultiplier:1},admin);
  rt.pizzeria.upsertFlavor({id:'cal',productId:'pizza',name:'Calabresa',priceDeltaCents:400,recipeProductId:'flavor-cal'},admin);
  rt.pizzeria.upsertFlavor({id:'mar',productId:'pizza',name:'Marguerita',priceDeltaCents:200,recipeProductId:'flavor-mar'},admin);
  rt.pizzeria.upsertCrust({id:'cat',productId:'pizza',name:'Catupiry',priceDeltaCents:600,recipeProductId:'crust-cat'},admin);
  return rt;
}

test('pizza model reuses canonical recipes for base, flavors and crust without duplicating ingredient schema',()=>{
  const rt=setup();
  try{
    const profile=rt.pizzeria.getProfile('pizza');
    assert.equal(profile.sizes[0].recipeMultiplier,1);
    assert.equal(profile.flavors.find(row=>row.id==='cal').recipeProductId,'flavor-cal');
    assert.equal(profile.crusts.find(row=>row.id==='cat').recipeProductId,'crust-cat');
    const migration=rt.db.prepare('SELECT name FROM pizzeria_schema_migrations WHERE version=1').get();
    assert.equal(migration.name,'pizza_canonical_composition_v1');
  }finally{rt.close();}
});

test('server pricing snapshots display label and exact proportional stock requirements',()=>{
  const rt=setup();
  try{
    const priced=rt.pizzeria.pricePizza({productId:'pizza',sizeId:'large',flavorIds:['cal','mar'],crustId:'cat'});
    assert.equal(priced.unitPriceCents,4500);
    assert.equal(priced.configurationSnapshot.pizza.displayLabel,'Grande · ½ Calabresa + ½ Marguerita · Borda Catupiry');
    assert.deepEqual(priced.configurationSnapshot.pizza.stockItems,[
      {productId:'basil',quantity:.01},
      {productId:'calabresa',quantity:.1},
      {productId:'catupiry',quantity:.15},
      {productId:'cheese',quantity:.3},
      {productId:'dough',quantity:1},
      {productId:'onion',quantity:.025},
      {productId:'sauce',quantity:.2},
      {productId:'tomato',quantity:.05}
    ]);
  }finally{rt.close();}
});

test('completed configured pizza sale consumes canonical stock exactly once',async()=>{
  const rt=setup();
  try{
    rt.cash.openSession({id:'cash',terminalId:'PDV-01',operatorId:'admin-1',initialCashCents:0,actor:admin});
    const priced=rt.pizzeria.pricePizza({productId:'pizza',sizeId:'large',flavorIds:['cal','mar'],crustId:'cat'});
    const sale=rt.sales.openSale({terminalId:'PDV-01',operatorId:'admin-1'},admin);
    rt.sales.addItem(sale.id,{productId:'pizza',quantity:1,unitPriceCents:priced.unitPriceCents,configurationSnapshot:priced.configurationSnapshot,forceSeparateLine:true});
    rt.sales.completeSale(sale.id,{payments:[{method:'CASH',amountCents:4500}],actor:admin});
    await rt.dispatchPending();
    const expected={dough:9,sauce:9.8,cheese:9.7,calabresa:9.9,onion:9.975,tomato:9.95,basil:9.99,catupiry:9.85};
    for(const [id,value] of Object.entries(expected))assert.equal(rt.inventory.getBalance(id),value,id);
  }finally{rt.close();}
});
