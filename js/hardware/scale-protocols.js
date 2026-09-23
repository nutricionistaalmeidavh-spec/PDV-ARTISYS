'use strict';

const STX = 0x02;
const ETX = 0x03;
const ENQ = 0x05;

function asBuffer(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  return Buffer.from(String(value ?? ''), 'utf8');
}

function protocolError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stripFrame(value) {
  const buffer = asBuffer(value);
  if (buffer.length >= 2 && buffer[0] === STX && buffer[buffer.length - 1] === ETX) return buffer.subarray(1, -1);
  return buffer;
}

function requireFiveDigitFrame(value) {
  const buffer = asBuffer(value);
  if (buffer.length !== 7 || buffer[0] !== STX || buffer[buffer.length - 1] !== ETX) {
    throw protocolError('Frame de resposta da balanca invalido.', 'SCALE_PROTOCOL_INVALID_FRAME');
  }
  return buffer.subarray(1, 6);
}

function parseFiveDigitGrams(value) {
  const payload = requireFiveDigitFrame(value).toString('ascii');
  if (/^I{5}$/.test(payload)) throw protocolError('Peso instavel.', 'SCALE_WEIGHT_UNSTABLE');
  if (/^N{5}$/.test(payload)) throw protocolError('Peso negativo.', 'SCALE_WEIGHT_NEGATIVE');
  if (/^S{5}$/.test(payload)) throw protocolError('Balanca em sobrecarga.', 'SCALE_OVERLOAD');
  if (!/^\d{5}$/.test(payload)) throw protocolError('Resposta de peso invalida.', 'SCALE_PROTOCOL_INVALID_RESPONSE');
  return { weight:Number(payload) / 1000, unit:'kg', stable:true };
}

function parseGenericNumeric(value) {
  const text = stripFrame(value).toString('utf8').trim();
  const match = text.match(/([+-]?\d+(?:[.,]\d+)?)\s*(kg|g)?/i);
  if (!match) throw protocolError('Resposta de peso invalida.', 'SCALE_PROTOCOL_INVALID_RESPONSE');
  let weight = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(weight) || weight < 0) throw protocolError('Peso invalido.', 'SCALE_PROTOCOL_INVALID_WEIGHT');
  if (String(match[2] || '').toLowerCase() === 'g') weight /= 1000;
  return { weight, unit:'kg', stable:true };
}

const PROTOCOLS = Object.freeze({
  'toledo-prt5': Object.freeze({
    id:'toledo-prt5',
    request:() => Buffer.from([ENQ]),
    parse:parseFiveDigitGrams
  }),
  'urano-pop-prot3': Object.freeze({
    id:'urano-pop-prot3',
    request:() => Buffer.alloc(0),
    parse:parseFiveDigitGrams
  }),
  'urano-udc-std04': Object.freeze({
    id:'urano-udc-std04',
    request:() => Buffer.alloc(0),
    parse:parseFiveDigitGrams
  }),
  'filizola-legacy-numeric': Object.freeze({
    id:'filizola-legacy-numeric',
    request:() => Buffer.alloc(0),
    parse:parseGenericNumeric
  }),
  'generic-numeric': Object.freeze({
    id:'generic-numeric',
    request:() => Buffer.alloc(0),
    parse:parseGenericNumeric
  })
});

const PRESETS = Object.freeze([
  Object.freeze({
    id:'toledo-prix3-prt5',
    manufacturer:'Toledo do Brasil',
    models:['Prix 3 Fit','Prix 3 Plus'],
    protocolId:'toledo-prt5',
    defaultBaudRate:9600,
    documentationStatus:'manufacturer-protocol-documented'
  }),
  Object.freeze({
    id:'urano-pop',
    manufacturer:'Urano',
    models:['POP-S','POP-Z'],
    protocolId:'urano-pop-prot3',
    defaultBaudRate:9600,
    documentationStatus:'manufacturer-protocol-documented'
  }),
  Object.freeze({
    id:'urano-udc',
    manufacturer:'Urano',
    models:['UDC CO','UDC CO-E'],
    protocolId:'urano-udc-std04',
    defaultBaudRate:9600,
    documentationStatus:'manufacturer-protocol-documented'
  }),
  Object.freeze({
    id:'filizola-bp-cs',
    manufacturer:'Filizola',
    models:['BP-S','CS'],
    protocolId:'filizola-legacy-numeric',
    defaultBaudRate:9600,
    documentationStatus:'legacy-needs-protocol-confirmation'
  }),
  Object.freeze({
    id:'generic-numeric',
    manufacturer:'Generica',
    models:['Serial numerica'],
    protocolId:'generic-numeric',
    defaultBaudRate:9600,
    documentationStatus:'generic'
  })
]);

function clonePreset(preset) {
  return { ...preset, models:[...preset.models] };
}

function createScaleProtocolRegistry() {
  const presetById = new Map(PRESETS.map((preset) => [preset.id, preset]));
  return Object.freeze({
    listPresets() { return PRESETS.map(clonePreset); },
    getPreset(id) {
      const preset = presetById.get(String(id || ''));
      if (!preset) throw protocolError(`Preset de balanca desconhecido: ${id || '(vazio)'}.`, 'SCALE_PRESET_UNKNOWN');
      return clonePreset(preset);
    },
    getProtocolForPreset(id) {
      const preset = presetById.get(String(id || ''));
      if (!preset) throw protocolError(`Preset de balanca desconhecido: ${id || '(vazio)'}.`, 'SCALE_PRESET_UNKNOWN');
      return PROTOCOLS[preset.protocolId];
    }
  });
}

module.exports = {
  createScaleProtocolRegistry,
  parseFiveDigitGrams,
  parseGenericNumeric
};
