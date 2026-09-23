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
    querySelector(selector) {
      const match = selector.match(/option\[value="([A-Z]+)"\]/);
      return match ? options.find(option => option.value === match[1]) || null : null;
    },
    appendChild(option) { options.push(option); return option; }
  };

  assert.equal(weightedUnitUi.ensureGramOption(select), true);
  assert.deepEqual(options.map(option => option.value), ['UN','KG','LT','CX','G']);
  assert.equal(weightedUnitUi.ensureGramOption(select, 'G'), true);
  assert.equal(select.value, 'G');

  const index = fs.readFileSync(path.join(__dirname,'../desktop/renderer/index.html'),'utf8');
  assert.match(index, /<script src="\.\/weighted-product-unit-ui\.js"><\/script>/);
});

test('checkout API refuses to add a known KG/G product as one ordinary unit', async () => {
  const calls = [];
  const root = {
    sessionStorage:{ getItem(){ return ''; }, setItem(){}, removeItem(){} },
    crypto:{ randomUUID(){ return 'mutation-1'; } },
    artisysDesktop:{
      async apiRequest(input) {
        calls.push(input);
        if (input.path === '/api/v1/products') return { ok:true, status:200, payload:[{id:'tomate',unit:'KG'},{id:'farinha',unit:'G'},{id:'sacola',unit:'UN'}] };
        if (input.path.endsWith('/items')) return { ok:true, status:200, payload:{} };
        return { ok:true, status:200, payload:{} };
      }
    }
  };
  const source = fs.readFileSync(path.join(__dirname,'../desktop/renderer/api-client.js'),'utf8');
  vm.runInNewContext(source, { window:root, URLSearchParams, Date, Math, Error, encodeURIComponent });
  const api = new root.PdvApiClient.ApiClient();

  await api.products();
  assert.throws(() => api.addSaleItem('sale-1','tomate',1), /peso|pesagem|kg/i);
  assert.throws(() => api.addSaleItem('sale-1','farinha',1), /peso|pesagem|kg/i);
  await api.addSaleItem('sale-1','sacola',1);
  assert.equal(calls.filter((call) => call.path.endsWith('/items')).length, 1);
});

test('scale registry exposes supported presets and a generic protocol', () => {
  const registry = createScaleProtocolRegistry();
  const presets = registry.listPresets();
  const ids = presets.map((preset) => preset.id);

  assert.ok(ids.includes('toledo-prix3-prt5'));
  assert.ok(ids.includes('urano-pop'));
  assert.ok(ids.includes('urano-udc'));
  assert.ok(ids.includes('filizola-bp-cs'));
  assert.ok(ids.includes('generic-numeric'));
});

test('Toledo Prix 3 Prt5 sends ENQ and parses only the documented framed response', () => {
  const protocol = createScaleProtocolRegistry().getProtocolForPreset('toledo-prix3-prt5');
  assert.deepEqual(Buffer.from(protocol.request()), Buffer.from([0x05]));
  assert.deepEqual(protocol.parse(Buffer.from([0x02,0x30,0x30,0x37,0x34,0x32,0x03])), { weight:0.742, unit:'kg', stable:true });
  assert.throws(() => protocol.parse(Buffer.from([0x02,0x49,0x49,0x49,0x49,0x49,0x03])), /instavel/i);
  assert.throws(() => protocol.parse(Buffer.from('00742')), /frame|resposta|protocolo/i);
});

test('Urano POP PROT-3 and UDC Std04 presets parse documented framed stable weight responses', () => {
  const registry = createScaleProtocolRegistry();
  const pop = registry.getProtocolForPreset('urano-pop');
  const udc = registry.getProtocolForPreset('urano-udc');
  const frame = Buffer.from([0x02,0x30,0x30,0x37,0x34,0x32,0x03]);

  assert.deepEqual(pop.parse(frame), { weight:0.742, unit:'kg', stable:true });
  assert.deepEqual(udc.parse(frame), { weight:0.742, unit:'kg', stable:true });
  assert.throws(() => pop.parse(Buffer.from('00742')), /frame|resposta|protocolo/i);
  assert.throws(() => udc.parse(Buffer.from([0x02,0x53,0x53,0x53,0x53,0x53,0x03])), /sobrecarga/i);
});

test('Filizola legacy and generic presets parse numeric weight while rejecting garbage', () => {
  const registry = createScaleProtocolRegistry();
  const filizola = registry.getProtocolForPreset('filizola-bp-cs');
  const generic = registry.getProtocolForPreset('generic-numeric');

  assert.deepEqual(filizola.parse(Buffer.from('0.742\r\n')), { weight:0.742, unit:'kg', stable:true });
  assert.deepEqual(generic.parse(Buffer.from('742 g\r\n')), { weight:0.742, unit:'kg', stable:true });
  assert.throws(() => filizola.parse(Buffer.from('SEM PESO')), /peso|weight|resposta/i);
});
