'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createFiscalSidecarRuntime,
  getActiveFiscalSidecarAuthToken
} = require('../desktop/fiscal-sidecar-runtime.cjs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await sleep(intervalMs);
  }
  throw new Error('Timeout aguardando fiscal sidecar.');
}

test('E2E sidecar lifecycle: starts authenticated, answers health, restarts and stops cleanly', async () => {
  const runtime = createFiscalSidecarRuntime({
    env:{
      ...process.env,
      ARTISYS_FISCAL_SIDECAR_MODE:'mock-success'
    },
    production:false,
    port:0,
    restartDelayMs:25,
    maxRestarts:2,
    readyTimeoutMs:5000,
    onError:() => {}
  });

  const started = await runtime.start();
  assert.match(started.baseUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  const firstPid = runtime.status().pid;
  const token = runtime.getAuthToken();
  assert.ok(firstPid);
  assert.ok(token);
  assert.equal(getActiveFiscalSidecarAuthToken(), token);
  assert.equal(JSON.stringify(runtime.status()).includes(token), false);

  let response = await fetch(`${runtime.getBaseUrl()}/v1/health`);
  assert.equal(response.status, 401);

  response = await fetch(`${runtime.getBaseUrl()}/v1/health`, {
    headers:{ authorization:`Bearer ${token}` }
  });
  let health = await response.json();
  assert.equal(response.ok, true);
  assert.equal(health.healthy, true);
  assert.equal(health.loopbackOnly, true);
  assert.equal(health.authenticated, true);

  process.kill(firstPid, 'SIGTERM');

  const restarted = await waitFor(() => {
    const status = runtime.status();
    return status.running && status.pid && status.pid !== firstPid ? status : null;
  });
  assert.notEqual(restarted.pid, firstPid);
  assert.equal(getActiveFiscalSidecarAuthToken(), token);

  response = await fetch(`${runtime.getBaseUrl()}/v1/health`, {
    headers:{ authorization:`Bearer ${token}` }
  });
  health = await response.json();
  assert.equal(response.ok, true);
  assert.equal(health.healthy, true);

  await runtime.stop();
  assert.equal(runtime.status().running, false);
  assert.equal(runtime.getBaseUrl(), null);
  assert.equal(getActiveFiscalSidecarAuthToken(), null);
});

test('E2E security invariant: lifecycle refuses LAN binding before spawning a child', () => {
  assert.throws(() => createFiscalSidecarRuntime({ host:'0.0.0.0' }), /loopback/i);
  assert.throws(() => createFiscalSidecarRuntime({ host:'192.168.1.20' }), /loopback/i);
});
