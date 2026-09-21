'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFiscalSidecar } = require('../server/fiscal-sidecar');
const { createControlledFiscalAdapter } = require('../server/fiscal-sidecar/controlled-adapter');
const {
  createAcbrLocalProvider,
  normalizeLoopbackBaseUrl
} = require('../js/domains/fiscal/acbr-local-provider');

const TOKEN = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH';

async function withSidecar(mode, fn) {
  const sidecar = createFiscalSidecar({
    adapter:createControlledFiscalAdapter({ mode, production:false }),
    authToken:TOKEN,
    host:'127.0.0.1',
    port:0
  });
  const address = await sidecar.start();
  try {
    return await fn(`http://127.0.0.1:${address.port}`, address);
  } finally {
    await sidecar.stop();
  }
}

test('contract: acbr-local provider reaches only loopback sidecar and completes issue/query/cancel lifecycle', async () => {
  await withSidecar('mock-success', async (baseUrl, address) => {
    assert.equal(address.address, '127.0.0.1');
    const provider = createAcbrLocalProvider({
      connection:{
        provider:'acbr-local',
        environment:'homologation',
        documentType:'nfce'
      },
      baseUrl,
      authToken:TOKEN
    });

    const connection = await provider.testConnection();
    assert.equal(connection.configured, true);
    assert.equal(connection.reachable, true);
    assert.equal(connection.sidecar.loopbackOnly, true);
    assert.equal(connection.sidecar.authenticated, true);

    const issued = await provider.issue({
      documentType:'nfce',
      reference:'VENDA001',
      payload:{ natureza_operacao:'Venda' }
    });
    assert.equal(issued.ok, true);
    assert.equal(issued.data.status, 'autorizado');
    assert.equal(issued.data.referencia, 'VENDA001');
    assert.equal(issued.data.mock, true);

    const queried = await provider.query('VENDA001', 'nfce');
    assert.equal(queried.ok, true);
    assert.equal(queried.data.chave, issued.data.chave);

    const cancelled = await provider.cancel('VENDA001', 'Cancelamento solicitado para teste', 'nfce');
    assert.equal(cancelled.ok, true);
    assert.equal(cancelled.data.status, 'cancelado');
  });
});

test('contract: unconfigured sidecar is healthy but refuses fake fiscal authorization', async () => {
  await withSidecar('unconfigured', async baseUrl => {
    const provider = createAcbrLocalProvider({
      connection:{
        provider:'acbr-local',
        environment:'homologation',
        documentType:'nfce'
      },
      baseUrl,
      authToken:TOKEN
    });

    const connection = await provider.testConnection();
    assert.equal(connection.reachable, true);

    const result = await provider.issue({
      documentType:'nfce',
      reference:'VENDA002',
      payload:{}
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.match(result.error, /ACBr/i);
  });
});

test('security contract: acbr-local rejects non-loopback endpoints', () => {
  assert.equal(normalizeLoopbackBaseUrl('http://127.0.0.1:4175'), 'http://127.0.0.1:4175');
  assert.equal(normalizeLoopbackBaseUrl('http://localhost:4175'), 'http://localhost:4175');
  assert.throws(() => normalizeLoopbackBaseUrl('http://0.0.0.0:4175'), /loopback/i);
  assert.throws(() => normalizeLoopbackBaseUrl('http://192.168.0.10:4175'), /loopback/i);
  assert.throws(() => normalizeLoopbackBaseUrl('https://127.0.0.1:4175'), /HTTP local/i);
});
