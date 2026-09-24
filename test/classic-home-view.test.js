'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('classic home assets are loaded after the operational home enhancer', () => {
  const html = read('desktop/renderer/index.html');
  assert.match(html, /\.\/classic-home-ui\.css/);
  assert.match(html, /\.\/classic-home-ui\.js/);
  assert.ok(html.indexOf('./ux-home-checkout.js') < html.indexOf('./classic-home-ui.js'));
});

test('classic home reuses HOME_TILES and native operational launchers', () => {
  const js = read('desktop/renderer/classic-home-ui.js');
  assert.match(js, /ui\?\.HOME_TILES/);
  assert.match(js, /ui\.HOME_TILES\.map/);
  assert.match(js, /data-classic-route/);
  assert.match(js, /data-home-route/);
  assert.match(js, /nativeLauncher\.click\(\)/);
  assert.match(js, /#sidebar-nav \[data-route=\\?"home\\?"\]/);
});

test('classic home keeps the operational home mounted and only hides it while active', () => {
  const js = read('desktop/renderer/classic-home-ui.js');
  assert.match(js, /operationalHome\.hidden = true/);
  assert.doesNotMatch(js, /operationalHome\.remove\(\)/);
  assert.match(js, /setClassicShell\(false\)/);
});

test('classic home source is valid JavaScript', () => {
  execFileSync(process.execPath, ['--check', path.join(root, 'desktop/renderer/classic-home-ui.js')], { stdio: 'pipe' });
});

test('classic home visual grid covers the same ten module launchers', () => {
  const ui = require(path.join(root, 'desktop/renderer/ui-model.js'));
  assert.equal(ui.HOME_TILES.length, 10);
  assert.deepEqual(ui.HOME_TILES.map((tile) => tile.shortcut), ['F2','F3','F4','F5','F6','F7','F8','F9','F10','F11']);
  assert.deepEqual(ui.HOME_TILES.map((tile) => tile.route), [
    'checkout','customers','sellers','products','inventory','cash','finance','reports','sales','returns'
  ]);
});
