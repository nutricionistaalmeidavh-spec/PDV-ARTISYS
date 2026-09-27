'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('product removal is wired end-to-end as a safe soft delete', () => {
  const dense = read('desktop/renderer/products-dense-view.js');
  const app = read('desktop/renderer/app.js');
  const api = read('desktop/renderer/api-client.js');
  const router = read('server/router.js');
  const catalog = read('js/domains/catalog/catalog-service.js');

  assert.match(dense, /data-remove-product=/);
  assert.match(dense, />Excluir<\/button>/);
  assert.match(app, /removeCatalogProduct/);
  assert.match(app, /api\.removeProduct\(productId\)/);
  assert.match(api, /removeProduct\(productId\)/);
  assert.match(api, /method: 'DELETE'/);
  assert.match(router, /runtime\.catalog\.removeProduct/);
  assert.match(catalog, /function removeProduct/);
  assert.match(catalog, /UPDATE products SET active=0/);
  assert.match(catalog, /action: 'product\.remove'/);
});
