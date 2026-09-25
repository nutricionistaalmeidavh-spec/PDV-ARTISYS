'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/restaurant-ui.js'),'utf8');
const verticalSource=fs.readFileSync(path.join(__dirname,'../desktop/renderer/vertical-modules.js'),'utf8');

test('nova mesa usa modal interno em vez de prompt incompatível com Electron',()=>{
  assert.doesNotMatch(source,/root\.prompt\s*\(/);
  assert.match(source,/function openNewTableModal\(\)/);
  assert.match(source,/id="restaurant-new-table-form"/);
  assert.match(source,/name="label"/);
  assert.match(source,/name="seats"/);
  assert.match(source,/\/api\/v1\/restaurant\/tables/);
});

test('launcher do restaurante obedece ao estado do modulo e some quando desativado',()=>{
  assert.match(source,/api\.modules\(\)/);
  assert.match(source,/function setRestaurantEnabled\(enabled\)/);
  assert.match(source,/function removeLaunchers\(\)/);
  assert.match(source,/if\(!restaurantEnabled\)\{removeLaunchers\(\);return;\}/);
  assert.match(source,/setEnabled:setRestaurantEnabled/);
  assert.match(verticalSource,/PdvRestaurantUi\?\.setEnabled\?\.\(target\)/);
});

test('launcher stale do restaurante nao abre configuracoes quando modulo esta desligado',()=>{
  assert.match(source,/if\(!restaurantEnabled\)return;/);
  assert.doesNotMatch(source,/data-restaurant-route[^\n]*showRoute\?\.\('settings'\)/);
});
