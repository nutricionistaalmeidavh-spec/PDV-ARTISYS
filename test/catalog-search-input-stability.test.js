const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const readJson=file=>JSON.parse(read(file));

test('product and customer page searches filter their rows without rebuilding the focused input',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/function renderProductRows\(\)/);
  assert.match(app,/function renderCustomerRows\(\)/);

  const productBinding=app.split('\n').find(line=>line.includes("getElementById('product-page-search')")&&line.includes("addEventListener('input'"))||'';
  assert.match(productBinding,/state\.productQuery = event\.target\.value; renderProductRows\(\);/);
  assert.doesNotMatch(productBinding,/renderProducts\(\)/);
  assert.doesNotMatch(productBinding,/\.focus\(\)/);

  const customerBinding=app.split('\n').find(line=>line.includes("getElementById('customer-page-search')")&&line.includes("addEventListener('input'"))||'';
  assert.match(customerBinding,/state\.customerQuery = event\.target\.value; renderCustomerRows\(\);/);
  assert.doesNotMatch(customerBinding,/renderCustomers\(\)/);
  assert.doesNotMatch(customerBinding,/\.focus\(\)/);
});

test('catalog QA enters product barcode and customer document key by key without reordering',()=>{
  const flow=readJson('qa/flows/catalog-search-input-stability.json');
  const cases=[
    { prefix:'catalog-barcode', selector:'#product-page-search', expected:'7891234567895', resultSelector:'[data-product-list]', resultText:'QA Busca Estavel' },
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

test('catalog search stability E2E is mandatory in full and release QA profiles',()=>{
  const config=readJson('qa/artisys-qa.config.json');
  assert.equal(config.flows['catalog-search-input-stability'],'flows/catalog-search-input-stability.json');
  for(const profileName of ['full','release']){
    assert.ok(config.qaProfiles[profileName].flows.includes('catalog-search-input-stability'));
    assert.ok(config.qaProfiles[profileName].criticalFlows.includes('catalog-search-input-stability'));
  }
});
