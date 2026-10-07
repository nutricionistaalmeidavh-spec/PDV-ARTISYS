'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve('.');
const json=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const text=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const FOOD_IDS=[
  '37-criar-ficha-tecnica',
  '38-escolher-aparencia-cardapio',
  '39-gerar-qr-mesa',
  '40-cliente-fazer-pedido-qr',
  '41-abrir-mesa-comanda',
  '42-garcom-acompanhar-pedido',
  '43-kds-preparar-pedido',
  '44-kds-garcom-sincronizacao',
  '45-levar-comanda-caixa-pagar',
  '46-criar-ficha-tecnica-pizza-calabresa',
  '47-configurar-pizza-tamanhos-sabores-borda'
];

test('food tutorial catalog prioritizes the complete customer-to-cash journey',()=>{
  const catalog=json('qa/tutorials/catalog.json');
  const rows=FOOD_IDS.map(id=>catalog.tutorials.find(item=>item.id===id));
  assert.equal(rows.every(Boolean),true);
  assert.equal(rows.every(item=>item.phase==='P0'),true);
  assert.equal(rows.every(item=>item.durationTargetSec<=30),true);
});

test('food tutorials are executable QA demos with a dedicated adapter',()=>{
  const config=json('qa/artisys-qa.config.json');
  for(const id of FOOD_IDS){
    const demo=config.demos?.[id];
    assert.ok(demo,id);
    assert.equal(demo.profile,'tutorials-food',id);
    const flow=json(path.join('qa',demo.file));
    assert.equal(flow.metadata?.qaAutoAdmin,true,id);
    assert.equal(flow.steps[0]?.action,'authenticateLocalQa',id);
    assert.ok(flow.steps.some(step=>step.action==='capability'&&step.name==='tutorial.food.setup'),id);
    assert.ok(flow.steps.some(step=>step.action==='expectVisible'||step.action==='expectText'),id);
  }
});

test('food demos cover recipe, menu layouts, QR, customer order, waiter, KDS synchronization and checkout',()=>{
  const combined=FOOD_IDS.map(id=>text(`qa/demo/tutorials/${id}.json`)).join('\n');
  assert.match(combined,/recipe-product-form/);
  assert.match(combined,/menu-layout-option/);
  assert.match(combined,/public-qr-preview/);
  assert.match(combined,/send-order/);
  assert.match(combined,/waiter-layout/);
  assert.match(combined,/kitchen-board/);
  assert.match(combined,/PREPARING/);
  assert.match(combined,/READY/);
  assert.match(combined,/data-checkout/);
  assert.match(combined,/confirm-payment/);
});

test('full refresh capture workflow records all 47 tutorials from current main-compatible QA',()=>{
  const workflow=text('.github/workflows/tutorial-capture-full-refresh.yml');
  const catalog=json('qa/tutorials/catalog.json');
  assert.equal(catalog.tutorials.length,47);
  for(const tutorial of catalog.tutorials)assert.ok(workflow.includes(tutorial.id),tutorial.id);
  assert.match(workflow,/artisys-qa\.mjs demo/);
  assert.match(workflow,/qa:tutorials:edit/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
});


test('mobile PWA tutorials use portrait output and mixed KDS/waiter switches viewport without distortion',()=>{
  const config=json('qa/artisys-qa.config.json');
  assert.equal(config.demos['40-cliente-fazer-pedido-qr'].preset,'reels-9x16');
  assert.deepEqual(config.demos['40-cliente-fazer-pedido-qr'].captureViewport,{width:412,height:915});
  assert.equal(config.demos['42-garcom-acompanhar-pedido'].preset,'reels-9x16');
  assert.deepEqual(config.demos['42-garcom-acompanhar-pedido'].captureViewport,{width:390,height:844});

  const mixed=json('qa/demo/tutorials/44-kds-garcom-sincronizacao.json');
  const sizes=mixed.steps.filter(step=>step.action==='setViewportSize').map(step=>[step.width,step.height]);
  assert.deepEqual(sizes,[[390,844],[1100,720],[390,844]]);
});


test('burger tutorial uses a complete sandwich recipe, attaches a real demo image and shows it in the public menu',()=>{
  const recipe=json('qa/demo/tutorials/37-criar-ficha-tecnica.json');
  const appearance=json('qa/demo/tutorials/38-escolher-aparencia-cardapio.json');
  const combined=JSON.stringify(recipe);
  for(const ingredient of [
    'tutorial-ingredient-bread',
    'tutorial-ingredient-meat',
    'tutorial-ingredient-cheese',
    'tutorial-ingredient-lettuce',
    'tutorial-ingredient-tomato',
    'tutorial-ingredient-sauce'
  ]) assert.match(combined,new RegExp(ingredient));
  assert.ok(recipe.steps.some(step=>step.action==='capability'&&step.name==='tutorial.food.photo'&&step.productName==='Hambúrguer Artesanal'));
  assert.ok(appearance.steps.some(step=>step.action==='expectVisible'&&/product-card.*has-photo/.test(step.selector||'')));
  assert.ok(appearance.steps.some(step=>step.action==='expectVisible'&&/product-photo/.test(step.selector||'')));
});

test('pizza tutorials cover full recipe plus friendly size, flavor, crust and pricing flow',()=>{
  const recipe=json('qa/demo/tutorials/46-criar-ficha-tecnica-pizza-calabresa.json');
  const config=json('qa/demo/tutorials/47-configurar-pizza-tamanhos-sabores-borda.json');
  const recipeText=JSON.stringify(recipe);
  for(const ingredient of [
    'tutorial-pizza-dough',
    'tutorial-pizza-tomato-sauce',
    'tutorial-pizza-mozzarella',
    'tutorial-pizza-calabresa',
    'tutorial-pizza-onion',
    'tutorial-pizza-oregano'
  ]) assert.match(recipeText,new RegExp(ingredient));
  assert.ok(recipe.steps.some(step=>step.action==='capability'&&step.name==='tutorial.food.photo'&&step.productName==='Pizza Calabresa'));

  const configText=JSON.stringify(config);
  assert.match(configText,/pizza-profile-form/);
  assert.match(configText,/pizza-size-form/);
  assert.match(configText,/pizza-flavor-form/);
  assert.match(configText,/pizza-crust-form/);
  assert.match(configText,/Grande/);
  assert.match(configText,/Calabresa/);
  assert.match(configText,/Marguerita/);
  assert.match(configText,/Catupiry/);
  assert.match(configText,/Preço calculado/);
});
