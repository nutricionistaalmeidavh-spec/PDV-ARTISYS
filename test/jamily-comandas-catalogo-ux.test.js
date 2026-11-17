'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');

test('Cardápio público/QR fica somente na aba administrativa, sem cobrir comandas na operação',()=>{
  const publicUi=read('desktop/renderer/restaurant-public-ordering-ui.js');
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  const settings=read('desktop/renderer/operational-pages.js');
  assert.match(publicUi,/title!=='Configurações'/);
  assert.match(publicUi,/node\.dataset\.settingsCategory='food-menu'/);
  assert.match(read('desktop/renderer/settings-hub-ui.js'),/\['food-menu','Cardápio público e QR'/);
  assert.match(publicUi,/PdvSettingsHub\?\.mount/);
  assert.match(settings,/PdvRestaurantPublicOrderingUi\?\.mount/);
  assert.doesNotMatch(restaurant,/PdvRestaurantPublicOrderingUi\?\.mount/);
  assert.match(publicUi,/Aparência do cardápio/);
  assert.match(publicUi,/QR por mesa/);
});

test('Caixa cancela a comanda a partir da busca, reutilizando motivo e autorização do fluxo canônico',()=>{
  const app=read('desktop/renderer/app.js');
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.match(app,/data-cancel-checkout-command=/);
  assert.match(app,/restaurant\.sessions\.cancel/);
  assert.match(app,/data-checkout-cancel-inline/);
  assert.match(app,/api\.request\(\`\/api\/v1\/restaurant\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/cancel\`/);
  assert.match(app,/verified\.status!=='CANCELLED'/);
  assert.match(restaurant,/async function showCancel\(sessionId\)/);
  assert.match(restaurant,/openCancelComandaModal\(session\)/);
  assert.match(restaurant,/reason:String\(form\.get\('reason'\)/);
  assert.match(restaurant,/root\.PdvRestaurantUi=Object\.freeze\(\{show,reload,showCancel\}\)/);
});

test('Cardápio e Estoque expõem edição e inativação usando mesmo cadastro e soft-delete',()=>{
  const app=read('desktop/renderer/app.js');
  const stock=read('desktop/renderer/operational-pages.js');
  assert.match(app,/data-archive-product/);
  assert.match(app,/function removeCatalogProduct\(productId\)/);
  assert.match(app,/data-edit-product/);
  assert.match(app,/openInventoryItem\?\.\(button\.dataset\.editProduct\)/);
  assert.match(stock,/data-inventory-edit-product/);
  assert.match(stock,/data-inventory-archive-product/);
  assert.match(stock,/PdvCatalogAdmin\?\.archiveProduct/);
  assert.match(app,/archiveProduct:\s*removeCatalogProduct/);
  assert.match(app,/artisys:product-archived/);
});

test('cadastro rápido sinaliza possíveis duplicatas e oferece edição, sem bloquear itens legítimos',()=>{
  const app=read('desktop/renderer/app.js');
  const index=read('desktop/renderer/index.html');
  assert.match(index,/product-duplicate-model\.js/);
  assert.match(app,/data-product-duplicate-warning/);
  assert.match(app,/PdvProductDuplicateModel/);
  assert.match(app,/data-edit-existing-duplicate/);
  const {findLikelyDuplicate}=require('../desktop/renderer/product-duplicate-model');
  const products=[{id:'1',name:'Café Expresso',sku:'C-1',barcode:'789123',active:true,categoryId:'a'},
                  {id:'2',name:'Café Expresso',sku:'C-2',active:true,categoryId:'b'}];
  assert.equal(findLikelyDuplicate(products,{name:' cafe expresso ',categoryId:'a'})?.product.id,'1');
  assert.equal(findLikelyDuplicate(products,{barcode:'789123',name:'Novo nome'})?.product.id,'1');
  assert.equal(findLikelyDuplicate(products,{sku:'C-2',name:'Outro'})?.product.id,'2');
  assert.equal(findLikelyDuplicate(products,{name:'Café Expresso',categoryId:'c'}),null);
  assert.equal(findLikelyDuplicate(products,{name:'Café Expresso',categoryId:'a'},'1'),null);
});
