'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const mobile=fs.readFileSync('server/mobile/app.js','utf8');
const kds=fs.readFileSync('server/mobile/app.js','utf8');

test('waiter uses pizza composer instead of generic option dialog',()=>{
  assert.match(mobile,/function configurePizza\(product\)/);
  assert.match(mobile,/data-pizza-size/);
  assert.match(mobile,/data-pizza-flavor/);
  assert.match(mobile,/data-pizza-crust/);
  assert.match(mobile,/pizza:\{sizeId,flavorIds,crustId\}/);
  assert.match(mobile,/hasConfiguration\(product\).*product\?\.pizza/s);
});

test('waiter cart and order history render canonical pizza display label',()=>{
  assert.match(mobile,/pizzaDisplayLabel/);
  assert.match(mobile,/configuration\?\.pizza\?\.displayLabel/);
});

test('KDS renders the same canonical pizza display label',()=>{
  assert.match(kds,/ticket\.items\.map/);
  assert.match(kds,/configuration\?\.pizza\?\.displayLabel/);
});
