'use strict';

const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const restaurantUi=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-ui.js'),'utf8');

test('restaurant management surfaces an actionable count of menu items without production destination',()=>{
  assert.match(restaurantUi,/function routingConfigurationAlert\(/);
  assert.match(restaurantUi,/data-routing-alert/);
  assert.match(restaurantUi,/sem destino configurado/i);
  assert.match(restaurantUi,/data-routing-review/);
  assert.match(restaurantUi,/data-routing-pending-product/);
});

test('routing alert takes the manager to the first pending item',()=>{
  assert.match(restaurantUi,/dataset\.routingReview/);
  assert.match(restaurantUi,/elements\.namedItem\('productId'\)/);
  assert.match(restaurantUi,/scrollIntoView/);
  assert.match(restaurantUi,/\.focus\(\)/);
});
