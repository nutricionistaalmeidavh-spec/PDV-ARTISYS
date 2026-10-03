'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Autoatendimento has a real desktop renderer and configuration API instead of a missing legacy renderer',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  const api=read('desktop/renderer/vertical-api-client.js');
  assert.match(modules,/if\(id==='SELF_SERVICE'\)return renderSelfService\(\)/);
  assert.doesNotMatch(modules,/PdvFinalModules/);
  assert.match(modules,/function renderSelfService/);
  assert.match(modules,/value="SELF_SERVICE"/);
  assert.match(modules,/value="TABLE"/);
  assert.match(modules,/value="PICKUP"/);
  assert.match(modules,/\/mobile/);
  assert.match(api,/restaurantDevices\(/);
  assert.match(api,/createRestaurantDevice\(/);
  assert.match(api,/configureSelfService\(/);
});

test('Pizzaria mounts the size flavor and crust extension on the current screen title',()=>{
  const parity=read('desktop/renderer/vertical-parity-p1.js');
  assert.match(parity,/title\(\)!=='Personalização de pizza'/);
  assert.match(parity,/pizza-size-form/);
  assert.match(parity,/pizza-flavor-form/);
  assert.match(parity,/pizza-crust-form/);
});

test('Balcão e senhas creates a canonical sale-backed order with products instead of an empty queue number',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  assert.doesNotMatch(modules,/createFastFood\(\{\}\)/);
  assert.match(modules,/fast-food-order-form/);
  assert.match(modules,/fast-food-product-form/);
  assert.match(modules,/pricedCartItems\(fastFoodCart\)/);
  assert.match(modules,/createFastFood\(\{[\s\S]*terminalId:[\s\S]*operatorId:[\s\S]*items:/);
});

test('Delivery composes products before creating its canonical sale and no longer asks for technical IDs',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  const parity=read('desktop/renderer/vertical-parity-p1.js');
  assert.match(modules,/delivery-product-form/);
  assert.match(modules,/pricedCartItems\(deliveryCart\)/);
  assert.match(modules,/createDeliverySale\(/);
  assert.doesNotMatch(parity,/ID do pedido/);
  assert.doesNotMatch(parity,/ID do produto/);
});

test('checkout operational documents include Alimentação commands Atacado Delivery and Balcão/senhas',()=>{
  const router=read('server/checkout-document-router.js');
  const app=read('desktop/renderer/app.js');
  assert.match(router,/type:'DELIVERY'/);
  assert.match(router,/type:'FAST_FOOD'/);
  assert.match(router,/\/checkout\/documents\/delivery\/:id\/open/);
  assert.match(router,/\/checkout\/documents\/fast-food\/:id\/open/);
  assert.match(app,/DELIVERY:'Entrega \/ retirada'/);
  assert.match(app,/FAST_FOOD:'Balcão \/ senha'/);
});
