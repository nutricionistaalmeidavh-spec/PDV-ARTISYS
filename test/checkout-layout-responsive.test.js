'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const {calculateCheckoutSpace}=require('../desktop/renderer/checkout-layout-metrics');

test('P1: computes available CSS pixel height from real route and viewport bounds, including 150% scaling',()=>{
  assert.equal(calculateCheckoutSpace({viewportHeight:768,routeBottom:710,routeTop:70,layoutTop:85}),617);
  assert.equal(calculateCheckoutSpace({viewportHeight:1080,routeBottom:1022,routeTop:70,layoutTop:84}),930);
  assert.equal(calculateCheckoutSpace({viewportHeight:512,routeBottom:455,routeTop:70,layoutTop:85}),362);
  assert.equal(calculateCheckoutSpace({viewportHeight:768,routeBottom:710,routeTop:70,layoutTop:-120}),632);
});

test('P2: footer lives in a non-scrolling row; only items scroll within the checkout panel',()=>{
  const css=read('desktop/renderer/checkout-responsive-layout.css');
  assert.match(css,/grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
  assert.match(css,/\.sale-panel\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css,/\.sale-cart-region \.cart-list\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(css,/\.sale-checkout-footer\s*\{[^}]*position:\s*relative/s);
  assert.match(css,/\.checkout-layout\.checkout-short/);
});

test('P3: window and container resize recompute dimensions and narrow mode preserves cart and catalog',()=>{
  const js=read('desktop/renderer/checkout-responsive-layout.js');
  const css=read('desktop/renderer/checkout-responsive-layout.css');
  assert.match(js,/ResizeObserver/);
  assert.match(js,/\.clientWidth/);
  assert.match(js,/calculateCheckoutSpace/);
  assert.match(js,/Ver produtos/);
  assert.match(js,/Ver carrinho/);
  assert.match(css,/checkout-narrow/);
  assert.match(css,/checkout-narrow-show-catalog/);
  assert.doesNotMatch(js,/MutationObserver/);
});

test('P1-P3: assets follow the existing checkout extensions and have no new dependency',()=>{
  const html=read('desktop/renderer/index.html');
  assert.ok(html.indexOf('src="./checkout-responsive-layout.js"')>html.indexOf('src="./checkout-space-ui.js"'));
  assert.ok(html.indexOf('src="./checkout-layout-metrics.js"')<html.indexOf('src="./checkout-responsive-layout.js"'));
  assert.match(html,/href="\.\/checkout-responsive-layout\.css"/);
  const pkg=JSON.parse(read('package.json'));
  assert.ok(pkg.scripts['qa:e2e:p0']);
});
