'use strict';

const { SerialError, normalizeSerialError } = require('./errors');
const { normalizeDeviceProfile } = require('./device-profile');
const { createSerialTransport } = require('./serial-transport');
const { createSerialPortManager } = require('./serial-port-manager');
const { createRequestResponseSession } = require('./request-response-session');
const { parseNumericWeight } = require('./parsers/numeric-weight');
const { createLineBuffer } = require('./parsers/line-buffer');
const { createScaleAdapter } = require('./adapters/scale');
const { createDrawerAdapter, DEFAULT_PULSE } = require('./adapters/drawer');
const { createGenericSerialDevice } = require('./adapters/generic-device');

module.exports = {
  SerialError,
  normalizeSerialError,
  normalizeDeviceProfile,
  createSerialTransport,
  createSerialPortManager,
  createRequestResponseSession,
  parseNumericWeight,
  createLineBuffer,
  createScaleAdapter,
  createDrawerAdapter,
  createGenericSerialDevice,
  DEFAULT_PULSE
};
