'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {registerQuickStockProduct}=require('../js/domains/catalog/quick-stock-service');
const {normalizeQuickStockInput}=require('../desktop/renderer/quick-stock-model');

const admin={kind:'human',userId:'admin',profileId:'profile-administrator'};
const input=(overrides={})=>({name:'Refrigerante lata',salePrice:'6,50',openingQuantity:'12',publish:true,kind:'READY',...overrides});

test('cadastro rapido atomico cria produto, movimentacao e publicacao com estoque disponivel',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    const result=registerQuickStockProduct(runtime,input(),admin);
    assert.equal(result.product.name,'Refrigerante lata');
    assert.equal(result.product.salePriceCents,650);
    assert.equal(result.stockQuantity,12);
    assert.equal(result.availableForSale,true);
    assert.equal(runtime.inventory.listMovements({productId:result.product.id}).length,1);
    assert.equal(runtime.catalog.getProduct(result.product.id).menuEnabled,true);
  }finally{runtime.close();}
});

test('saldo zero fica no estoque sem publicidade enganosa e nao pode ser publicado',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    const draft=registerQuickStockProduct(runtime,input({name:'Cigarro',openingQuantity:'0',publish:false}),admin);
    assert.equal(draft.stockQuantity,0);
    assert.equal(draft.product.menuEnabled,false);
    assert.equal(draft.availableForSale,false);
    assert.equal(runtime.inventory.listMovements({productId:draft.product.id}).length,0);
    assert.throws(()=>registerQuickStockProduct(runtime,input({name:'Impossivel',openingQuantity:'0'}),admin),/quantidade|saldo/i);
    assert.equal(runtime.catalog.listProducts().length,1);
    assert.throws(()=>normalizeQuickStockInput(input({openingQuantity:'0'})),/quantidade|saldo/i);
  }finally{runtime.close();}
});

test('item preparado nao passa por rota direta nem cria produto silenciosamente',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    assert.throws(()=>registerQuickStockProduct(runtime,input({kind:'PREPARED'}),admin),/preparado|ficha/i);
    assert.equal(runtime.catalog.listProducts().length,0);
  }finally{runtime.close();}
});

test('erro posterior ao cadastro desfaz todas as etapas e nao altera estoque',()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  const original=runtime.inventory.move;
  try{
    runtime.inventory.move=()=>{throw new Error('Falha no movimento');};
    assert.throws(()=>registerQuickStockProduct(runtime,input(),admin),/Falha no movimento/);
    assert.equal(runtime.catalog.listProducts().length,0);
    assert.equal(runtime.inventory.listMovements({}).length,0);
  }finally{runtime.inventory.move=original;runtime.close();}
});

test('formulario de lote e guia de primeiro uso apontam para a mesma operacao sem publicar saldo zero',()=>{
  const app=fs.readFileSync(require('node:path').join(__dirname,'../desktop/renderer/app.js'),'utf8');
  const guide=fs.readFileSync(require('node:path').join(__dirname,'../desktop/renderer/first-use-guide-ui.js'),'utf8');
  assert.match(app,/registerQuickProduct/);
  assert.match(app,/quick-stock-kind/);
  assert.match(app,/openRecipeForm/);
  assert.match(app,/data-quick-stock-feedback/);
  assert.match(app,/saveQuickProduct/);
  assert.match(guide,/openQuickStockProductForm/);
});
