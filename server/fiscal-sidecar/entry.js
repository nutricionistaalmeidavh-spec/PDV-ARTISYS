'use strict';

const { createFiscalSidecar } = require('./index');
const { createControlledFiscalAdapter } = require('./controlled-adapter');
const { createAcbrMonitorTcpTransport } = require('./acbr-monitor-protocol');
const { createAcbrMonitorAdapter } = require('./acbr-monitor-adapter');
const {
  normalizeAuthToken,
  isProductionEnvironment,
  assertProductionAdapterMode,
  normalizeBoundedInteger,
  sanitizeText
} = require('../../js/domains/fiscal/security-hardening');

function createAdapter(env = process.env) {
  const mode = assertProductionAdapterMode(
    String(env.ARTISYS_FISCAL_SIDECAR_MODE || 'unconfigured').trim().toLowerCase(),
    { production:isProductionEnvironment(env) }
  );
  if (mode === 'acbr-monitor') {
    const timeoutMs = normalizeBoundedInteger(env.ARTISYS_ACBR_TIMEOUT_MS, {
      name:'Timeout ACBr Monitor', fallback:30000, min:1000, max:60000
    });
    const transport = createAcbrMonitorTcpTransport({
      host:String(env.ARTISYS_ACBR_HOST || '127.0.0.1'),
      port:Number(env.ARTISYS_ACBR_PORT || 3434),
      timeoutMs
    });
    return { mode, adapter:createAcbrMonitorAdapter({ transport }) };
  }
  return {
    mode,
    adapter:createControlledFiscalAdapter({ mode, production:isProductionEnvironment(env) })
  };
}

async function run(env = process.env) {
  const host = String(env.ARTISYS_FISCAL_SIDECAR_HOST || '127.0.0.1');
  const port = Number(env.ARTISYS_FISCAL_SIDECAR_PORT || 0);
  const authToken = normalizeAuthToken(env.ARTISYS_FISCAL_SIDECAR_TOKEN);
  const maxBodyBytes = normalizeBoundedInteger(env.ARTISYS_FISCAL_SIDECAR_MAX_BODY_BYTES, {
    name:'Limite de payload fiscal', fallback:512 * 1024, min:16 * 1024, max:2 * 1024 * 1024
  });
  const requestTimeoutMs = normalizeBoundedInteger(env.ARTISYS_FISCAL_SIDECAR_REQUEST_TIMEOUT_MS, {
    name:'Timeout de requisicao fiscal', fallback:45000, min:5000, max:120000
  });
  const headersTimeoutMs = normalizeBoundedInteger(env.ARTISYS_FISCAL_SIDECAR_HEADERS_TIMEOUT_MS, {
    name:'Timeout de headers fiscal', fallback:5000, min:1000, max:Math.min(30000, requestTimeoutMs)
  });
  const { mode, adapter } = createAdapter(env);
  const sidecar = createFiscalSidecar({
    adapter,
    authToken,
    host,
    port,
    maxBodyBytes,
    requestTimeoutMs,
    headersTimeoutMs
  });

  let closing = false;
  async function shutdown(code = 0) {
    if (closing) return;
    closing = true;
    try {
      await sidecar.stop();
    } finally {
      process.exitCode = code;
    }
  }

  process.on('message', message => {
    if (message?.type === 'artisys:fiscal-sidecar:shutdown') {
      void shutdown(0).then(() => process.exit(0));
    }
  });
  process.on('SIGTERM', () => { void shutdown(0).then(() => process.exit(0)); });
  process.on('SIGINT', () => { void shutdown(0).then(() => process.exit(0)); });

  const address = await sidecar.start();
  const ready = {
    type:'artisys:fiscal-sidecar:ready',
    host:address.address,
    port:address.port,
    pid:process.pid,
    adapterMode:mode,
    authenticated:true
  };
  if (typeof process.send === 'function') process.send(ready);
  else process.stdout.write(`${JSON.stringify(ready)}\n`);
  return sidecar;
}

if (require.main === module) {
  run().catch(error => {
    const message = sanitizeText(error?.message || String(error));
    const payload = { type:'artisys:fiscal-sidecar:error', error:message };
    if (typeof process.send === 'function') process.send(payload);
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  createAdapter,
  run
};
