'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const read=path=>fs.readFileSync(path,'utf8');

test('pizza reuses the canonical product configuration contract across waiter QR and desktop',()=>{
  const canonical=read('js/domains/catalog/order-configuration-service.js');
  const cart=read('shared/order-composer.js');
  const mobile=read('server/mobile/app.js');
  const customer=read('server/customer-menu/app.js');
  const desktop=read('desktop/renderer/restaurant-order-composer-ui.js');

  assert.match(canonical,/configurationKind:'PIZZA'/);
  assert.match(canonical,/maxSelectionsBySize/);
  assert.match(canonical,/priceConfiguredItem/);
  assert.match(canonical,/pizzeria\.pricePizza/);

  for(const source of [mobile,customer,desktop]){
    assert.match(source,/variantId/);
    assert.match(source,/selections/);
    assert.match(source,/comboSelections/);
    assert.doesNotMatch(source,/PdvPizzaComposer/);
    assert.doesNotMatch(source,/MutationObserver/);
  }
  assert.match(cart,/toOrderItems/);
  assert.doesNotMatch(canonical,/document\.|querySelector|innerHTML|replaceChildren|MutationObserver|createElement/);
});

test('all restaurant channels ask the same server-side configuration authority for price',()=>{
  const router=read('server/restaurant-router.js');
  const publicOrdering=read('js/domains/restaurant/public-ordering.js');
  const vertical=read('server/vertical-router.js');

  assert.match(router,/runtime\.orderConfiguration\.priceConfiguredItem/);
  assert.match(publicOrdering,/orderConfiguration\.priceConfiguredItem/);
  assert.match(vertical,/runtime\.orderConfiguration\.priceConfiguredItem/);
  assert.doesNotMatch(router,/runtime\.catalogCustomization\.priceConfiguredItem/);
});
