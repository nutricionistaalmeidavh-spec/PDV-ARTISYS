'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');

test('checkout secondary fields live in accessible, keyboard-dismissable dialogs, with original handlers',()=>{
  const js=read('desktop/renderer/checkout-space-ui.js');
  for(const field of ['#seller-select','#customer-search','#sale-observation','#discount-percent'])
    assert.ok(js.includes(field),`must preserve canonical control ${field}`);
  assert.match(js,/showModal\(\)/);
  assert.match(js,/aria-labelledby/);
  assert.match(js,/\.append\(content\)/);
  assert.match(js,/PdvUiLifecycle/);
  assert.doesNotMatch(js,/MutationObserver|api\.discountSale|api\.completeSale|innerHTML\s*=\s*.*sale-panel/);
});

test('cart remains independently scrollable and payment actions stay visually fixed',()=>{
  const css=read('desktop/renderer/checkout-space-ui.css');
  assert.match(css,/\.sale-cart-region \.cart-list[^{]*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css,/\.sale-checkout-footer[^{]*\{[^}]*position:\s*sticky[^}]*bottom:\s*0/s);
  assert.match(css,/\.checkout-layout\.cart-focus-mode/);
  assert.match(css,/\.checkout-detail-dialog::backdrop/);
});

test('clear cart requires an explicit confirmation, but preserves existing handler',()=>{
  const js=read('desktop/renderer/checkout-space-ui.js');
  assert.match(js,/stopImmediatePropagation\(\)/);
  assert.match(js,/clear\.click\(\)/);
  assert.match(js,/Limpar todos os itens\?/);
});

test('checkout enhancement is loaded after canonical checkout and observation extensions',()=>{
  const html=read('desktop/renderer/index.html');
  const original=html.indexOf('src="./ux-home-checkout.js"');
  const enhancement=html.indexOf('src="./checkout-space-ui.js"');
  const observation=html.indexOf('src="./sale-observation-ui.js"');
  assert.ok(original>0 && observation>0 && enhancement>original && enhancement>observation);
  assert.match(html,/href="\.\/checkout-space-ui\.css"/);
});
