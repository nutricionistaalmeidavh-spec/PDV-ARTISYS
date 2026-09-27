'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const css=fs.readFileSync(path.join(__dirname,'..','desktop/renderer/ux-home-checkout.css'),'utf8');

test('compact checkout keeps the cart region from shrinking into totals',()=>{
  assert.match(css,/\.sale-cart-region\s*\{[^}]*flex-shrink:\s*0;/s);
  assert.match(css,/@media \(max-height:800px\)[\s\S]*\.sale-cart-region \.cart-list \{[^}]*min-height:100px;/s);
});
