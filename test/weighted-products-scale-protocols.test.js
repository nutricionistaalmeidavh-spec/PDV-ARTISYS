'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createScaleProtocolRegistry } = require('../js/hardware/scale-protocols');
const ui = require('../desktop/renderer/ui-model');
const weightedUnitUi = require('../desktop/renderer/weighted-product-unit-ui');

test('weighted product helper identifies KG and G but not UN', () => {
  assert.equal(ui.isWeightedProduct({ unit:'KG' }), true);
  assert.equal(ui.isWeightedProduct({ unit:'kg' }), true);
  assert.equal(ui.isWeightedProduct({ unit:'G' }), true);
  assert.equal(ui.isWeightedProduct({ unit:'UN' }), false);
  assert.equal(ui.isWeightedProduct({}), false);
});

test('product form exposes G through the visible weighted-unit UI extension', () => {
  const options = [{ value:'UN' }, { value:'KG' }, { value:'LT' }, { value:'CX' }];
  const select = {
    value:'UN',
    querySelector(selector) { const match=selector.match(/option\[value="([A-Z]+)"\]/); return match ? options.find(option=>option.value===match[1])||null : null; },
    appendChild(option) { options.push(option); return option; }
  };
  assert.equal(weightedUnitUi.ensureGramOption(select), true);
  assert.deepEqual(options.map(option => option.value), ['UN','KG','LT','CX','G']);
  assert.equal(weightedUnitUi.ensureGramOption(select, 'G'), true);
  assert.equal(select.value, 'G');
  const index=fs.readFileSync(path.join(__dirname,'../desktop/renderer/index.html'),'utf8');
  assert.match(index, /weighted-product-unit-ui\.js/);
  assert.match(index, /scale-ui\.js/);
});

test('checkout API refuses to add a known KG/G product as one ordinary unit', async () => {
  const calls=[];
  const root={sessionStorage:{getItem(){return'';},setItem(){},removeItem(){}},crypto:{randomUUID(){return'mutation-1';}},artisysDesktop:{async apiRequest(input){calls.push(input);if(input.path==='/api/v1/products')return{ok:true,status:200,payload:[{id:'tomate',unit:'KG'},{id:'farinha',unit:'G'},{id:'sacola',unit:'UN'}]};if(input.path.endsWith('/items'))return{ok:true,status:200,payload:{}};return{ok:true,status:200,payload:{}};}}};
  const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/api-client.js'),'utf8');
  vm.runInNewContext(source,{window:root,URLSearchParams,Date,Math,Error,encodeURIComponent});
  const api=new root.PdvApiClient.ApiClient();
  await api.products();
  assert.throws(()=>api.addSaleItem('sale-1','tomate',1),/peso|pesagem|kg/i);
  assert.throws(()=>api.addSaleItem('sale-1','farinha',1),/peso|pesagem|kg/i);
  await api.addSaleItem('sale-1','sacola',1);
  assert.equal(calls.filter(call=>call.path.endsWith('/items')).length,1);
});

test('registry exposes PR40 text presets while POP-S remains outside generic registry', () => {
  const registry=createScaleProtocolRegistry();
  const ids=registry.listPresets().map(preset=>preset.id);
  assert.ok(ids.includes('toledo-prix3-prt5'));
  assert.ok(ids.includes('urano-udc'));
  assert.ok(ids.includes('filizola-bp-cs'));
  assert.ok(ids.includes('generic-numeric'));
  assert.equal(ids.includes('urano-pop-s'), false);
  assert.throws(()=>registry.getProtocolForPreset('urano-pop-s'),/desconhecido/i);
});
