const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const readJson=file=>JSON.parse(read(file));

test('desktop hardening scripts are syntactically valid and loaded by the renderer',()=>{
  for(const file of ['desktop/renderer/catalog-search-stability.js','desktop/renderer/returns-ui.js']) {
    assert.doesNotThrow(()=>new vm.Script(read(file),{filename:file}));
  }
  const index=read('desktop/renderer/index.html');
  assert.match(index,/regression-hardening\.css/);
  assert.match(index,/catalog-search-stability\.js/);
  assert.match(index,/returns-ui\.js/);
});

test('product and customer searches intercept input before legacy full-page rerenders',()=>{
  const source=read('desktop/renderer/catalog-search-stability.js');
  assert.match(source,/document\.addEventListener\('input',[\s\S]*?\}, true\);/);
  assert.match(source,/target\.id === 'product-page-search'/);
  assert.match(source,/target\.id === 'customer-page-search'/);
  assert.match(source,/event\.stopImmediatePropagation\(\)/);
  assert.match(source,/api\.products\(true\)/);
  assert.match(source,/input\.setSelectionRange\?\.\(end,end\)/);
  assert.match(source,/dataset\.productList = '1'/);
  assert.match(source,/dataset\.customerList = '1'/);
});

test('compact cart uses a two-column resilient grid instead of the legacy three-column squeeze',()=>{
  const css=read('desktop/renderer/regression-hardening.css');
  assert.match(css,/\.cart-line\s*\{[\s\S]*grid-template-columns:minmax\(0,1fr\) auto !important/);
  assert.match(css,/\.cart-line > div:first-child[\s\S]*grid-row:1 \/ span 2/);
  assert.match(css,/\.cart-line \.line-total[\s\S]*grid-column:2/);
  assert.match(css,/\.cart-line \.qty-control[\s\S]*grid-column:2/);
  assert.match(css,/overflow-wrap:anywhere/);
});

test('returns desktop UI connects completed sales, available quantities, refunds and authorization to real APIs',()=>{
  const source=read('desktop/renderer/returns-ui.js');
  assert.match(source,/\['admin','manager'\]\.includes/);
  assert.match(source,/api\.salesHistory\(\{status:'COMPLETED'/);
  assert.match(source,/api\.saleDetails\(saleId\)/);
  assert.match(source,/api\.returns\(\{saleId/);
  assert.match(source,/const payload = \{/);
  assert.match(source,/api\.createReturn\(payload\)/);
  assert.match(source,/api\.authorizeReturn\(\{/);
  assert.match(source,/requiresApproval\(\)/);
  assert.match(source,/saleItemId:row\.dataset\.returnItem/);
  assert.match(source,/refunds:\[\{method,amountCents:totalCents\}\]/);
  assert.match(source,/availableQuantity\(item,already\)/);
});

test('desktop regression E2E enters barcode and customer document key by key without reordering',()=>{
  const flow=readJson('qa/flows/desktop-regressions-e2e.json');
  const cases=[
    { prefix:'catalog-barcode', selector:'#product-page-search', expected:'7899876543210', resultSelector:'[data-product-list]', resultText:'QA REGRESSAO PRODUTO NOME MUITO LONGO PARA TESTAR CARRINHO RESPONSIVO' },
    { prefix:'customer-document', selector:'#customer-page-search', expected:'12345678901', resultSelector:'[data-customer-list]', resultText:'QA Cliente Estavel' }
  ];

  for(const item of cases){
    const presses=flow.steps.filter(step=>new RegExp(`^${item.prefix}-\\d{2}$`).test(step.name||''));
    assert.equal(presses.length,item.expected.length,`${item.prefix} deve digitar todos os caracteres`);
    assert.equal(presses.map(step=>step.key).join(''),item.expected);
    assert.ok(presses.every(step=>step.action==='press'&&step.selector===item.selector));

    const valueAssertion=flow.steps.find(step=>step.name===`${item.prefix}-order-preserved`);
    assert.equal(valueAssertion?.action,'expectValue');
    assert.equal(valueAssertion?.selector,item.selector);
    assert.equal(valueAssertion?.expected,item.expected);

    const resultAssertion=flow.steps.find(step=>step.name===`${item.prefix}-result`);
    assert.equal(resultAssertion?.action,'expectText');
    assert.equal(resultAssertion?.selector,item.resultSelector);
    assert.equal(resultAssertion?.expected,item.resultText);
  }
});

test('desktop regression E2E gates cart overflow and a completed return',()=>{
  const flow=readJson('qa/flows/desktop-regressions-e2e.json');
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'reg-sale-panel-no-overflow','reg-cart-line-no-overflow','reg-cart-price-override-visible',
    'reg-open-returns','reg-return-items-ready','reg-confirm-return','reg-return-success-copy','reg-return-history','reg-returns-no-overflow'
  ]) assert.ok(names.has(name),`missing ${name}`);
  assert.equal(flow.steps.find(step=>step.name==='reg-sale-panel-no-overflow')?.action,'expectNoHorizontalOverflow');
  assert.equal(flow.steps.find(step=>step.name==='reg-return-success-copy')?.expected,'concluída');
});

test('desktop regression E2E is mandatory in full and release QA profiles',()=>{
  const config=readJson('qa/artisys-qa.config.json');
  assert.equal(config.flows['desktop-regressions-e2e'],'flows/desktop-regressions-e2e.json');
  for(const profileName of ['full','release']){
    assert.ok(config.qaProfiles[profileName].flows.includes('desktop-regressions-e2e'));
    assert.ok(config.qaProfiles[profileName].criticalFlows.includes('desktop-regressions-e2e'));
  }
});
