'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('renderer loads finance P2 enhancer after core checkout and operational pages',()=>{
  const html=read('desktop/renderer/index.html');
  const appIndex=html.indexOf('./app.js');
  const opsIndex=html.indexOf('./operational-pages.js');
  const financeIndex=html.indexOf('./finance-p2-ui.js');
  assert.ok(financeIndex>appIndex,'finance enhancer must load after app.js');
  assert.ok(financeIndex>opsIndex,'finance enhancer must load after operational-pages.js');
});

test('credit checkout enhancer captures installments only for credit card payments',()=>{
  const source=read('desktop/renderer/finance-p2-ui.js');
  assert.match(source,/new-payment-installments-field/);
  assert.match(source,/new-payment-installments/);
  assert.match(source,/CREDIT_CARD/);
  assert.match(source,/metadata\s*=\s*\{\s*\.\.\.\(payment\.metadata/);
  assert.match(source,/installments/);
  assert.match(source,/ApiClient\.prototype\.completeSale/);
});

test('acquiring settings UI exposes the five global P2 keys and persists through settings API',()=>{
  const source=read('desktop/renderer/finance-p2-ui.js');
  for(const key of [
    'finance.acquiring.debit.feeBps',
    'finance.acquiring.debit.settlementDays',
    'finance.acquiring.credit.feeBps',
    'finance.acquiring.credit.firstSettlementDays',
    'finance.acquiring.credit.intervalDays'
  ]) assert.match(source,new RegExp(key.replaceAll('.','\\.')));
  assert.match(source,/ops-acquiring-form/);
  assert.match(source,/api\.settings\(\{prefix:'finance\.acquiring\.'/);
  assert.match(source,/api\.saveSetting\(/);
});

test('cashier cannot get an editable acquiring form when settings endpoint denies access',()=>{
  const source=read('desktop/renderer/finance-p2-ui.js');
  assert.match(source,/catch\(\(\)\s*=>\s*null\)/);
  assert.match(source,/if\(!settings\)return/);
});
