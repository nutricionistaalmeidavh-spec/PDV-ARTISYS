'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../desktop/renderer/operational-route-stability.js'), 'utf8');
const operational = fs.readFileSync(path.join(__dirname, '../desktop/renderer/operational-pages.js'), 'utf8');
const reportsV2 = fs.readFileSync(path.join(__dirname, '../desktop/renderer/reporting-v2.js'), 'utf8');

test('route stability restores Reports through the canonical reporting v2 renderer', () => {
  assert.match(source, /const reportsV2 = window\.PdvReportsV2;/);
  assert.match(source, /if \(route === 'reports' && typeof reportsV2\?\.render === 'function'\) \{[\s\S]*await reportsV2\.render\(\);[\s\S]*return;/);
  assert.match(source, /await operational\.showRoute\(route\);/);
});

test('route stability stays guarded and coalesces mutation callbacks', () => {
  assert.match(source, /if \(restoring \|\| content\.querySelector\('\.ops-page'\)\) return;/);
  assert.match(source, /if \(scheduled\) return;[\s\S]*scheduled = true;[\s\S]*queueMicrotask\(\(\) => \{[\s\S]*scheduled = false;[\s\S]*void stabilize\(\)/);
  assert.match(source, /new MutationObserver\(schedule\)\.observe\(content, \{ childList: true, subtree: true \}\)/);
});

test('route stability preserves intentional vertical subviews owned by Settings', () => {
  assert.match(source, /function hasOwnedSubview\(route\)/);
  assert.match(source, /route === 'settings' && Boolean\(content\.querySelector\('\.vertical-page'\)\)/);
  assert.match(source, /if \(!route \|\| hasOwnedSubview\(route\)\) return;/);
});

test('route stability preserves the dedicated Returns UI instead of remounting the canonical route', () => {
  assert.match(source, /route === 'returns' && Boolean\(content\.querySelector\('\[data-returns-ui\]'\)\)/);
});

test('all operational routes use the shared active-route marker for recovery', () => {
  for (const route of ['inventory','cash','sales','returns','finance','reports','settings']) {
    assert.match(source, new RegExp(`['\"]${route}['\"]`));
  }
  assert.match(source, /document\.body\.dataset\.activeRoute/);
  assert.doesNotMatch(source, /#sidebar-nav \[data-route\]\.active/);
});

test('operational renderers refuse to commit after navigation moved elsewhere', () => {
  assert.match(operational, /function routeActive\(route\)\{return document\.body\.dataset\.activeRoute===route;\}/);
  assert.match(operational, /function markActive\(route\)\{document\.body\.dataset\.activeRoute=route;/);
  for (const [name, route] of [
    ['renderInventory','inventory'],
    ['renderCash','cash'],
    ['renderSalesHistory','sales'],
    ['renderReturns','returns'],
    ['renderFinance','finance'],
    ['renderReports','reports'],
    ['renderSettings','settings'],
  ]) {
    const start = operational.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const next = operational.indexOf('\n  async function ', start + 20);
    const block = operational.slice(start, next === -1 ? operational.length : next);
    assert.match(block, new RegExp(`if\\(!routeActive\\('${route}'\\)\\)return;`), `${name} must guard its final render`);
  }
});

test('reporting v2 does not commit a stale report after leaving Reports', () => {
  assert.match(reportsV2, /function routeActive\(\) \{ return document\.body\.dataset\.activeRoute === 'reports'; \}/);
  assert.match(reportsV2, /if \(!routeActive\(\)\) return;/);
});
