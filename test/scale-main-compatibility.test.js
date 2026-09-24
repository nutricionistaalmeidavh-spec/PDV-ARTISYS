'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeScaleConfig } = require('../desktop/hardware-config-store.cjs');
const { createScaleProtocol } = require('../js/hardware/scale-protocols.js');

test('current Urano POP-S stays dedicated 9600 8N2', () => {
  const urano = normalizeScaleConfig({ profile:'urano-pop-s', port:'COM7' });
  assert.equal(urano.profile, 'urano-pop-s');
  assert.equal(urano.requestCommand, '0x04');
});

test('Toledo preset coexists without changing POP-S semantics', () => {
  const toledo = createScaleProtocol({ preset:'toledo-prix3-prt5' });
  assert.deepEqual(toledo.serial, { baudRate:9600, dataBits:8, stopBits:1, parity:'none' });
  assert.equal(toledo.parse(Buffer.from([0x02,0x30,0x30,0x37,0x34,0x32,0x03])).weight, 0.742);
  assert.deepEqual(Buffer.from(toledo.request()), Buffer.from([0x05]));
});

test('additional PR40 presets preserve their documented parser families', () => {
  const udc = createScaleProtocol({ preset:'urano-udc' });
  const filizola = createScaleProtocol({ preset:'filizola-bp-cs' });
  assert.equal(udc.parse(Buffer.from([0x02,0x30,0x31,0x32,0x33,0x34,0x03])).weight, 1.234);
  assert.equal(filizola.parse(Buffer.from('1.234 kg\r\n')).weight, 1.234);
});

test('hardware config store accepts additional presets without masquerading as POP-S', () => {
  const cfg = normalizeScaleConfig({ profile:'toledo-prix3-prt5', port:'COM8' });
  assert.equal(cfg.profile, 'toledo-prix3-prt5');
  assert.equal(cfg.port, 'COM8');
  assert.equal('requestCommand' in cfg, false);
});
