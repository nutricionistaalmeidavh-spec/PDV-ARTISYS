'use strict';

const fs = require('node:fs');
const path = require('node:path');

function normalizeRequestCommand(value) {
  if (value == null || String(value).trim() === '') return '0x04';
  const text = String(value).trim().toLowerCase();
  if (['4','04','0x04'].includes(text)) return '0x04';
  if (['5','05','0x05'].includes(text)) return '0x05';
  throw new Error('Comando Urano invalido. Use 0x04 ou 0x05.');
}

function normalizeScaleConfig(input = {}) {
  const profile = String(input.profile || 'generic').trim().toLowerCase();
  if (!['generic','urano-pop-s'].includes(profile)) throw new Error('Perfil de balanca invalido.');
  const port = String(input.port || '').trim();
  if (port.length > 128) throw new Error('Porta serial invalida.');
  const result = { profile, port };
  if (profile === 'urano-pop-s') result.requestCommand = normalizeRequestCommand(input.requestCommand);
  return Object.freeze(result);
}

function createHardwareConfigStore({ filePath } = {}) {
  if (!filePath) throw new TypeError('filePath obrigatorio.');

  function load() {
    try {
      if (!fs.existsSync(filePath)) return { scale:null };
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return { scale:parsed?.scale ? normalizeScaleConfig(parsed.scale) : null };
    } catch {
      return { scale:null };
    }
  }

  function saveScale(input = {}) {
    const scale = normalizeScaleConfig(input);
    fs.mkdirSync(path.dirname(filePath), { recursive:true });
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify({ scale }, null, 2), { encoding:'utf8', mode:0o600 });
    fs.renameSync(tempPath, filePath);
    return scale;
  }

  return Object.freeze({ load, saveScale });
}

module.exports = { createHardwareConfigStore, normalizeScaleConfig, normalizeRequestCommand };