'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

const fixture=`<body data-active-route="checkout"><main id="route-content">
<section class="checkout-layout checkout-responsive-ready" data-checkout-space="true">
<aside class="sale-panel">
<div class="sale-context-grid"></div>
<section class="sale-cart-region"><div class="cart-head">Itens</div><div class="cart-list">Produto</div></section>
<section class="sale-checkout-footer">
<div class="checkout-quick-actions">
  <button class="checkout-space-action">Observação<small>Opcional</small></button>
  <button class="checkout-space-action">Desconto<small>R$ 0,00</small></button>
</div>
<div class="totals">
  <div class="total-row"><span>Subtotal</span><strong>R$ 120,00</strong></div>
  <div class="total-row"><span>Desconto</span><strong class="checkout-discount-amount">R$ 0,00</strong></div>
  <div class="total-row grand-total"><span>Total da venda</span><strong>R$ 120,00</strong></div>
</div>
<div class="payment-strip"><button data-pay="cash" class="pay-button">Dinheiro</button><button data-pay="card" class="pay-button card">Cartão</button><button data-pay="pix" class="pay-button pix">PIX</button></div>
<button id="finalize-sale" class="finalize-button">Finalizar venda (F12)</button>
</section>
<div class="checkout-detail-dialog"><input id="discount-percent" value="0"></div>
<textarea id="sale-observation"></textarea><input type="checkbox" id="sale-observation-print">
</aside></section></main><footer class="app-footer" aria-label="Estado da aplicação">ArtiSys</footer><div id="toast-root" class="toast-root"><div class="toast">Pedido carregado no caixa.</div></div></body>`;

test('P1–P3: checkout footer groups move original live controls, keep payment callbacks, and show discount state without duplicate amounts',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 await page.setContent(fixture);
 await page.evaluate(()=>{
  window.__clicked=[];
  for(const selector of ['[data-pay="cash"]','[data-pay="card"]','[data-pay="pix"]','#finalize-sale','.checkout-quick-actions button:first-child','.checkout-quick-actions button:nth-child(2)']){
   document.querySelector(selector).addEventListener('click',()=>window.__clicked.push(selector));
  }
  window.PdvUiLifecycle={on(){}};
 });
 await page.addScriptTag({path:path.join(root,'desktop/renderer/checkout-footer-clarity.js')});
 await page.waitForSelector('.checkout-clarity-footer');
 assert.deepEqual(await page.locator('.checkout-clarity-footer > section').evaluateAll(nodes=>nodes.map(n=>n.dataset.checkoutSection)),['adjustments','summary','payment']);
 assert.equal(await page.locator('.checkout-adjustments h3').innerText(),'Ajustes da venda');
 assert.equal(await page.locator('.checkout-summary h3').innerText(),'Resumo da venda');
 assert.equal(await page.locator('.checkout-payment h3').innerText(),'Forma de pagamento');
 assert.equal(await page.locator('.grand-total span').innerText(),'Total a receber');
 assert.equal(await page.locator('.checkout-quick-actions button:nth-child(2) small').innerText(),'Nenhum aplicado');
 await page.locator('#discount-percent').fill('10');
 await page.locator('#discount-percent').dispatchEvent('input');
 assert.equal(await page.locator('.checkout-quick-actions button:nth-child(2) small').innerText(),'Aplicado');
 await page.locator('.checkout-quick-actions button:first-child').click();
 await page.locator('[data-pay="pix"]').click();
 await page.locator('#finalize-sale').click();
 assert.deepEqual(await page.evaluate(()=>window.__clicked),['.checkout-quick-actions button:first-child','[data-pay="pix"]','#finalize-sale']);
 assert.equal(await page.locator('#discount-percent').count(),1);
 assert.equal(await page.locator('#finalize-sale').count(),1);
});

test('P1–P3: payment options are neutral until clicked and a checkout notification never overlaps F12',async t=>{
 const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 await page.setContent(fixture);
 await page.evaluate(()=>{window.PdvUiLifecycle={on(){}};});
 await page.addStyleTag({content:`
  :root{--ink:#10172f;--line:#dfe6f1;--surface-raised:white;--muted:#62718d;--artisys-blue:#0b6cff}
  *{box-sizing:border-box}
  .checkout-layout{display:grid;grid-template-columns:1fr 400px;justify-content:end;height:620px;max-width:1100px;margin:auto}
  .sale-panel{grid-column:2;display:grid;grid-template-rows:auto minmax(0,1fr) auto;height:100%;max-height:100%;overflow:hidden}
  .sale-cart-region{min-height:0}.cart-list{overflow-y:auto}
  .app-footer{position:fixed;left:80px;right:0;bottom:0;height:58px;background:#071b3c;color:white}
  .toast-root{position:fixed;right:22px;bottom:74px;z-index:80}
  .pay-button{background:#079454;color:white;border:0}
  .pay-button.card{background:#1681dc}.pay-button.pix{background:#10aebc}
  `});
 await page.addStyleTag({path:path.join(root,'desktop/renderer/checkout-footer-clarity.css')});
 await page.addScriptTag({path:path.join(root,'desktop/renderer/checkout-footer-clarity.js')});
 await page.waitForSelector('.checkout-clarity-footer');
 const res=await page.evaluate(()=>{
  const pay=[...document.querySelectorAll('.checkout-payment [data-pay]')];
  const toast=document.querySelector('#toast-root').getBoundingClientRect();
  const finalize=document.querySelector('#finalize-sale').getBoundingClientRect();
  const intersects=toast.top<finalize.bottom && toast.bottom>finalize.top && toast.left<finalize.right && toast.right>finalize.left;
  const appFooter=document.querySelector('.app-footer').getBoundingClientRect();
  const toastInsideStatus=toast.top>=appFooter.top-1 && toast.bottom<=appFooter.bottom+1;
  return {pay:pay.map(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color})),intersects,toastInsideStatus,footer:document.querySelector('.checkout-clarity-footer').getBoundingClientRect().toJSON(),viewport:innerHeight};
 });
 assert.equal(res.intersects,false);
 assert.equal(res.toastInsideStatus,true,'checkout toast must stay in the status band without covering the hero or sale actions');
 assert.ok(res.pay.every(p=>p.background==='rgb(255, 255, 255)'));
 assert.ok(res.footer.bottom<=res.viewport,'footer must stay in viewport with cart scrolling');
});

test('checkout visual layer is loaded after responsive enhancement, scoped to route, with no new network dependency',()=>{
 const html=read('desktop/renderer/index.html');
 assert.ok(html.indexOf('src="./checkout-footer-clarity.js"')>html.indexOf('src="./checkout-responsive-layout.js"'));
 assert.ok(html.indexOf('href="./checkout-footer-clarity.css"')>html.indexOf('href="./checkout-responsive-layout.css"'));
 const js=read('desktop/renderer/checkout-footer-clarity.js');
 assert.doesNotMatch(js,/MutationObserver|fetch\(|deleteSale|completeSale|innerHTML\s*=/);
 const css=read('desktop/renderer/checkout-footer-clarity.css');
 assert.match(css,/body\[data-active-route="checkout"\] \.toast-root/);
 assert.match(css,/checkout-very-short/);
});
