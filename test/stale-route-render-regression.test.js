'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../desktop/renderer/app.js'), 'utf8');

test('async product save does not redraw Products after another route became active', () => {
  assert.match(source, /function isRouteActive\(route\)/);
  assert.match(
    source,
    /closeModal\(\);\s*if \(isRouteActive\('products'\)\) renderProducts\(\);\s*showToast\('Produto salvo\.', 'success'\)/,
  );
});
