'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('P0 QA runner promotes renderer page errors to a failed flow',()=>{
  const runner=read('qa/runtime/src/runner.js');
  assert.match(runner,/type\s*===?\s*['"]pageerror['"]/);
  assert.match(runner,/Renderer page error|page error/i);
  assert.match(runner,/status\s*=\s*['"]failed['"]/);
});

test('P0 all-pages audit opens the Devolucao route and verifies the real surface',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  assert.equal(names.has('devolucao'),true);
  assert.equal(names.has('devolucao-ui'),true);
  assert.equal(flow.steps.some(step=>step.name==='devolucao-ui'&&step.selector==='[data-returns-ui]'),true);
});

test('P1 checkout keeps operational document context visible until the sale leaves the checkout',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/checkoutDocumentContext/);
  assert.match(app,/data-checkout-document-context/);
  assert.match(app,/opened\.document/);
  assert.match(app,/expectedAt/);
  assert.match(app,/customerName/);
  assert.match(app,/clearCheckoutDocumentContext/);
});

test('P1 food workspace uses the user-facing task name Mesas e comandas',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.match(restaurant,/<h1>Mesas e comandas<\/h1>/);
  assert.doesNotMatch(restaurant,/<h1>Restaurante<\/h1>/);
});

test('P1 food workspace puts operational choices before explanatory area details',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  const task=modules.indexOf('<h2>Como o estabelecimento atende</h2>');
  const explanation=modules.indexOf('<h2>Incluído na área</h2>');
  assert.notEqual(task,-1);
  assert.notEqual(explanation,-1);
  assert.ok(task<explanation,'operational choices must appear before the explanatory area summary');
});

test('P1 active optional areas expose a direct continuation action in settings',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  assert.match(modules,/data-open-module-area/);
  assert.match(modules,/Abrir área/);
});
