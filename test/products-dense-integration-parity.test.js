'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function includesAll(source, markers, label) {
  for (const marker of markers) assert.ok(source.includes(marker), `${label}: missing ${marker}`);
}

test('Products dense assets load before app and preserve legacy assets', () => {
  const index = read('desktop/renderer/index.html');
  includesAll(index, ['./ux-components.css', './products-dense-view.css', './ux-components.js', './products-dense-view.js', './app.js'], 'index');
  assert.ok(index.indexOf('./ux-components.js') < index.indexOf('./products-dense-view.js'));
  assert.ok(index.indexOf('./products-dense-view.js') < index.indexOf('./app.js'));
});

test('Products dense view is enabled by a reversible feature flag and legacy renderer remains present', () => {
  const app = read('desktop/renderer/app.js');
  includesAll(app, [
    'productsDenseView: true',
    'window.PdvFeatureFlags = featureFlags',
    "productStockFilter: ''",
    'function renderProductsLegacy()',
    'function renderProductsDense()',
    'function renderProducts()',
    'featureFlags.productsDenseView',
    'window.PdvProductsDenseView',
    'window.ArtisysUxComponents'
  ], 'app');
});

test('legacy and dense Products paths preserve every current top-level action hook', () => {
  const app = read('desktop/renderer/app.js');
  const dense = read('desktop/renderer/products-dense-view.js');
  const hooks = [
    'new-product',
    'new-category',
    'product-page-search',
    'sync-product-photos',
    'data-product-photo-edit',
    'data-product-photo-remove',
    'data-edit-product'
  ];
  for (const hook of hooks) {
    assert.ok(app.includes(hook), `legacy path must keep ${hook}`);
    assert.ok(dense.includes(hook), `dense path must keep ${hook}`);
  }
  includesAll(app, ['product-category-filter', 'openProductForm', 'openCategoryForm', 'syncProductPhotos', 'uploadProductPhoto', 'removeProductPhoto'], 'legacy behavior');
  includesAll(dense, ['data-filter-id', 'category', 'stock', 'Custo', 'Margem', 'data-product-stock-cell'], 'dense behavior');
});

test('dense Products integrates category and stock filters without replacing canonical search semantics', () => {
  const app = read('desktop/renderer/app.js');
  includesAll(app, [
    'ui.filterProducts(state.products, state.productQuery, state.categoryId)',
    'dense.filterByStock(',
    "filter.dataset.filterId === 'category'",
    "filter.dataset.filterId === 'stock'",
    'state.productStockFilter',
    "event.key.toLowerCase() === 'k'",
    "state.route === 'products'"
  ], 'dense filters');
});

test('product variants explicitly supports both legacy div rows and dense table rows', () => {
  const variants = read('desktop/renderer/product-variants-ui.js');
  includesAll(variants, [
    "data-products-view",
    'products-dense-table',
    'data-product-title',
    'data-product-stock-cell',
    'variantDenseRowHtml',
    'variantLegacyRowHtml',
    'data-new-product-variant',
    'data-edit-product-variant'
  ], 'variants parity');
});

test('phase 4 parity matrix is versioned and blocks legacy removal', () => {
  const matrixPath = path.join(root, 'docs', 'architecture', 'products-dense-parity.md');
  assert.equal(fs.existsSync(matrixPath), true);
  const matrix = fs.readFileSync(matrixPath, 'utf8');
  includesAll(matrix, [
    'Feature flag',
    'Legacy',
    'Dense',
    'Novo produto',
    'Categoria',
    'Fotos',
    'Variações',
    'Kits e combos',
    'Dados fiscais',
    'não remover o renderer legado'
  ], 'parity matrix');
});
