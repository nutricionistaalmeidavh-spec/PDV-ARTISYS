'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.join(__dirname,'..','desktop','renderer');
const reportScript=path.join(root,'reporting-v2.js');

function escapeRegex(value){return String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}

test('commercial reporting workspace is loaded before the legacy operational reports handler',()=>{
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const reports=index.indexOf('reporting-v2.js');
  const operational=index.indexOf('operational-pages.js');
  assert.ok(reports>0);
  assert.ok(operational>reports);
  assert.match(index,/reporting-v2\.css/);
});

test('commercial reporting workspace has valid JavaScript syntax',()=>{
  execFileSync(process.execPath,['--check',reportScript],{stdio:'pipe'});
});

test('commercial reporting workspace covers requested report dimensions and output actions',()=>{
  const source=fs.readFileSync(reportScript,'utf8');
  for(const marker of ['Venda por cliente','Venda por produto','Por meio de pagamento','Estoque mínimo / compra','Entradas e saídas do caixa','Comissões','Imprimir / Salvar PDF','Exportar CSV','Desconto rateado','Saídas em dinheiro']) {
    assert.match(source,new RegExp(escapeRegex(marker),'i'));
  }
  assert.match(source,/root\.print\(\)/);
  assert.match(source,/paymentMethod/);
  assert.match(source,/customerId/);
  assert.match(source,/productId/);
  assert.match(source,/sellerId/);
});

test('reporting v2 preserves commission rules and payment workflows from the legacy report page',()=>{
  const source=fs.readFileSync(reportScript,'utf8');
  assert.match(source,/api\.commissions\(salesFilters\)/);
  assert.match(source,/api\.commissionRules\(\{includeInactive:true\}\)/);
  assert.match(source,/api\.saveCommissionRule/);
  assert.match(source,/api\.payCommission/);
  assert.match(source,/Registrar pagamento/);
  assert.match(source,/Regra de comissão/);
});

test('filters do not claim seller or period semantics where they cannot apply',()=>{
  const source=fs.readFileSync(reportScript,'utf8');
  assert.match(source,/SELLER_FILTER_VIEWS/);
  assert.match(source,/PERIOD_FILTER_VIEWS/);
  assert.match(source,/vendedor\/garçom não se aplica ao caixa físico/i);
  assert.match(source,/Período e vendedor\/garçom não se aplicam a este relatório/i);
});

test('print stylesheet removes application chrome and operational actions',()=>{
  const css=fs.readFileSync(path.join(root,'reporting-v2.css'),'utf8');
  assert.match(css,/@media print/);
  assert.match(css,/\.sidebar/);
  assert.match(css,/\.topbar/);
  assert.match(css,/\.app-footer/);
  assert.match(css,/report-print-meta/);
  assert.match(css,/report-v2-no-print/);
});
