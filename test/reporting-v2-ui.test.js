'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..','desktop','renderer');

test('commercial reporting workspace is loaded before the legacy operational reports handler',()=>{
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const reports=index.indexOf('reporting-v2.js');
  const operational=index.indexOf('operational-pages.js');
  assert.ok(reports>0);
  assert.ok(operational>reports);
  assert.match(index,/reporting-v2\.css/);
});

test('commercial reporting workspace covers requested report dimensions and output actions',()=>{
  const source=fs.readFileSync(path.join(root,'reporting-v2.js'),'utf8');
  for(const marker of ['Venda por cliente','Venda por produto','Por meio de pagamento','Estoque mínimo / compra','Entradas e saídas do caixa','Imprimir / Salvar PDF','Exportar CSV']) assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.match(source,/root\.print\(\)/);
  assert.match(source,/paymentMethod/);
  assert.match(source,/customerId/);
  assert.match(source,/productId/);
  assert.match(source,/sellerId/);
});

test('print stylesheet removes application chrome and preserves report content',()=>{
  const css=fs.readFileSync(path.join(root,'reporting-v2.css'),'utf8');
  assert.match(css,/@media print/);
  assert.match(css,/\.sidebar/);
  assert.match(css,/\.topbar/);
  assert.match(css,/\.app-footer/);
  assert.match(css,/report-print-meta/);
});
