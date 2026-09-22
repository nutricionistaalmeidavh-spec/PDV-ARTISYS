'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rendererDir = path.join(__dirname, '..', 'desktop', 'renderer');
const toastPath = path.join(rendererDir, 'toast-ui.js');
const toastStylesPath = path.join(rendererDir, 'toast-ui.css');
const indexSource = fs.readFileSync(path.join(rendererDir, 'index.html'), 'utf8');

function readToastSource() {
  assert.ok(fs.existsSync(toastPath), 'desktop renderer must expose a shared toast-ui.js module');
  return fs.readFileSync(toastPath, 'utf8');
}

function readToastStyles() {
  assert.ok(fs.existsSync(toastStylesPath), 'desktop renderer must expose toast-ui.css');
  return fs.readFileSync(toastStylesPath, 'utf8');
}

test('desktop loads the shared toast assets before app.js', () => {
  assert.ok(indexSource.includes('<link rel="stylesheet" href="./toast-ui.css" />'), 'index.html must load toast-ui.css');
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
  assert.ok(source.includes("active.find((node) => node.dataset.toastType !== 'error')"), 'non-error notifications must not evict visible errors');
});

test('toast CSS supports compact close affordance and exit animation', () => {
  const stylesSource = readToastStyles();
  assert.ok(stylesSource.includes('.toast-close'), 'toast close button must be styled');
  assert.ok(stylesSource.includes('.toast-close::before'), 'visual close glyph must not contaminate toast textContent');
  assert.ok(stylesSource.includes('.toast.is-leaving'), 'toast exit state must be styled');
  assert.ok(stylesSource.includes('@keyframes toastOut'), 'toast exit animation must exist');
  assert.ok(stylesSource.includes('max-width: 360px'), 'toast width must be more compact than the legacy 420px surface');
});

test('legacy toast producers are centralized without rewriting their business flows', () => {
  const source = readToastSource();
  assert.ok(source.includes('installLegacyAppendBridge'), 'shared manager must adopt legacy toast append calls');
  assert.ok(source.includes('toastRoot.appendChild = function appendManagedToast'), 'toast root must route legacy appendChild calls through the shared policy');
  assert.ok(source.includes('nativeAppendChild(node)'), 'managed nodes must bypass the compatibility bridge without recursion');
});

test('manual close control keeps exact success text compatible with existing observers', () => {
  const source = readToastSource();
  assert.ok(source.includes("messageNode.textContent = message"));
  assert.equal(source.includes("closeButton.textContent = '×'"), false, 'close glyph must remain CSS-only so toast textContent stays canonical');
});
