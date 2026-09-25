'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-ui.js'),'utf8');

test('nova mesa usa modal interno em vez de prompt incompatível com Electron',()=>{
  assert.doesNotMatch(source,/root\.prompt\s*\(/);
  assert.match(source,/function openNewTableModal\(\)/);
  assert.match(source,/id="restaurant-new-table-form"/);
  assert.match(source,/name="label"/);
  assert.match(source,/name="seats"/);
  assert.match(source,/\/api\/v1\/restaurant\/tables/);
});

test('launcher do restaurante obedece ao estado do modulo e some quando desativado',()=>{
  const gatePath=path.join(root,'desktop/renderer/restaurant-module-gate.js');
  assert.equal(fs.existsSync(gatePath),true,'restaurant-module-gate.js deve existir');
  const gate=fs.readFileSync(gatePath,'utf8');
  const html=fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
  assert.match(gate,/api\.modules\(\)/);
  assert.match(gate,/modules\.find\(module=>module\.id==='RESTAURANT'\)/);
  assert.match(gate,/restaurant\?\.enabled/);
  assert.match(gate,/\[data-restaurant-route\]/);
  assert.match(gate,/launcher\.hidden\s*=\s*!restaurantEnabled/);
  assert.match(gate,/ApiClient\.prototype\.saveSetting/);
  assert.ok(html.indexOf('./restaurant-module-gate.js')<html.indexOf('./restaurant-ui.js'),'gate deve carregar antes de restaurant-ui.js');
});

test('launcher stale do restaurante nao abre configuracoes quando modulo esta desligado',()=>{
  const gate=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-module-gate.js'),'utf8');
  assert.match(gate,/stopImmediatePropagation\(\)/);
  assert.match(gate,/if\(!target\|\|restaurantEnabled\)return/);
  assert.doesNotMatch(gate,/showRoute\?\.\('settings'\)/);
});
