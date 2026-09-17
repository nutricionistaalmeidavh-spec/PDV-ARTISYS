'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('finance P5 keeps legacy settle selector for flow 10',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','finance-p5-p6-ui.js'),'utf8');
  assert.match(source,/data-finance-settle=/);
  assert.match(source,/data-p5-finance-settle=/);
});

test('finance sale backlink uses operational router directly before fallback navigation',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','finance-p5-p6-ui.js'),'utf8');
  assert.match(source,/PdvOperationalUi\?\.showRoute/);
  assert.match(source,/await root\.PdvOperationalUi\.showRoute\('sales'\)/);
});
