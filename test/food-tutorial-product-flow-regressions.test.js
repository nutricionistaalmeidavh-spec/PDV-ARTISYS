'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve('.');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('recipe component number inputs accept ordinary whole-number quantities',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/data-recipe-quantity type="number" min="0\.001" step="0\.001"/);
  assert.match(app,/data-recipe-conversion type="number" min="0\.001" step="0\.001"/);
  assert.doesNotMatch(app,/data-recipe-(?:quantity|conversion) type="number" min="0\.0001"/);
});

test('restaurant checkout opens the exact sale created from the comanda',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.match(restaurant,/PdvAppNavigation\?\.openCheckoutSale\?\.\(result\.sale\.id\)/);
  assert.doesNotMatch(restaurant,/document\.querySelector\('\[data-route="checkout"\]'\)\?\.click\(\)/);
});
