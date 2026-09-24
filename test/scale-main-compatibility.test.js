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
  assert.equal(toledo.feed(Buffer.from('\x021.234\x03')), 1.234);
});

test('additional PR40 text presets normalize valid weights and reject zero', () => {
  const udc = createScaleProtocol({ preset:'urano-udc' });
  const filizola = createScaleProtocol({ preset:'filizola-bp-cs' });
  assert.equal(udc.feed(Buffer.from('2.345\r\n')), 2.345);
  assert.equal(filizola.feed(Buffer.from('01234')), 1.234);
  assert.equal(filizola.feed(Buffer.from('00000')), null);
});

test('hardware config store accepts the additional presets without masquerading as POP-S', () => {
  const cfg = normalizeScaleConfig({ profile:'toledo-prix3-prt5', port:'COM8' });
  assert.equal(cfg.profile, 'toledo-prix3-prt5');
  assert.equal(cfg.port, 'COM8');
  assert.equal('requestCommand' in cfg, false);
});
