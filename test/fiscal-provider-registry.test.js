'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateSecretConnection,
  publicConnection
} = require('../js/domains/fiscal/fiscal-core');
const {
  createFiscalProviderRegistry,
  createDefaultFiscalProviderRegistry
} = require('../js/domains/fiscal/provider-registry');

const TOKEN = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH';

test('acbr-local is a first-class provider and does not require a paid-provider token', () => {
  const local = validateSecretConnection({
    provider:'acbr-local',
    environment:'homologation',
    documentType:'nfce'
  });
  assert.deepEqual(local, {
    provider:'acbr-local',
    environment:'homologation',
    documentType:'nfce'
  });
  assert.deepEqual(publicConnection(local), {
    configured:true,
    provider:'acbr-local',
    environment:'homologation',
    documentType:'nfce'
  });
  assert.throws(() => validateSecretConnection({
    provider:'focus',
    environment:'homologation',
    documentType:'nfce'
  }), /token/i);
});

test('provider registry resolves factories by provider without changing the fiscal service contract', async () => {
  const calls = [];
  const registry = createFiscalProviderRegistry({
    factories:{
      'acbr-local':(connection, context) => {
        calls.push({ connection, context });
        return { issue:async () => ({ ok:true, status:200, data:{ chave:'LOCAL' } }) };
      }
    }
  });
  assert.equal(registry.has('acbr-local'), true);
  assert.deepEqual(registry.list(), ['acbr-local']);

  const provider = registry.create({
    provider:'acbr-local',
    environment:'homologation',
    documentType:'nfce'
  }, { sidecarBaseUrl:'http://127.0.0.1:9999', sidecarAuthToken:TOKEN });
  const result = await provider.issue({});
  assert.equal(result.ok, true);
  assert.equal(result.data.chave, 'LOCAL');
  assert.equal(calls[0].context.sidecarBaseUrl, 'http://127.0.0.1:9999');
  assert.equal(calls[0].context.sidecarAuthToken, TOKEN);
});

test('default registry keeps Focus optional while acbr-local resolves ephemeral sidecar auth', () => {
  const registry = createDefaultFiscalProviderRegistry({
    fetchImpl:async () => {
      throw new Error('network should not be called while constructing providers');
    },
    resolveSidecarBaseUrl:() => 'http://127.0.0.1:9999',
    resolveSidecarAuthToken:() => TOKEN
  });
  assert.deepEqual(registry.list(), ['acbr-local','focus']);

  const focus = registry.create({
    provider:'focus',
    environment:'homologation',
    documentType:'nfce',
    token:'focus-test-token'
  });
  assert.equal(typeof focus.issue, 'function');

  const local = registry.create({
    provider:'acbr-local',
    environment:'homologation',
    documentType:'nfce'
  });
  assert.equal(typeof local.issue, 'function');
});
