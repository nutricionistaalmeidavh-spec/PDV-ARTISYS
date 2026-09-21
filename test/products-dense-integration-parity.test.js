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

test('Products dense assets load around app without removing legacy renderer assets', () => {
  const index = read('desktop/renderer/index.html');
  includesAll(index, [
    './ux-components.css',
    './products-dense-view.css',
    './ux-components.js',
    './feature-flags.js',
    './products-dense-view.js',
    './app.js',
    './products-dense-controller.js'
  ], 'index');
  assert.ok(index.indexOf('./feature-flags.js') < index.indexOf('./app.js'));
  assert.ok(index.indexOf('./products-dense-view.js') < index.indexOf('./app.js'));
  assert.ok(index.indexOf('./app.js') < index.indexOf('./products-dense-controller.js'));
});

test('Products dense view is enabled by a reversible global feature flag', () => {
  const flags = read('desktop/renderer/feature-flags.js');
  includesAll(flags, [
    'productsDenseView: true',
    'window.PdvFeatureFlags',
    'productsDenseView'
  ], 'feature flags');
});

test('legacy Product renderer remains untouched as the source of action handlers', () => {
  const app = read('desktop/renderer/app.js');
  includesAll(app, [
    'function renderProducts()',
    'id="new-product"',
    'id="new-category"',
    'id="product-page-search"',
    'id="product-category-filter"',
    'id="sync-product-photos"',
    'data-product-photo-edit=',
    'data-product-photo-remove=',
    'data-edit-product=',
    'openProductForm',
    'openCategoryForm',
    'syncProductPhotos',
    'uploadProductPhoto',
    'removeProductPhoto'
  ], 'legacy app');
});

test('dense controller augments existing DOM instead of replacing action nodes', () => {
  const controller = read('desktop/renderer/products-dense-controller.js');
  includesAll(controller, [
    'PdvFeatureFlags.productsDenseView',
    'PdvProductsDenseView.productStatus',
    'PdvProductsDenseView.filterByStock',
    'ArtisysUxComponents.StatusBadge',
    'function decorateProducts',
    'dataset.productsView',
    'products-dense-table',
    'data-dense-status-cell',
    '#product-page-search',
    '#product-category-filter',
    '#products-stock-filter',
    '[data-edit-product]',
    '[data-product-photo-edit]',
    '[data-product-photo-remove]'
  ], 'dense controller');
  assert.equal(controller.includes('data-edit-product="'), false, 'controller must not rebuild canonical edit buttons');
  assert.equal(controller.includes('data-product-photo-edit="'), false, 'controller must not rebuild canonical photo buttons');
});

test('dense controller adds stock filtering and Ctrl+K while preserving canonical search/category handlers', () => {
  const controller = read('desktop/renderer/products-dense-controller.js');
  includesAll(controller, [
    'stockFilter',
    "event.key.toLowerCase() !== 'k'",
    "page.querySelector('#product-page-search')",
    "page.querySelector('#product-category-filter')",
    'row.hidden =',
    'filterByStock'
  ], 'dense interaction');
});

test('variants, fiscal fields and kits/combos remain connected through the original DOM hooks', () => {
  const variants = read('desktop/renderer/product-variants-ui.js');
  const fiscal = read('desktop/renderer/product-fiscal-fields.js');
  const kits = read('desktop/renderer/kits-combos-ui.js');
  includesAll(variants, ['.page .data-card', '.data-row', '[data-edit-product]', 'data-new-product-variant', 'data-edit-product-variant'], 'variants');
  includesAll(fiscal, ['#product-form', '#new-product', '[data-edit-product]', 'fiscalProfileId', 'fiscalGtin'], 'fiscal');
  includesAll(kits, ['Kits e combos', 'data-new-kit', 'data-new-combo', 'data-edit-kit', 'data-edit-combo'], 'kits/combos');
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
