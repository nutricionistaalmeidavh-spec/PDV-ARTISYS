'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { validateSecretConnection, publicConnection } = require('../js/domains/fiscal/fiscal-core');
const { createDefaultFiscalProviderRegistry } = require('../js/domains/fiscal/provider-registry');

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

function createFiscalProviderResolver({
  store,
  fetchImpl = globalThis.fetch,
  registry = null,
  sidecarBaseUrlResolver = () => null
} = {}) {
  if (!store) throw new TypeError('Fiscal connection store is required.');
  if (typeof sidecarBaseUrlResolver !== 'function') throw new TypeError('sidecarBaseUrlResolver must be a function.');

  const providerRegistry = registry || createDefaultFiscalProviderRegistry({
    fetchImpl,
    resolveSidecarBaseUrl:sidecarBaseUrlResolver
  });

  return async document => {
    const secret = store.readSecret();
    if (!secret) throw new Error('Conexao fiscal nao configurada.');
    if (document?.provider && document.provider !== secret.provider) throw new Error('Provedor fiscal do documento difere da configuracao ativa.');
    if (document?.environment && document.environment !== secret.environment) throw new Error('Ambiente fiscal do documento difere da configuracao ativa.');

    const connection = {
      ...secret,
      documentType:document?.documentType || secret.documentType
    };
    return providerRegistry.create(connection, { sidecarBaseUrl:sidecarBaseUrlResolver() });
  };
}

function registerFiscalIpc({
  ipcMain,
  store,
  isTrustedSender = null,
  fetchImpl = globalThis.fetch,
  providerResolver = null,
  sidecarBaseUrlResolver = () => null
} = {}) {
  if (!ipcMain || !store) throw new TypeError('ipcMain and fiscal store are required.');
  const trusted = event => typeof isTrustedSender !== 'function' || Boolean(isTrustedSender(event));
  const resolveProvider = providerResolver || createFiscalProviderResolver({
    store,
    fetchImpl,
    sidecarBaseUrlResolver
  });

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
    try {
      const provider = await resolveProvider({
        provider:secret.provider,
        environment:secret.environment,
        documentType:secret.documentType
      });
      const result = await provider.testConnection();
      return { ...publicConnection(secret), ...result };
    } catch (error) {
      return {
        ...publicConnection(secret),
        reachable:false,
        status:0,
        error:error?.message || String(error)
      };
    }
  });

  return Object.freeze({ providerResolver:resolveProvider });
}

module.exports = {
  createFiscalConnectionStore,
  createFiscalProviderResolver,
  registerFiscalIpc
};
