'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererDir = path.join(__dirname, '..', 'desktop', 'renderer');
const toastPath = path.join(rendererDir, 'toast-ui.js');
const indexSource = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');
const stylesSource = fs.readFileSync(path.join(rendererDir, 'styles.css'), 'utf8');
const appSource = fs.readFileSync(path.join(rendererDir, 'app.js'), 'utf8');

function readToastSource() {
  assert.ok(fs.existsSync(toastPath), 'desktop renderer must expose a shared toast-ui.js module');
  return fs.readFileSync(toastPath, 'utf8');
}

test('desktop loads the shared toast module before app.js', () => {
  assert.ok(indexSource.includes('<script src="./toast-ui.js"></script>'), 'index.html must load toast-ui.js');
  assert.ok(indexSource.indexOf('./toast-ui.js') < indexSource.indexOf('./app.js'), 'toast-ui.js must load before app.js');
});

test('shared toast policy limits visual noise and preserves errors', () => {
  const source = readToastSource();
  assert.match(source, /SUCCESS_DURATION_MS\s*=\s*2000/);
  assert.match(source, /ERROR_DURATION_MS\s*=\s*6000/);
  assert.match(source, /MAX_VISIBLE\s*=\s*2/);
  assert.ok(source.includes('data-toast-close'), 'toasts must expose a manual close control');
  assert.ok(source.includes('findDuplicateToast'), 'identical visible messages must be deduplicated');
  assert.ok(source.includes("type === 'error'"), 'error toasts must be explicitly prioritized');
});

test('toast CSS supports compact close affordance and exit animation', () => {
  assert.ok(stylesSource.includes('.toast-close'), 'toast close button must be styled');
  assert.ok(stylesSource.includes('.toast.is-leaving'), 'toast exit state must be styled');
  assert.ok(stylesSource.includes('@keyframes toastOut'), 'toast exit animation must exist');
});

test('app.js delegates normal notifications to the centralized manager', () => {
  assert.ok(appSource.includes('window.PdvToast.show(message, type)'), 'app showToast must delegate to PdvToast');
  assert.equal(appSource.includes('toastRoot.appendChild(toast)'), false, 'app.js must not create unmanaged toast nodes');
});
