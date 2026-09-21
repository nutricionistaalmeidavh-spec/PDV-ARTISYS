'use strict';

const { validateConnection } = require('./fiscal-core');
const { createFocusFiscalProvider } = require('./focus-fiscal-provider');
const { createAcbrLocalProvider } = require('./acbr-local-provider');

function providerName(value) {
  return String(value || '').trim().toLowerCase();
}

function createFiscalProviderRegistry({ factories = {} } = {}) {
  const registry = new Map();

  function register(name, factory) {
    const normalized = providerName(name);
    if (!normalized) throw new TypeError('Nome do provedor fiscal obrigatorio.');
    if (typeof factory !== 'function') throw new TypeError(`Factory fiscal invalida para ${normalized}.`);
    registry.set(normalized, factory);
    return api;
  }

  function has(name) {
    return registry.has(providerName(name));
  }

  function create(connection = {}, context = {}) {
    const validated = validateConnection(connection);
    const factory = registry.get(validated.provider);
    if (!factory) throw new Error(`Provedor fiscal nao registrado: ${validated.provider}.`);
    return factory(connection, context);
  }

  const api = Object.freeze({
    register,
    has,
    create,
    list: () => Array.from(registry.keys()).sort()
  });

  for (const [name, factory] of Object.entries(factories)) register(name, factory);
  return api;
}

function createDefaultFiscalProviderRegistry({
  fetchImpl = globalThis.fetch,
  resolveSidecarBaseUrl = () => null,
  resolveSidecarAuthToken = () => null
} = {}) {
  if (typeof resolveSidecarBaseUrl !== 'function') throw new TypeError('resolveSidecarBaseUrl must be a function.');
  if (typeof resolveSidecarAuthToken !== 'function') throw new TypeError('resolveSidecarAuthToken must be a function.');
  return createFiscalProviderRegistry({
    factories: {
      focus: connection => createFocusFiscalProvider({ connection, fetchImpl }),
      'acbr-local': (connection, context = {}) => createAcbrLocalProvider({
        connection,
        fetchImpl,
        baseUrl:context.sidecarBaseUrl || resolveSidecarBaseUrl(),
        authToken:context.sidecarAuthToken || resolveSidecarAuthToken()
      })
    }
  });
}

module.exports = {
  createFiscalProviderRegistry,
  createDefaultFiscalProviderRegistry
};
