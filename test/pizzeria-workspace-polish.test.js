'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const ui=fs.readFileSync('desktop/renderer/vertical-modules.js','utf8');

test('pizza workspace lets an admin create sizes flavors and crusts without technical ids',()=>{
  assert.match(ui,/data-pizza-catalog-editor/);
  assert.match(ui,/id="pizza-size-form"/);
  assert.match(ui,/id="pizza-flavor-form"/);
  assert.match(ui,/id="pizza-crust-form"/);
  assert.match(ui,/name="productId"[^>]*><option value="">Selecione/);
  assert.doesNotMatch(ui,/ID do produto base/);
  assert.match(ui,/api\.savePizzeriaCatalog/);
});

test('pizza workspace reloads the selected pizza preview after catalog changes',()=>{
  assert.match(ui,/loadProfile\(/);
  assert.match(ui,/pizza-catalog-saved/);
});


test('pizza workspace links size, flavor and crust to canonical recipe consumption without exposing ids',()=>{
  assert.match(ui,/name="recipeMultiplier"/);
  assert.match(ui,/Ficha técnica do sabor/);
  assert.match(ui,/Ficha técnica da borda/);
  assert.match(ui,/name="recipeProductId"/);
  assert.match(ui,/prepared/);
  assert.match(ui,/recipeMultiplier:Number/);
  assert.match(ui,/recipeProductId:String/);
  assert.doesNotMatch(ui,/ID da ficha|recipe_product_id/i);
});
