'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const file=name=>path.join(root,'desktop/renderer',name);
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const markup=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body data-active-route="checkout">
<main id="route-content"><section class="checkout-layout checkout-responsive-ready" data-checkout-space="true">
<aside class="sale-panel">
<div class="sale-context-grid">Vendedor · Cliente</div>
<section class="sale-cart-region"><div class="cart-head">Itens da venda (3)</div><div class="cart-list">Produto 1 · Produto 2 · Produto 3</div></section>
<section class="sale-checkout-footer">
<div class="checkout-quick-actions"><button type="button" class="checkout-space-action">Observação<small>Opcional</small></button><button type="button" class="checkout-space-action">Desconto<small>R$ 0,00</small></button></div>
<div class="totals"><div class="total-row"><span>Subtotal</span><strong>R$ 120,00</strong></div><div class="total-row"><span>Desconto</span><strong class="checkout-discount-amount">R$ 0,00</strong></div><div class="total-row grand-total"><span>Total da venda</span><strong>R$ 120,00</strong></div></div>
<div class="payment-strip"><button type="button" data-pay="cash" class="pay-button">Dinheiro</button><button type="button" data-pay="card" class="pay-button card">Cartão</button><button type="button" data-pay="pix" class="pay-button pix">PIX</button></div>
<button type="button" id="finalize-sale" class="finalize-button">Finalizar venda (F12)</button>
</section>
<div class="checkout-detail-dialog"><input id="discount-percent" value="0"></div><textarea id="sale-observation"></textarea><input type="checkbox" id="sale-observation-print">
</aside></section></main></body></html>`;

async function pageWithCheckout(browser,viewport){
 const page=await browser.newPage({viewport});
 await page.route('http://checkout-artisys.test/**',route=>route.fulfill({status:200,contentType:'text/html',body:markup}));
 await page.goto('http://checkout-artisys.test/');
 await page.addStyleTag({content:`
 *{box-sizing:border-box}
 :root{--ink:#111b30;--line:#dde6f2;--line-soft:#edf1f6;--surface-raised:#fff;--text-subtle:#60708a;--text-label:#53627f}
 body{margin:0;font-family:Arial,sans-serif;background:#edf2f9}
 .checkout-layout{display:grid;grid-template-columns:minmax(0,1fr);height:640px;padding:10px}
 .sale-panel{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-height:0;overflow:hidden;background:#fff}
 .sale-context-grid{height:54px}
 .sale-cart-region{min-height:0;overflow:hidden}
 .sale-cart-region .cart-list{overflow-y:auto}
 .pay-button{min-height:44px;padding:6px}
 .finalize-button{min-height:46px;background:#0865d9;color:white;border:0}
 .checkout-space-action{min-height:44px}
 `});
 await page.addStyleTag({path:file('checkout-footer-clarity.css')});
 await page.addStyleTag({path:file('checkout-footer-density.css')});
 await page.evaluate(()=>{
   window.clicked=[];
   for(const s of ['#finalize-sale','[data-pay="pix"]','.checkout-quick-actions button:first-child']){
     document.querySelector(s).addEventListener('click',()=>window.clicked.push(s));
   }
   window.PdvUiLifecycle={on(){}};
 });
 await page.addScriptTag({path:file('checkout-footer-clarity.js')});
 await page.addScriptTag({path:file('checkout-footer-density.js')});
 await page.waitForSelector('.checkout-clarity-footer[data-footer-density="compact"]');
 return page;
}

test('compact Balcão footer saves ~35-45 px, preserving 44/46px touch targets and a visible F12',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 for(const viewport of [{width:1366,height:768},{width:1024,height:768}]){
  const page=await pageWithCheckout(browser,viewport);
  const toggle=page.locator('.checkout-density-toggle');
  assert.equal(await toggle.count(),1);
  assert.equal(await toggle.getAttribute('aria-pressed'),'true');
  const compact=await page.locator('.checkout-clarity-footer').evaluate(el=>el.getBoundingClientRect().height);
  await toggle.click();
  await page.waitForSelector('.checkout-clarity-footer[data-footer-density="normal"]');
  const normal=await page.locator('.checkout-clarity-footer').evaluate(el=>el.getBoundingClientRect().height);
  assert.ok(normal-compact>=30,`expected at least 30px reclaimed, got ${normal-compact} at ${viewport.width}`);
  assert.ok(normal-compact<=85,`avoid aggressive reduction (${normal-compact}px)`);
  await toggle.click();
  const target=await page.evaluate(()=>{
   const footer=document.querySelector('.checkout-clarity-footer');
   return {buttons:[...footer.querySelectorAll('.checkout-space-action, .pay-button')].map(b=>b.getBoundingClientRect().height),
    f12:footer.querySelector('#finalize-sale').getBoundingClientRect().height,
    text:footer.querySelector('.grand-total').innerText,
    footerBottom:footer.getBoundingClientRect().bottom,viewport:innerHeight,
    headingVisible:getComputedStyle(footer.querySelector('.checkout-summary .checkout-section-header')).display};
  });
  assert.equal(target.headingVisible,'none');
  assert.ok(target.buttons.every(h=>h>=44),`buttons must be touch-safe: ${target.buttons.join(',')}`);
  assert.ok(target.f12>=46,'F12 must not shrink');
  assert.ok(target.footerBottom<=target.viewport,'payment must remain in viewport');
  assert.match(target.text,/R\$ 120,00/);
  await page.close();
 }
});

test('one-click rollback changes only checkout density, keeps payment handlers and persists per terminal',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await pageWithCheckout(browser,{width:1366,height:768});
 const toggle=page.locator('.checkout-density-toggle');
 await toggle.click();
 assert.equal(await page.locator('.checkout-clarity-footer').getAttribute('data-footer-density'),'normal');
 assert.equal(await toggle.getAttribute('aria-label'),'Usar rodapé compacto');
 assert.equal(await page.evaluate(()=>localStorage.getItem('artisys.checkout.footerDensity.v1')),'normal');
 await page.locator('[data-pay="pix"]').click();
 await page.locator('#finalize-sale').click();
 assert.deepEqual(await page.evaluate(()=>window.clicked),['[data-pay="pix"]','#finalize-sale']);
 const modeAfterRoute=await page.evaluate(()=>{
  const footer=document.querySelector('.checkout-clarity-footer');
  const context=footer.closest('.checkout-layout');
  // Reusing existing sections must not duplicate any checkout control.
  return {mode:footer.dataset.footerDensity,sections:footer.querySelectorAll('section[data-checkout-section]').length,
    originalF12:context.querySelectorAll('#finalize-sale').length};
 });
 assert.deepEqual(modeAfterRoute,{mode:'normal',sections:3,originalF12:1});
 await page.reload();
 // Simulate renderer rehydration on the same terminal origin.
 await page.addStyleTag({path:file('checkout-footer-clarity.css')});
 await page.addStyleTag({path:file('checkout-footer-density.css')});
 await page.evaluate(()=>{window.PdvUiLifecycle={on(){}};});
 await page.addScriptTag({path:file('checkout-footer-clarity.js')});
 await page.addScriptTag({path:file('checkout-footer-density.js')});
 assert.equal(await page.locator('.checkout-clarity-footer').getAttribute('data-footer-density'),'normal');
});

test('density feature stays an isolated reversible presentation layer; no commercial or fiscal change',()=>{
 const html=read('desktop/renderer/index.html');
 assert.ok(html.indexOf('src="./checkout-footer-density.js"')>html.indexOf('src="./checkout-footer-clarity.js"'));
 assert.ok(html.indexOf('href="./checkout-footer-density.css"')>html.indexOf('href="./checkout-footer-clarity.css"'));
 const css=read('desktop/renderer/checkout-footer-density.css');
 assert.match(css,/data-footer-density="compact"/);
 assert.doesNotMatch(css,/\.pay-button\s*\{[^}]*min-height:\s*(?:[0-3]\d)px/);
 const js=read('desktop/renderer/checkout-footer-density.js');
 assert.doesNotMatch(js,/fetch\(|api\.|completeSale|MutationObserver|innerHTML\s*=/);
 assert.match(js,/localStorage/);
 assert.match(js,/aria-pressed/);
});
