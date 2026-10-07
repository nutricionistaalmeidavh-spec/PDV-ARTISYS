'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const read=path=>fs.readFileSync(path,'utf8');

test('pizza composer is one shared interaction model across customer waiter and desktop',()=>{
  const shared=read('shared/pizza-composer.js');
  const mobileIndex=read('server/mobile/index.html');
  const customerIndex=read('server/customer-menu/index.html');
  const desktopIndex=read('desktop/renderer/index.html');
  const mobile=read('server/mobile/app.js');
  const customer=read('server/customer-menu/app.js');
  const desktop=read('desktop/renderer/restaurant-order-composer-ui.js');

  assert.match(shared,/PdvPizzaComposer/);
  assert.match(shared,/sizeId/);
  assert.match(shared,/flavorIds/);
  assert.match(shared,/crustId/);
  assert.match(shared,/formatPizza/);
  assert.match(mobileIndex,/pizza-composer\.js/);
  assert.match(customerIndex,/pizza-composer\.js/);
  assert.match(desktopIndex,/shared\/pizza-composer\.js/);
  assert.match(mobile,/PdvPizzaComposer/);
  assert.match(customer,/PdvPizzaComposer/);
  assert.match(desktop,/PdvPizzaComposer/);
});

test('mobile and public pizza preview ask the server for authoritative pricing',()=>{
  const router=read('server/restaurant-router.js');
  const publicRouter=read('server/public-ordering-router.js');
  const mobile=read('server/mobile/app.js');
  const customer=read('server/customer-menu/app.js');
  assert.match(router,/\/api\/v1\/mobile\/menu\/price/);
  assert.match(router,/runtime\.pizzeria\.pricePizza/);
  assert.match(publicRouter,/orders\|service\|price/);
  assert.match(mobile,/\/api\/v1\/mobile\/menu\/price/);
  assert.match(customer,/apiPath\('\/price'\)/);
});
