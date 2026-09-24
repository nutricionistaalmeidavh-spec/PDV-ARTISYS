const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('cartLine exposes responsive semantic regions without inline price-action layout styles',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/class="cart-line-product"/);
  assert.match(app,/class="cart-line-name"/);
  assert.match(app,/class="secondary-button cart-line-price-action"/);
  assert.doesNotMatch(app,/data-price-item="\$\{item\.id\}" style=/);
  for(const selector of ['class="qty-control"','class="line-total"','data-qty-minus=','data-qty-plus=','data-remove=','data-price-item=']) assert.match(app,new RegExp(selector));
});

test('checkout cart layout shrinks long names and reflows at compact desktop widths',()=>{
  const css=read('desktop/renderer/ux-home-checkout.css');
  assert.match(css,/\.checkout-layout \.cart-line \{[^}]*grid-template-columns:minmax\(0,1fr\) auto auto;/s);
  assert.match(css,/\.checkout-layout \.cart-line-product \{[^}]*min-width:0;/s);
  assert.match(css,/\.checkout-layout \.cart-line-name \{[^}]*overflow-wrap:anywhere;/s);
  assert.match(css,/\.checkout-layout \.cart-line-price-action \{[^}]*white-space:normal;/s);
  assert.match(css,/@media \(max-width:1399px\)[\s\S]*\.checkout-layout \.cart-line \{[^}]*grid-template-areas:[^}]*"product total"[^}]*"product quantity"/s);
});

test('dedicated E2E locks 1366x768 long-name price-override regression',()=>{
  const flow=JSON.parse(read('qa/flows/checkout-cart-responsive-layout.json'));
  assert.ok(flow.steps.some(step=>step.action==='setViewportSize'&&step.width===1366&&step.height===768));
  assert.ok(flow.steps.some(step=>step.value==='QA Produto UltraLongoSemQuebraParaValidarCarrinhoResponsivo1366x768'));
  assert.ok(flow.steps.some(step=>step.selector==='[data-price-item]'&&step.action==='click'));
  assert.ok(flow.steps.some(step=>step.action==='expectNoHorizontalOverflow'&&step.selector==='.cart-line'));
  assert.ok(flow.steps.some(step=>step.action==='expectNoHorizontalOverflow'&&step.selector==='.sale-panel'));
});