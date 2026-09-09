'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { validateSecretConnection, publicConnection } = require('../js/domains/fiscal/fiscal-core');
const { createFocusFiscalProvider } = require('../js/domains/fiscal/focus-fiscal-provider');

function createFiscalConnectionStore({ app, safeStorage, fileName = 'pdv-fiscal-connection.enc' } = {}) {
  if (!app || typeof app.getPath !== 'function' || !safeStorage) throw new TypeError('app and safeStorage are required.');
  const filePath = path.join(app.getPath('userData'), fileName);

  function encryptionReady() {
    return typeof safeStorage.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable();
  }

  function saveSecret(input = {}) {
    if (!encryptionReady()) throw new Error('Criptografia segura do sistema operacional indisponivel.');
    const secret = validateSecretConnection(input);
    const encrypted = safeStorage.encryptString(JSON.stringify(secret));
    fs.mkdirSync(path.dirname(filePath), { recursive:true });
    fs.writeFileSync(filePath, Buffer.from(encrypted).toString('base64'), { encoding:'utf8', mode:0o600 });
    return publicConnection(secret);
  }

  function readSecret() {
    if (!fs.existsSync(filePath)) return null;
    if (!encryptionReady()) throw new Error('Criptografia segura do sistema operacional indisponivel.');
    const encoded = fs.readFileSync(filePath, 'utf8');
    const decrypted = safeStorage.decryptString(Buffer.from(encoded, 'base64'));
    return validateSecretConnection(JSON.parse(decrypted));
  }

  function publicStatus() {
    const secret = readSecret();
    return secret ? publicConnection(secret) : { configured:false };
  }

  function removeSecret() {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force:true });
    return { configured:false };
  }

  return Object.freeze({ filePath, saveSecret, readSecret, publicStatus, removeSecret });
}

function createFiscalProviderResolver({ store, fetchImpl = globalThis.fetch } = {}) {
  if (!store) throw new TypeError('Fiscal connection store is required.');
  return async document => {
    const secret = store.readSecret();
    if (!secret) throw new Error('Conexao fiscal nao configurada.');
    if (document?.provider && document.provider !== secret.provider) throw new Error('Provedor fiscal do documento difere da configuracao ativa.');
    if (document?.environment && document.environment !== secret.environment) throw new Error('Ambiente fiscal do documento difere da configuracao ativa.');
    return createFocusFiscalProvider({ connection:{...secret,documentType:document?.documentType || secret.documentType}, fetchImpl });
  };
}

function registerFiscalIpc({ ipcMain, store, isTrustedSender = null, fetchImpl = globalThis.fetch } = {}) {
  if (!ipcMain || !store) throw new TypeError('ipcMain and fiscal store are required.');
  const trusted = event => typeof isTrustedSender !== 'function' || Boolean(isTrustedSender(event));
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, input) => {
    if (!trusted(event)) throw new Error('Origem IPC nao autorizada.');
    return fn(input || {});
  });
  handle('artisys:fiscal:status', () => store.publicStatus());
  handle('artisys:fiscal:save', input => store.saveSecret(input));
  handle('artisys:fiscal:remove', () => store.removeSecret());
  handle('artisys:fiscal:test', async () => {
    const secret = store.readSecret();
    if (!secret) return { configured:false, reachable:false, error:'Conexao fiscal nao configurada.' };
    const provider = createFocusFiscalProvider({ connection:secret, fetchImpl });
    return provider.testConnection();
  });
}

module.exports = { createFiscalConnectionStore, createFiscalProviderResolver, registerFiscalIpc };
