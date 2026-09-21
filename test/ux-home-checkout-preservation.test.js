const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const ui=require('../desktop/renderer/ui-model');

test('home keeps all ten existing routes and F2-F11 shortcuts',()=>{
  assert.deepEqual(ui.HOME_TILES.map(tile=>tile.route),['checkout','customers','sellers','products','inventory','cash','finance','reports','sales','returns']);
  assert.deepEqual(ui.HOME_TILES.map(tile=>tile.shortcut),['F2','F3','F4','F5','F6','F7','F8','F9','F10','F11']);
});

test('incremental UX layer is loaded after the existing renderer modules',()=>{
  const html=read('desktop/renderer/index.html');
  assert.match(html,/ux-home-checkout\.css/);
  assert.match(html,/ux-home-checkout\.js/);
  assert.ok(html.indexOf('./ux-home-checkout.js')>html.indexOf('./app.js'));
  assert.ok(html.indexOf('./ux-home-checkout.js')>html.indexOf('./operational-pages.js'));
});

test('home enhancer only reuses existing route buttons and sales-history API',()=>{
  const js=read('desktop/renderer/ux-home-checkout.js');
  for(const route of ['checkout','cash','sales','returns','products','customers','sellers','inventory','finance','reports']) assert.match(js,new RegExp(`['\"]${route}['\"]`));
  assert.match(js,/querySelectorAll\(':scope > \[data-home-route\]'\)/);
  assert.match(js,/appendChild\(relabel\(byRoute\.get\(route\), route\)\)/);
  assert.match(js,/api\.salesHistory\(\{ limit:5 \}\)/);
});

test('home preserves dynamic launchers injected by other renderer modules',()=>{
  const js=read('desktop/renderer/ux-home-checkout.js');
  assert.match(js,/hub\.className = 'home-hub home-grid'/);
  assert.match(js,/querySelectorAll\(':scope > \.home-tile:not\(\[data-home-route\]\)'\)/);
  assert.match(js,/data-home-extra-host/);
  assert.match(js,/extraHost\.appendChild\(launcher\)/);
});

test('home compact module links keep their existing icons visible',()=>{
  const css=read('desktop/renderer/ux-home-checkout.css');
  assert.doesNotMatch(css,/\.home-hub \.home-module-link \.tile-icon\s*\{\s*display\s*:\s*none/);
});

test('home typography raises every readable text tier by 3px',()=>{
  const css=read('desktop/renderer/ux-home-checkout.css');
  assert.match(css,/\.home-hub-head h1 \{ font-size:34px; \}/);
  assert.match(css,/\.home-hub-head p \{ font-size:21px; \}/);
  assert.match(css,/\.home-hub \.home-primary-action h2 \{ font-size:27px; \}/);
  assert.match(css,/\.home-hub \.home-primary-action p \{ font-size:18px; \}/);
  assert.match(css,/\.home-hub \.home-primary-action \.shortcut-badge \{ font-size:16px; \}/);
  assert.match(css,/\.home-context-card h2,[\s\S]*\.home-extra-card > h2 \{ font-size:19px; \}/);
  assert.match(css,/\.home-hub \.home-module-link h2 \{ font-size:21px; \}/);
  assert.match(css,/\.home-hub \.home-module-link p \{ font-size:18px; \}/);
  assert.match(css,/\.home-hub \.home-module-link \.shortcut-badge \{ font-size:16px; \}/);
  assert.match(css,/\.home-recent-head h2 \{ font-size:22px; \}/);
  assert.match(css,/\.home-recent-head p \{ font-size:17px; \}/);
  assert.match(css,/\.home-history-link \{ font-size:21px; \}/);
  assert.match(css,/\.home-recent-row \{ font-size:18px; \}/);
  assert.match(css,/\.home-recent-header \{ font-size:15px; \}/);
  assert.match(css,/\.home-recent-state \{ font-size:17px; \}/);
  assert.match(css,/body\.theme-home \.topbar-brand \{ font-size:30px; \}/);
  assert.match(css,/body\.theme-home \.status-pill,[\s\S]*body\.theme-home \.clock \{ font-size:21px; \}/);
  assert.match(css,/body\.theme-home \.app-footer \{ font-size:17px; \}/);
});

test('checkout preservation keeps current controls handlers payments and shortcuts untouched',()=>{
  const app=read('desktop/renderer/app.js');
  for(const id of ['product-search','scan-focus','seller-select','customer-search','clear-cart','discount-percent','new-sale','remove-item','cancel-sale','suspend-sale','finalize-sale']) assert.match(app,new RegExp(`id=\\"${id}\\"`));
  for(const method of ['cash','card','pix','tef']) assert.match(app,new RegExp(`data-pay=\\"${method}\\"`));
  for(const action of ['newSale','removeProduct','cancelCurrentSale','suspendCurrentSale','clearCart','applyDiscountFromInput','openPaymentModal','setSelectedSeller','setCustomer','openPriceOverride']) assert.match(app,new RegExp(`\\b${action}\\b`));
  assert.deepEqual(ui.CHECKOUT_SHORTCUTS,{F1:{type:'checkout.new-sale'},F2:{type:'checkout.focus-scan'},F3:{type:'checkout.remove-selected'},F4:{type:'checkout.cancel-sale'},F6:{type:'checkout.suspend-sale'},F12:{type:'checkout.finalize'}});
});

test('checkout styling is override-only and preserves established operational selectors',()=>{
  const css=read('desktop/renderer/ux-home-checkout.css');
  for(const marker of ['.checkout-layout','.product-grid','.product-card','.sale-panel','.cart-list','.payment-strip','.finalize-button']) assert.match(css,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});
