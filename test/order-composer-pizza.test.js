'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createCart}=require('../shared/order-composer.js');

test('canonical cart preserves pizza selection into order payload',()=>{
  const cart=createCart({idFactory:()=> 'line-1'});
  cart.add({
    productId:'pizza',
    name:'Pizza da Casa',
    unitPriceCents:4500,
    quantity:1,
    configuration:{
      pizza:{sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'},
      variantId:null,
      selections:[],
      comboSelections:[]
    }
  });
  assert.deepEqual(cart.lines()[0].configuration.pizza,{sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'});
  assert.deepEqual(cart.toOrderItems()[0].pizza,{sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'});
});
