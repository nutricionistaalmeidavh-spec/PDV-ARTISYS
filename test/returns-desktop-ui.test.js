'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererRoot = path.join(__dirname, '..', 'desktop', 'renderer');
const operational = fs.readFileSync(path.join(rendererRoot, 'operational-pages.js'), 'utf8');
const apiClient = fs.readFileSync(path.join(rendererRoot, 'api-client.js'), 'utf8');
const css = fs.readFileSync(path.join(rendererRoot, 'operational-pages.css'), 'utf8');
const returnsStart = operational.indexOf('async function renderReturns()');
const returnsEnd = operational.indexOf('async function renderFinance()', returnsStart);
const returnsSource = operational.slice(returnsStart, returnsEnd);

test('desktop API client exposes local return authorization', () => {
  assert.match(apiClient, /authorizeReturn\s*\(body\)\s*\{\s*return this\.request\('\/api\/v1\/auth\/authorize'/);
});

test('renderReturns exposes sale search, selection, refund and authorization controls', () => {
  assert.ok(returnsStart >= 0 && returnsEnd > returnsStart, 'renderReturns source should be extractable');
  for (const marker of [
    'ops-return-search',
    'ops-return-search-results',
    'data-return-select-sale',
    'ops-return-selected-sale',
    'data-return-item',
    'data-return-qty',
    'ops-return-method',
    'ops-return-reason',
    'ops-return-total',
    'ops-return-authorize',
    'ops-return-authorization',
    'ops-return-submit',
    'ops-return-history'
  ]) assert.match(returnsSource, new RegExp(marker));

  assert.match(returnsSource, /salesHistory\(\{status:'COMPLETED',query,limit:30\}\)/);
  assert.match(returnsSource, /Promise\.all\(\[api\.saleDetails\(saleId\),api\.returns\(\{saleId\}\)\]\)/);
  assert.match(returnsSource, /status==='COMPLETED'/);
  assert.match(returnsSource, /saleItemId/);
  assert.match(returnsSource, /Math\.round\(Number\([^)]*price[^)]*\)\*quantity\)/i);
  assert.match(returnsSource, /api\.authorizeReturn\(/);
  assert.match(returnsSource, /approvalToken/);
});

test('renderReturns keeps delegated authorization inline and clears it when selected sale changes', () => {
  assert.doesNotMatch(returnsSource, /root\.(prompt|confirm)\(/);
  assert.match(returnsSource, /approval=null/);
  assert.match(returnsSource, /selectSale/);
  assert.match(returnsSource, /approval=null;[\s\S]{0,500}Promise\.all\(\[api\.saleDetails/);
});

test('returns desktop CSS includes dedicated search, item and authorization states', () => {
  for (const selector of ['.ops-return-search-results','.ops-return-sale-card','.ops-return-item','.ops-return-authorization','.ops-return-summary']) {
    assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
