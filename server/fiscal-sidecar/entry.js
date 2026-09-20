'use strict';

const { createFiscalSidecar } = require('./index');
const { createControlledFiscalAdapter } = require('./controlled-adapter');

const host = String(process.env.ARTISYS_FISCAL_SIDECAR_HOST || '127.0.0.1');
const port = Number(process.env.ARTISYS_FISCAL_SIDECAR_PORT || 0);
const adapter = createControlledFiscalAdapter({
  mode:process.env.ARTISYS_FISCAL_SIDECAR_MODE || 'unconfigured'
});
const sidecar = createFiscalSidecar({ adapter, host, port });

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

sidecar.start().then(address => {
  const ready = {
    type:'artisys:fiscal-sidecar:ready',
    host:address.address,
    port:address.port,
    pid:process.pid
  };
  if (typeof process.send === 'function') process.send(ready);
  else process.stdout.write(`${JSON.stringify(ready)}\n`);
}).catch(error => {
  const payload = {
    type:'artisys:fiscal-sidecar:error',
    error:error?.message || String(error)
  };
  if (typeof process.send === 'function') process.send(payload);
  else process.stderr.write(`${payload.error}\n`);
  process.exitCode = 1;
});

process.on('message', message => {
  if (message?.type === 'artisys:fiscal-sidecar:shutdown') {
    void shutdown(0).then(() => process.exit(0));
  }
});

process.on('SIGTERM', () => { void shutdown(0).then(() => process.exit(0)); });
process.on('SIGINT', () => { void shutdown(0).then(() => process.exit(0)); });
