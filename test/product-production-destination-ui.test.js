const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const app=fs.readFileSync(path.join(root,'desktop/renderer/app.js'),'utf8');
const restaurantRouter=fs.readFileSync(path.join(root,'server/restaurant-router.js'),'utf8');

test('product and recipe forms expose one canonical production destination field in Estoque',()=>{
  assert.match(app,/function productionDestinationMarkup\(/);
  assert.match(app,/Sem KDS — garçom entrega/);
  assert.match(app,/Produção · enviar ao KDS/);
  assert.match(app,/\/api\/v1\/restaurant\/kitchen\/routing/);
  assert.match(app,/\/api\/v1\/restaurant\/kitchen\/stations/);
  assert.ok((app.match(/persistProductionDestination\(root,saved(?:Product)?\.id\)/g)||[]).length>=2,
    'stock product and technical sheet saves must persist the same canonical route');
});

test('a product route can be read before the product is added to Cardapio',()=>{
  assert.ok(restaurantRouter.includes('const productRouting=pathname.match('));
  assert.match(restaurantRouter,/runtime\.kitchen\.getProductRoute/);
});

test('product and recipe validate destination before creating a new catalog record',()=>{
  assert.match(app,/await requireProductionDestination\(root\); const saved=await api\.saveProduct/);
  assert.match(app,/await requireProductionDestination\(root\);savedProduct=await api\.saveProduct/);
});

test('Cardapio only consumes the canonical destination and sends missing configuration to Estoque',()=>{
  assert.match(app,/function ensureMenuProductHasDestination\(/);
  assert.match(app,/function openInventoryConfigurationRequired\(/);
  assert.match(app,/PdvCatalogAdmin\?\.openInventoryItem\?\.\(product\.id\)/);
  assert.doesNotMatch(app,/function openMenuDestinationForm\(/);
  assert.doesNotMatch(app,/data-product-destination-edit/);
});

test('menu list exposes destination read-only and inventory has one deep-link editor',()=>{
  assert.match(app,/productionDestinationLabel\(/);
  assert.match(app,/data-production-destination/);
  assert.match(app,/function openInventoryItem\(productId\)/);
  assert.match(app,/PdvCatalogAdmin = Object\.freeze\(\{[^}]*openInventoryItem/s);
});

test('falha em consultar destinos aparece no cadastro sem impedir salvar o Estoque Core',async()=>{
  const source=app.match(/  async function mountProductionDestination\(root,product=null\) \{[\s\S]*?\n  \}/);
  assert.ok(source,'carregamento do destino deve existir no cadastro');
  const mount=vm.runInNewContext(`${source[0]}\nmountProductionDestination`,{
    api:{request:async()=>{throw new Error('Falha de conexão temporária');}},
  });
  const select={disabled:false,innerHTML:''};
  const help={textContent:''};
  const host={
    hidden:true,dataset:{available:'loading'},
    querySelector:(selector)=>selector==='small'?help:select
  };
  const root={querySelector:(selector)=>selector==='[data-production-destination]'?host:null};
  assert.equal(await mount(root,{id:'agua'}),null);
  assert.equal(host.dataset.available,'false');
  assert.equal(host.hidden,false,'falha de carregamento não deve sumir da tela');
  assert.equal(select.disabled,true,'não é possível escolher destino desconhecido');
  assert.match(help.textContent,/Não foi possível carregar os destinos/);
  assert.match(help.textContent,/salvo no Estoque/);
  assert.match(app,/Não foi possível confirmar o destino do pedido/);
});

test('Cardapio bloqueia duplo clique durante inclusão e conserva correção no cadastro canônico',()=>{
  assert.match(app,/button\.disabled=true;try\{await addMenuSourceProduct\(product\)/);
  assert.match(app,/finally\{if\(button\.isConnected\)button\.disabled=false;/);
  assert.match(app,/PdvCatalogAdmin\?\.openInventoryItem\?\.\(product\.id\)/);
  assert.doesNotMatch(app,/function openMenuDestinationForm\(/,'destino permanece editável somente no Estoque');
});

