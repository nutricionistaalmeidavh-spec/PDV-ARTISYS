'use strict';

const fs = require('node:fs');
const path = require('node:path');

const MODES = new Set(['local', 'lan-host', 'lan-client', 'own-server']);

function text(value) { return String(value ?? '').trim(); }
function read(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  try { const value = JSON.parse(fs.readFileSync(filePath, 'utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}
function normalize(input = {}) {
  const mode = MODES.has(input.mode) ? input.mode : 'local';
  const port = Number(input.port || 4174);
  const result = {
    selected: input.selected === true,
    mode,
    host: text(input.host) || '0.0.0.0',
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 4174,
    serverUrl: text(input.serverUrl).replace(/\/+$/, ''),
    terminalId: text(input.terminalId) || 'PDV-01',
    terminalKey: text(input.terminalKey)
  };
  if (mode === 'lan-client' || mode === 'own-server') {
    if (!result.serverUrl) throw new Error('Informe o endereço do servidor.');
    let parsed;
    try { parsed = new URL(result.serverUrl); } catch { throw new Error('Endereço do servidor inválido.'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('O servidor deve usar HTTP ou HTTPS.');
    if (mode === 'own-server' && parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) throw new Error('Servidor próprio remoto deve usar HTTPS.');
    if (!result.terminalKey) throw new Error('Informe a chave de pareamento deste terminal.');
  }
  return result;
}
function loadDataServerConfig(filePath) { return normalize(read(filePath)); }
function saveDataServerConfig(filePath, input) {
  const config = normalize({ ...input, selected:true });
  fs.mkdirSync(path.dirname(filePath), { recursive:true });
  const temporary = `${filePath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, { encoding:'utf8', mode:0o600 });
  fs.renameSync(temporary, filePath);
  return config;
}
function isHostMode(config) { return config.mode === 'lan-host'; }
function isExternalMode(config) { return config.mode === 'lan-client' || config.mode === 'own-server'; }
function publicDataServerConfig(config) { return { ...config, terminalKey: config.terminalKey ? '••••••••' : '' }; }

module.exports = { MODES, normalize, loadDataServerConfig, saveDataServerConfig, isHostMode, isExternalMode, publicDataServerConfig };
