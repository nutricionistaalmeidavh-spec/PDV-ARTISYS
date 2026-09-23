'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createScaleProtocolRegistry } = require('../js/hardware/scale-protocols');
const ui = require('../desktop/renderer/ui-model');

test('weighted product helper identifies KG and G but not UN', () => {
  assert.equal(ui.isWeightedProduct({ unit:'KG' }), true);
  assert.equal(ui.isWeightedProduct({ unit:'kg' }), true);
  assert.equal(ui.isWeightedProduct({ unit:'G' }), true);
  assert.equal(ui.isWeightedProduct({ unit:'UN' }), false);
  assert.equal(ui.isWeightedProduct({}), false);
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

test('Toledo Prix 3 Prt5 preset sends ENQ and parses a five-digit gram frame as kilograms', () => {
  const protocol = createScaleProtocolRegistry().getProtocolForPreset('toledo-prix3-prt5');
  assert.deepEqual(Buffer.from(protocol.request()), Buffer.from([0x05]));
  assert.deepEqual(protocol.parse(Buffer.from('00742')), { weight:0.742, unit:'kg', stable:true });
});

test('Urano POP and UDC presets parse framed stable weight responses', () => {
  const registry = createScaleProtocolRegistry();
  const pop = registry.getProtocolForPreset('urano-pop');
  const udc = registry.getProtocolForPreset('urano-udc');

  assert.deepEqual(pop.parse(Buffer.from([0x02,0x30,0x30,0x37,0x34,0x32,0x0d])), { weight:0.742, unit:'kg', stable:true });
  assert.deepEqual(udc.parse(Buffer.from([0x02,0x30,0x30,0x37,0x34,0x32,0x03])), { weight:0.742, unit:'kg', stable:true });
});

test('Filizola preset parses numeric weight while rejecting garbage', () => {
  const protocol = createScaleProtocolRegistry().getProtocolForPreset('filizola-bp-cs');
  assert.deepEqual(protocol.parse(Buffer.from('0.742\r\n')), { weight:0.742, unit:'kg', stable:true });
  assert.throws(() => protocol.parse(Buffer.from('SEM PESO')), /peso|weight|resposta/i);
});
