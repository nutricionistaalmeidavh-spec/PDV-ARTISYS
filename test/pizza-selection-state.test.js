'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const source=fs.readFileSync('shared/pizza-composer.js','utf8');
const pizza=require('../shared/pizza-composer.js');

const profile={
  pricingPolicy:'HIGHEST_FLAVOR',
  sizes:[{id:'g',name:'Grande',maxFlavors:2,priceDeltaCents:500}],
  flavors:[
    {id:'cal',name:'Calabresa',priceDeltaCents:400},
    {id:'mar',name:'Marguerita',priceDeltaCents:200}
  ],
  crusts:[{id:'cat',name:'Catupiry',priceDeltaCents:600}]
};

test('shared pizza composer is headless and DOM-free',()=>{
  assert.doesNotMatch(source,/document\.|querySelector|innerHTML|replaceChildren|MutationObserver|createElement/);
});

test('pizza state is immutable and canonical',()=>{
  const initial=pizza.createSelection(profile);
  const sized=pizza.reduce(profile,initial,{type:'size',id:'g'});
  const first=pizza.reduce(profile,sized,{type:'flavor.toggle',id:'cal'});
  const second=pizza.reduce(profile,first,{type:'flavor.toggle',id:'mar'});
  const crust=pizza.reduce(profile,second,{type:'crust',id:'cat'});
  assert.deepEqual(initial,{sizeId:null,flavorIds:[],crustId:null});
  assert.deepEqual(crust,{sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'});
  assert.equal(pizza.validate(profile,crust),'');
  assert.equal(pizza.summaryFromSelection(profile,crust),'Grande · ½ Calabresa + ½ Marguerita · Borda Catupiry');
  assert.deepEqual(pizza.toPayload(crust),{sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'});
});

test('size change trims flavors deterministically instead of reading UI state',()=>{
  const state={sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'};
  const single={...profile,sizes:[{id:'p',name:'Pequena',maxFlavors:1,priceDeltaCents:0}]};
  const next=pizza.reduce(single,state,{type:'size',id:'p'});
  assert.deepEqual(next,{sizeId:'p',flavorIds:['cal'],crustId:'cat'});
});
