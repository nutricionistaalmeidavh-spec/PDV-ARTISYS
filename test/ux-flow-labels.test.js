'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('Cardápio uses publication-oriented labels instead of product-creation wording',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/<h1>Cardápio<\/h1>/);
  assert.match(app,/id="new-product">\+ Adicionar ao Cardápio<\/button>/);
  assert.match(app,/product\.prepared\?'Ver ficha técnica':'Ver cadastro'/);
  assert.doesNotMatch(app,/>Ver origem<\/button>/);

  const dense=read('desktop/renderer/products-dense-view.js');
  assert.match(dense,/product\.prepared\s*\?\s*'Ver ficha técnica'\s*:\s*'Ver cadastro'/);
  assert.doesNotMatch(dense,/>Ver origem<\/button>/);
});

test('restaurant ordering uses generic production wording for mixed direct and KDS items',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.match(restaurant,/>Enviar pedido<\/button>/);
  assert.doesNotMatch(restaurant,/Enviar \$\{draftItems\.length\|\|0\} item\(ns\) para a cozinha/);
  assert.match(restaurant,/<h2>Produção \/ KDS<\/h2>/);
  assert.doesNotMatch(restaurant,/<h2>Cozinha \/ KDS<\/h2>/);
});
