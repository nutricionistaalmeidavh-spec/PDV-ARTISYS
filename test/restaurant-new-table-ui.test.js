'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/restaurant-ui.js'),'utf8');

test('nova mesa usa modal interno em vez de prompt incompatível com Electron',()=>{
  assert.doesNotMatch(source,/root\.prompt\s*\(/);
  assert.match(source,/function openNewTableModal\(\)/);
  assert.match(source,/id="restaurant-new-table-form"/);
  assert.match(source,/name="label"/);
  assert.match(source,/name="seats"/);
  assert.match(source,/\/api\/v1\/restaurant\/tables/);
});
