'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('one canonical order composer is loaded by desktop waiter/tablet and public QR surfaces',()=>{
  const shared=read('shared/order-composer.js');
  const desktop=read('desktop/renderer/index.html');
  const mobile=read('server/mobile/index.html');
  const menu=read('server/customer-menu/index.html');
  assert.match(shared,/createCart/);
  assert.match(shared,/configuration/);
  assert.match(desktop,/\.\.\/\.\.\/shared\/order-composer\.js/);
  assert.match(mobile,/\/mobile\/order-composer\.js/);
  assert.match(menu,/\/menu\/order-composer\.js/);
  assert.match(read('server/mobile/app.js'),/PdvOrderComposer/);
  assert.match(read('server/customer-menu/app.js'),/PdvOrderComposer/);
});

test('shared composer preserves configuration notes quantities and canonical order payload',()=>{
  delete require.cache[require.resolve('../shared/order-composer.js')];
  const composer=require('../shared/order-composer.js');
  const cart=composer.createCart({idFactory:(()=>{let n=0;return()=>`line-${++n}`;})()});
  cart.add({productId:'burger',name:'Burger',unitPriceCents:2000,quantity:1,note:'sem cebola',configuration:{variantId:'large',selections:['bacon'],comboSelections:[{groupId:'drink',productId:'soda'}]}});
  const line=cart.lines()[0];
  cart.changeQuantity(line.id,1);
  assert.equal(cart.summary().quantity,2);
  assert.equal(cart.summary().totalCents,4000);
  assert.deepEqual(cart.toOrderItems(),[{productId:'burger',quantity:2,variantId:'large',selections:['bacon'],comboSelections:[{groupId:'drink',productId:'soda'}],note:'sem cebola'}]);
});
