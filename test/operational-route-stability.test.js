'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../desktop/renderer/operational-route-stability.js'), 'utf8');

test('route stability restores Reports through the canonical reporting v2 renderer', () => {
  assert.match(source, /const reportsV2 = window\.PdvReportsV2;/);
  assert.match(source, /if \(route === 'reports' && typeof reportsV2\?\.render === 'function'\) \{[\s\S]*await reportsV2\.render\(\);[\s\S]*return;/);
  assert.match(source, /await operational\.showRoute\(route\);/);
});

test('route stability stays guarded and coalesces mutation callbacks', () => {
  assert.match(source, /if \(restoring \|\| content\.querySelector\('\.ops-page'\)\) return;/);
  assert.match(source, /if \(scheduled\) return;[\s\S]*scheduled = true;[\s\S]*queueMicrotask\(\(\) => \{[\s\S]*scheduled = false;[\s\S]*void stabilize\(\)/);
  assert.match(source, /new MutationObserver\(\(records\) => \{[\s\S]*captureDetachedPage\(records\);[\s\S]*schedule\(\);[\s\S]*\}\)\.observe\(content, \{ childList: true, subtree: true \}\)/);
});

test('route stability preserves a detached operational page before restoring the route', () => {
  assert.match(source, /function captureDetachedPage\(records\)/);
  assert.match(source, /record\.removedNodes/);
  assert.match(source, /detachedStablePage = candidate/);
  assert.match(source, /detachedStableRoute = route/);
  assert.match(source, /if \(route !== 'reports' && detachedStablePage && detachedStableRoute === route\)/);
  assert.match(source, /content\.replaceChildren\(detachedStablePage\)/);
});
