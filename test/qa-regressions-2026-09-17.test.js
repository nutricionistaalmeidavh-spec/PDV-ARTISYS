'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const json=file=>JSON.parse(read(file));

test('basic sale provisions stock and waits for payment modal to close instead of a transient toast',()=>{
  const flow=json('qa/flows/common/basic-sale.json');
  const byName=name=>flow.steps.find(step=>step.name===name);
  const index=name=>flow.steps.findIndex(step=>step.name===name);
  assert.equal(byName('sale-stock-open')?.selector,"[data-route='inventory']");
  assert.equal(byName('sale-stock-qty')?.value,'10');
  assert.equal(byName('sale-stock-reason')?.value,'QA estoque para venda');
  assert.ok(index('sale-stock-open')>=0&&index('sale-stock-open')<index('open-checkout'));
  assert.equal(byName('sale-success')?.selector,'#confirm-payment');
  assert.equal(byName('sale-success')?.state,'hidden');
});

test('desktop local bridge authenticates product-variant extension routes with the installation token',()=>{
  const main=read('desktop/main.cjs');
  assert.match(main,/rawPath\.startsWith\(['"]\/api\/v1\/product-variants['"]\)/);
});

test('expectText waits for a matching live locator instead of iterating transient toast indexes',()=>{
  const steps=read('qa/runtime/src/steps.js');
  assert.match(steps,/filter\(\{\s*hasText:\s*expected\s*\}\)/);
  assert.match(steps,/waitFor\(\{\s*state:\s*['"]visible['"]/);
  assert.doesNotMatch(steps,/target\.nth\(index\)\.textContent\(\)/);
});

test('return flow verifies persisted reason through the canonical returns API instead of UI columns that do not render reason',()=>{
  const flow=json('qa/flows/user/08-pos-venda-devolucao.json');
  const history=flow.steps.find(step=>step.name==='return-history');
  assert.equal(history?.action,'apiRequest');
  assert.equal(history?.path,'/api/v1/returns');
  assert.equal(history?.method,'GET');
  assert.equal(history?.expectStatus,200);
  assert.equal(history?.expectedText,'QA devolução');
});

test('retail QA targets the implicit submit button actually rendered by the RETAIL workspace',()=>{
  const flow=json('qa/flows/user/18-varejo.json');
  const search=flow.steps.find(step=>step.name==='search');
  assert.equal(search?.selector,'#retail-search button');
});
