const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('desktop shell contains approved navigation and topbar landmarks', () => {
  const html = read('desktop/renderer/index.html');
  assert.match(html, /id="app-sidebar"/);
  assert.match(html, /id="app-topbar"/);
  assert.match(html, /id="network-status"/);
  assert.match(html, /id="route-content"/);
  assert.match(html, /ARTISYS/);
});

test('renderer contains definitive home and checkout flows through named renderers', () => {
  const app = read('desktop/renderer/app.js');
  for (const name of ['renderHome', 'renderCheckout', 'renderCustomers', 'renderSellers', 'renderProducts']) {
    assert.match(app, new RegExp(`function ${name}\\b`));
  }
  assert.match(app, /Finalizar venda/);
  assert.match(app, /Balcão/);
});

test('styles define visual tokens and checkout split layout from approved references', () => {
  const css = read('desktop/renderer/styles.css');
  assert.match(css, /--artisys-blue:/);
  assert.match(css, /\.home-grid/);
  assert.match(css, /\.checkout-layout/);
  assert.match(css, /\.sale-panel/);
  assert.match(css, /\.product-grid/);
});

test('Electron preload exposes safe window controls and desktop config only', () => {
  const preload = read('desktop/preload.cjs');
  assert.match(preload, /contextBridge/);
  assert.match(preload, /minimize/);
  assert.match(preload, /maximize/);
  assert.match(preload, /close/);
  assert.doesNotMatch(preload, /nodeIntegration\s*:\s*true/);
});
