const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

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
  assert.match(css,/\.customer-selected > div\s*\{[\s\S]*min-width:0;[\s\S]*flex:1 1 auto;/);
  assert.match(css,/\.customer-selected strong,[\s\S]*\.customer-selected small\s*\{[\s\S]*overflow-wrap:anywhere;/);
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
