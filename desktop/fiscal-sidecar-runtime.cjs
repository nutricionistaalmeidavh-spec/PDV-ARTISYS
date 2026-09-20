'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);

function assertLoopbackHost(host) {
  const value = String(host || '').trim();
  if (!LOOPBACK_HOSTS.has(value)) throw new Error('Fiscal sidecar deve usar somente loopback local.');
  return value;
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Porta do fiscal sidecar invalida.');
  return port;
}

function endpointFor(host, port) {
  return `http://${host === '::1' ? '[::1]' : host}:${port}`;
}

function createFiscalSidecarRuntime({
  entryPath = path.join(__dirname, '..', 'server', 'fiscal-sidecar', 'entry.js'),
  forkImpl = fork,
  execPath = process.execPath,
  env = process.env,
  host = '127.0.0.1',
  port = 0,
  readyTimeoutMs = 10000,
  restartDelayMs = 250,
  maxRestarts = 3,
  onError = () => {}
} = {}) {
  const safeHost = assertLoopbackHost(host);
  const safePort = normalizePort(port);
  if (typeof forkImpl !== 'function') throw new TypeError('forkImpl is required.');
  if (typeof onError !== 'function') throw new TypeError('onError must be a function.');

  let child = null;
  let baseUrl = null;
  let stopping = false;
  let restartCount = 0;
  let restartTimer = null;
  let startPromise = null;

  function childOptions() {
    return {
      execPath,
      silent:true,
      env:{
        ...env,
        ELECTRON_RUN_AS_NODE:'1',
        ARTISYS_FISCAL_SIDECAR_HOST:safeHost,
        ARTISYS_FISCAL_SIDECAR_PORT:String(safePort)
      }
    };
  }

  function scheduleRestart() {
    if (stopping || restartTimer || restartCount >= maxRestarts) return;
    restartCount += 1;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startPromise = null;
      void start().catch(error => { onError(error); scheduleRestart(); });
    }, Math.max(0, Number(restartDelayMs) || 0));
    restartTimer.unref?.();
  }

  function spawnChild() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const next = forkImpl(entryPath, [], childOptions());
      child = next;
      baseUrl = null;

      const cleanupReady = () => {
        clearTimeout(timer);
        next.removeListener('message', onMessage);
        next.removeListener('error', onStartupError);
      };

      const failStartup = error => {
        if (settled) return;
        settled = true;
        cleanupReady();
        if (child === next) child = null;
        reject(error);
      };

      const onMessage = message => {
        if (message?.type === 'artisys:fiscal-sidecar:error') {
          failStartup(new Error(message.error || 'Falha ao iniciar fiscal sidecar.'));
          return;
        }
        if (message?.type !== 'artisys:fiscal-sidecar:ready') return;
        const readyPort = normalizePort(message.port);
        if (readyPort === 0) {
          failStartup(new Error('Fiscal sidecar iniciou sem porta valida.'));
          return;
        }
        if (settled) return;
        settled = true;
        cleanupReady();
        restartCount = 0;
        baseUrl = endpointFor(safeHost, readyPort);
        resolve({ baseUrl, pid:next.pid, host:safeHost, port:readyPort });
      };

      const onStartupError = error => failStartup(error);
      const timer = setTimeout(() => {
        next.kill();
        failStartup(new Error('Tempo limite ao iniciar fiscal sidecar.'));
      }, Math.max(1000, Number(readyTimeoutMs) || 10000));
      timer.unref?.();

      next.on('message', onMessage);
      next.once('error', onStartupError);
      next.once('exit', (code, signal) => {
        const wasCurrent = child === next;
        if (wasCurrent) {
          child = null;
          baseUrl = null;
        }
        if (!settled) {
          failStartup(new Error(`Fiscal sidecar encerrou durante startup (${signal || code || 0}).`));
          return;
        }
        if (wasCurrent && !stopping) {
          onError(new Error(`Fiscal sidecar encerrou inesperadamente (${signal || code || 0}).`));
          scheduleRestart();
        }
      });

      next.stderr?.on('data', chunk => {
        const message = String(chunk || '').trim();
        if (message) onError(new Error(`Fiscal sidecar: ${message}`));
      });
    });
  }

  async function start() {
    if (child && baseUrl) return { baseUrl, pid:child.pid, host:safeHost, port:Number(new URL(baseUrl).port) };
    if (startPromise) return startPromise;
    stopping = false;
    startPromise = spawnChild();
    try {
      return await startPromise;
    } finally {
      startPromise = null;
    }
  }

  async function stop({ timeoutMs = 3000 } = {}) {
    stopping = true;
    if (restartTimer) {
      clearTimeout(restartTimer);
      restartTimer = null;
    }
    const current = child;
    child = null;
    baseUrl = null;
    if (!current) return;

    await new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        try { current.kill('SIGKILL'); } catch {}
        finish();
      }, Math.max(250, Number(timeoutMs) || 3000));
      timer.unref?.();
      current.once('exit', finish);
      try {
        if (current.connected) current.send({ type:'artisys:fiscal-sidecar:shutdown' });
        else current.kill('SIGTERM');
      } catch {
        try { current.kill('SIGTERM'); } catch {}
      }
    });
  }

  function status() {
    return {
      running:Boolean(child && baseUrl),
      baseUrl,
      pid:child?.pid || null,
      restartCount,
      loopbackOnly:true
    };
  }

  function getBaseUrl() {
    return baseUrl;
  }

  return Object.freeze({ start, stop, status, getBaseUrl });
}

module.exports = {
  LOOPBACK_HOSTS,
  assertLoopbackHost,
  endpointFor,
  createFiscalSidecarRuntime
};
