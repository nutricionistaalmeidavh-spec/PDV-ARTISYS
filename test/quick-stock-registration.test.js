'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const model = require('../desktop/renderer/quick-stock-model');

test('cadastro rapido usa defaults seguros: produto de venda, saldo controlado e nao publica antes do destino', () => {
  const input = model.normalizeQuickStockInput({name:'Água mineral 500ml',salePrice:'4,50',openingQuantity:'12',publish:true});
  assert.equal(input.product.name,'Água mineral 500ml');
  assert.equal(input.product.salePriceCents,450);
  assert.equal(input.product.usageType,'DIRECT');
  assert.equal(input.product.unit,'UN');
  assert.equal(input.product.trackStock,true);
  assert.equal(input.product.menuEnabled,false);
  assert.equal(input.product.active,true);
  assert.equal(input.openingQuantity,12);
  assert.equal(input.publish,true);
});

test('aceita codigo de barras, categoria, custo e quantidade decimal em virgula', () => {
  const input = model.normalizeQuickStockInput({name:'  Refrigerante 2L ',salePrice:'12,90',cost:'7,25',openingQuantity:'1,250',unit:'LT',barcode:'789123',categoryId:'bebidas',sku:'REF-2',publish:false});
  assert.equal(input.product.name,'Refrigerante 2L');
  assert.equal(input.product.costCents,725);
  assert.equal(input.product.barcode,'789123');
  assert.equal(input.product.sku,'REF-2');
  assert.equal(input.product.categoryId,'bebidas');
  assert.equal(input.product.unit,'LT');
  assert.equal(input.openingQuantity,1.25);
  assert.equal(input.publish,false);
});

test('nao cria cadastro vazio, preco gratis acidental nem quantidade invalida', () => {
  for (const data of [
    {name:' ',salePrice:'2,50'},
    {name:'Água',salePrice:''},
    {name:'Água',salePrice:'abc'},
    {name:'Água',salePrice:'0'},
    {name:'Água',salePrice:'10,999'},
    {name:'Água',salePrice:'3,50',openingQuantity:'-1'},
    {name:'Água',salePrice:'3,50',openingQuantity:'1,1234'},
    {name:'Água',salePrice:'3,50',unit:'LITRO'},
    {name:'Água',salePrice:'3,50',cost:'custo'}
  ]) assert.throws(() => model.normalizeQuickStockInput(data),Error);
});

test('quantidade zero nao obriga movimentacao nem inventa saldo', () => {
  const input = model.normalizeQuickStockInput({name:'Cigarro',salePrice:'15,00'});
  assert.equal(input.openingQuantity,0);
  assert.equal(input.product.trackStock,true);
});

test('caminho rapido convive com cadastro completo e com a rota canonica de estoque', () => {
  const app = fs.readFileSync(path.join(root,'desktop/renderer/app.js'),'utf8');
  const operational = fs.readFileSync(path.join(root,'desktop/renderer/operational-pages.js'),'utf8');
  const index = fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
  assert.match(index,/quick-stock-model\\.js/);
  assert.match(operational,/id="inventory-quick-product"/);
  assert.match(operational,/id="inventory-new-product"/);
  assert.match(operational,/openQuickStockProductForm/);
  assert.match(app,/function openQuickStockProductForm\\(/);
  assert.match(app,/id="quick-stock-product-form"/);
  assert.match(app,/api\\.saveInventoryMovement\\(/);
  assert.match(app,/type:'opening'/);
  assert.match(app,/menuEnabled:true/);
  assert.match(app,/function openProductForm\\(product = null\\)/);
});
