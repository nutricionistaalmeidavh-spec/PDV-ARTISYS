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
  '47-configurar-pizza-tamanhos-sabores-borda',
  '48-configurar-pizza-canonica',
  '49-garcom-pedir-pizza',
  '50-cliente-pedir-pizza-qr',
  '51-pizza-kds-comanda-caixa'
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

test('full refresh capture workflow records all 51 tutorials from current main-compatible QA',()=>{
  const workflow=text('.github/workflows/tutorial-capture-full-refresh.yml');
  const catalog=json('qa/tutorials/catalog.json');
  assert.equal(catalog.tutorials.length,51);
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

test('pizza tutorials teach base recipe, flavor recipe, canonical configuration, waiter, QR and checkout',()=>{
  const base=json('qa/demo/tutorials/46-criar-ficha-tecnica-pizza-calabresa.json');
  const flavor=json('qa/demo/tutorials/47-configurar-pizza-tamanhos-sabores-borda.json');
  const config=json('qa/demo/tutorials/48-configurar-pizza-canonica.json');
  const waiter=json('qa/demo/tutorials/49-garcom-pedir-pizza.json');
  const customer=json('qa/demo/tutorials/50-cliente-pedir-pizza-qr.json');
  const finish=json('qa/demo/tutorials/51-pizza-kds-comanda-caixa.json');

  const baseText=JSON.stringify(base);
  assert.match(baseText,/tutorial-pizza-dough/);
  assert.match(baseText,/tutorial-pizza-tomato-sauce/);
  assert.doesNotMatch(baseText,/tutorial-pizza-calabresa/);
  assert.ok(base.steps.some(step=>step.action==='capability'&&step.name==='tutorial.food.photo'&&step.productName==='Pizza Artesanal'));

  const flavorText=JSON.stringify(flavor);
  for(const ingredient of ['tutorial-pizza-mozzarella','tutorial-pizza-calabresa','tutorial-pizza-onion','tutorial-pizza-oregano'])
    assert.match(flavorText,new RegExp(ingredient));
  assert.match(flavorText,/Sabor Calabresa/);

  const configText=JSON.stringify(config);
  assert.match(configText,/recipeMultiplier/);
  assert.match(configText,/recipeProductId/);
  assert.match(configText,/Grande/);
  assert.match(configText,/Marguerita/);
  assert.match(configText,/Catupiry/);
  assert.match(configText,/Preço calculado/);

  const waiterText=JSON.stringify(waiter);
  assert.match(waiterText,/Grande/);
  assert.match(waiterText,/Calabresa/);
  assert.match(waiterText,/Marguerita/);
  assert.match(waiterText,/Catupiry/);
  assert.match(waiterText,/Enviar pedido/);

  const customerText=JSON.stringify(customer);
  assert.match(customerText,/product-dialog/);
  assert.match(customerText,/Enviar para a cozinha/);

  const finishText=JSON.stringify(finish);
  assert.match(finishText,/kitchen-board/);
  assert.match(finishText,/½ Calabresa/);
  assert.match(finishText,/½ Marguerita/);
  assert.match(finishText,/data-checkout/);
  assert.match(finishText,/confirm-payment/);
});


test('PWA recordings start only after navigation reaches the mobile surface',()=>{
  for(const id of ['40-cliente-fazer-pedido-qr','42-garcom-acompanhar-pedido','43-kds-preparar-pedido','44-kds-garcom-sincronizacao','49-garcom-pedir-pizza','50-cliente-pedir-pizza-qr']){
    const flow=json(`qa/demo/tutorials/${id}.json`);
    const gotoIndex=flow.steps.findIndex(step=>step.action==='goto');
    const readyIndex=flow.steps.findIndex(step=>step.name==='app-ready');
    assert.ok(gotoIndex>=0,id);
    assert.ok(readyIndex>gotoIndex,`${id}: app-ready must happen after mobile navigation so recording cannot die mid-navigation`);
  }
});

test('photo tutorials assert the current canonical product row instead of obsolete table markup',()=>{
  for(const id of ['37-criar-ficha-tecnica','46-criar-ficha-tecnica-pizza-calabresa']){
    const flow=json(`qa/demo/tutorials/${id}.json`);
    const photo=flow.steps.find(step=>step.name==='foto-anexada');
    assert.match(photo?.selector||'',/\.data-row/);
    assert.doesNotMatch(photo?.selector||'',/^tr:/);
  }
});
