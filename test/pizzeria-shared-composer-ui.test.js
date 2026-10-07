'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const read=path=>fs.readFileSync(path,'utf8');

test('pizza reuses the existing generic order configuration contract without a pizza-specific DOM renderer',()=>{
  const adapter=read('js/domains/catalog/order-configuration-service.js');
  const mobile=read('server/mobile/app.js');
  const customer=read('server/customer-menu/app.js');
  const desktop=read('desktop/renderer/restaurant-order-composer-ui.js');

  assert.match(adapter,/configurationKind:'PIZZA'/);
  assert.match(adapter,/PIZZA_FLAVOR_GROUP_ID/);
  assert.match(adapter,/PIZZA_CRUST_GROUP_ID/);
  assert.match(adapter,/pizzeria\.pricePizza/);

  for(const source of [mobile,customer,desktop]){
    assert.doesNotMatch(source,/PdvPizzaComposer/);
    assert.doesNotMatch(source,/data-pizza-composer/);
    assert.doesNotMatch(source,/pizza-composer\.js/);
  }
  assert.equal(fs.existsSync('shared/pizza-composer.js'),false);
});

test('pizza server pricing is reached through the same configuration service used by standard items',()=>{
  const vertical=read('server/vertical-router.js');
  const restaurant=read('server/restaurant-router.js');
  const publicOrdering=read('js/domains/restaurant/public-ordering.js');
  assert.match(vertical,/runtime\.orderConfiguration\.getProductConfiguration/);
  assert.match(vertical,/runtime\.orderConfiguration\.priceConfiguredItem/);
  assert.match(restaurant,/runtime\.orderConfiguration\.priceConfiguredItem/);
  assert.match(publicOrdering,/orderConfiguration\.priceConfiguredItem/);
  assert.doesNotMatch(restaurant,/mobile\/menu\/price/);
});
