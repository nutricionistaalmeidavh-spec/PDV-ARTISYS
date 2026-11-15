'use strict';
// Integrated regression gate for PRs #203, #204, #205 and #206 on the same main base.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=(file)=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('checkout extensions coexist in lifecycle order without replacing canonical sale handlers',()=>{
  const html=read('desktop/renderer/index.html');
  const order=['sale-observation-ui.js','app.js','ux-home-checkout.js','checkout-space-ui.js','checkout-layout-metrics.js','checkout-responsive-layout.js'].map(file=>html.indexOf('src="./'+file+'"'));
  assert.ok(order.every((i)=>i>=0),'Missing canonical or enhanced renderer script');
  assert.ok(order.every((i,n)=>n===0||i>order[n-1]),'Checkout assets must load after their lifecycle owners');

  const app=read('desktop/renderer/app.js');
  for(const token of ['id="finalize-sale"','id="discount-percent"','id="customer-search"','id="seller-select"','api.discountSale','setSelectedSeller'])
    assert.ok(app.includes(token),'Missing live checkout control '+token);
  const ux=read('desktop/renderer/checkout-space-ui.js');
  const responsive=read('desktop/renderer/checkout-responsive-layout.js');
  assert.match(ux,/showModal\(\)/);
  assert.match(ux,/stopImmediatePropagation\(\)/);
  assert.match(responsive,/ResizeObserver/);
  assert.match(responsive,/PdvCheckoutLayoutMetrics/);
  assert.doesNotMatch(ux+responsive,/MutationObserver/);
});

test('cash-management PR #205 remains wired into main alongside checkout PRs',()=>{
  assert.match(read('js/core/pdv-runtime.js'),/runCashManagementMigrations/);
  assert.match(read('js/core/auth/permission-registry.js'),/cash\.manage/);
  const api=read('desktop/renderer/api-client.js');
  assert.match(api,/cashCorrect\(/);
  assert.match(api,/cashAnnul\(/);
  const router=read('server/router.js');
  assert.match(router,/correct\|annul/);
  assert.match(router,/requireCapability\(session,'cash\.manage'\)/);
  const cashUi=read('desktop/renderer/operational-pages.js');
  assert.match(cashUi,/data-manage-cash="correct"/);
  assert.match(cashUi,/data-manage-cash="annul"/);
  const cash=read('js/domains/cash/cash-service.js');
  assert.match(cash,/annulled_at/);
  assert.match(cash,/cash_session_corrections/);
});

test('responsive UI does not overwrite cash ownership or remove payment controls',()=>{
  const css=read('desktop/renderer/checkout-responsive-layout.css');
  assert.match(css,/checkout-responsive-ready[\s\S]*\.sale-panel/);
  assert.match(css,/grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(css,/\.sale-cart-region \.cart-list/);
  assert.match(css,/\.sale-checkout-footer/);
  const content=read('desktop/renderer/checkout-responsive-layout.js');
  assert.doesNotMatch(content,/\/api\/v1\/cash|discountSale|completeSale/);
  assert.ok(read('desktop/renderer/app.js').includes('data-pay="pix"'));
  assert.ok(read('desktop/renderer/app.js').includes('data-pay="card"'));
});

test('tutorial #203 and desktop E2E gates remain available after subsequent merges',()=>{
  const tutorial=JSON.parse(read('qa/demo/tutorials/13-cadastrar-produto.json'));
  assert.ok(tutorial,'Tutorial fixture must remain parseable');
  const qa=JSON.parse(read('qa/flows/all-pages-audit.json'));
  assert.ok(qa.steps.some(s=>s.action==='expectInViewport'&&s.selector==='#finalize-sale'));
  assert.ok(qa.steps.some(s=>s.name==='balcao-observacao-dialog-visivel'));
  assert.ok(qa.steps.some(s=>s.name==='balcao-vendedor-dialog-visivel'));
  assert.ok(qa.steps.some(s=>s.name==='balcao-desconto-dialog-visivel'));
  assert.ok(fs.existsSync(path.join(__dirname,'cash-management.test.js')));
  assert.ok(fs.existsSync(path.join(__dirname,'cash-management-api.test.js')));
  const workflow=read('.github/workflows/verify.yml');
  assert.match(workflow,/qa:e2e:p0/);
  assert.match(workflow,/qa:e2e:tablet/);
});
