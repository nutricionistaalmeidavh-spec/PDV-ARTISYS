'use strict';

const path = require('node:path');
const { fork } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const {
  normalizeAuthToken,
  isProductionEnvironment,
  normalizeBoundedInteger,
  sanitizeText
} = require('../js/domains/fiscal/security-hardening');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const ENV_PASSTHROUGH = new Set([
  'PATH','Path','SystemRoot','WINDIR','ComSpec','TEMP','TMP','HOME','USERPROFILE','LOCALAPPDATA','APPDATA','NODE_ENV',
  'ARTISYS_FISCAL_SIDECAR_MODE','ARTISYS_FISCAL_SIDECAR_MAX_BODY_BYTES',
  'ARTISYS_FISCAL_SIDECAR_REQUEST_TIMEOUT_MS','ARTISYS_FISCAL_SIDECAR_HEADERS_TIMEOUT_MS',
  'ARTISYS_ACBR_HOST','ARTISYS_ACBR_PORT','ARTISYS_ACBR_TIMEOUT_MS'
]);

let activeFiscalSidecarAuthToken = null;

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

function buildSidecarEnv(source = {}, overrides = {}) {
  const output = {};
  for (const key of ENV_PASSTHROUGH) {
    if (source[key] !== undefined) output[key] = String(source[key]);
  }
  for (const [key, value] of Object.entries(overrides)) output[key] = String(value);
  return output;
}

function detectProductionRuntime(env = process.env, processLike = process) {
  return isProductionEnvironment(env) || Boolean(processLike?.resourcesPath && processLike?.defaultApp !== true);
}

function getActiveFiscalSidecarAuthToken() {
  return activeFiscalSidecarAuthToken;
}

function createFiscalSidecarRuntime({
  entryPath = path.join(__dirname, '..', 'server', 'fiscal-sidecar', 'entry.js'),
  forkImpl = fork,
  execPath = process.execPath,
  env = process.env,
  host = '127.0.0.1',
  port = 0,
  authToken = randomBytes(32).toString('base64url'),
  production = detectProductionRuntime(env),
  readyTimeoutMs = 10000,
  restartDelayMs = 250,
  maxRestarts = 3,
  onError = () => {}
} = {}) {
  const safeHost = assertLoopbackHost(host);
  const safePort = normalizePort(port);
  const safeToken = normalizeAuthToken(authToken);
  const safeReadyTimeoutMs = normalizeBoundedInteger(readyTimeoutMs, {
    name:'Timeout de startup do fiscal sidecar', fallback:10000, min:1000, max:30000
  });
  const safeRestartDelayMs = normalizeBoundedInteger(restartDelayMs, {
    name:'Delay de restart do fiscal sidecar', fallback:250, min:0, max:10000
  });
  const safeMaxRestarts = normalizeBoundedInteger(maxRestarts, {
    name:'Limite de restarts do fiscal sidecar', fallback:3, min:0, max:10
  });
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
      env:buildSidecarEnv(env, {
        ELECTRON_RUN_AS_NODE:'1',
        ARTISYS_FISCAL_SIDECAR_HOST:safeHost,
        ARTISYS_FISCAL_SIDECAR_PORT:String(safePort),
        ARTISYS_FISCAL_SIDECAR_TOKEN:safeToken,
        ARTISYS_FISCAL_PRODUCTION:production ? '1' : '0'
      })
    };
  }

  function scheduleRestart() {
    if (stopping || restartTimer || restartCount >= safeMaxRestarts) return;
    restartCount += 1;
    restartTimer = setTimeout(() => {
      restartTimer = null;
      startPromise = null;
      void start().catch(error => { onError(error); scheduleRestart(); });
    }, safeRestartDelayMs);
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
        if (activeFiscalSidecarAuthToken === safeToken) activeFiscalSidecarAuthToken = null;
        reject(error);
      };

      const onMessage = message => {
        if (message?.type === 'artisys:fiscal-sidecar:error') {
          failStartup(new Error(sanitizeText(message.error || 'Falha ao iniciar fiscal sidecar.')));
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
        activeFiscalSidecarAuthToken = safeToken;
        resolve({ baseUrl, pid:next.pid, host:safeHost, port:readyPort });
      };

      const onStartupError = error => failStartup(new Error(sanitizeText(error?.message || error)));
      const timer = setTimeout(() => {
        next.kill();
        failStartup(new Error('Tempo limite ao iniciar fiscal sidecar.'));
      }, safeReadyTimeoutMs);
      timer.unref?.();

      next.on('message', onMessage);
      next.once('error', onStartupError);
      next.once('exit', (code, signal) => {
        const wasCurrent = child === next;
        if (wasCurrent) {
          child = null;
          baseUrl = null;
          if (activeFiscalSidecarAuthToken === safeToken) activeFiscalSidecarAuthToken = null;
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
        const message = sanitizeText(String(chunk || '').trim());
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
    if (activeFiscalSidecarAuthToken === safeToken) activeFiscalSidecarAuthToken = null;
    if (!current) return;

    const safeStopTimeoutMs = normalizeBoundedInteger(timeoutMs, {
      name:'Timeout de parada do fiscal sidecar', fallback:3000, min:250, max:15000
    });
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
      }, safeStopTimeoutMs);
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
      loopbackOnly:true,
      authenticated:true
    };
  }

  function getBaseUrl() {
    return baseUrl;
  }

  function getAuthToken() {
    return safeToken;
  }

  return Object.freeze({ start, stop, status, getBaseUrl, getAuthToken });
}

module.exports = {
  LOOPBACK_HOSTS,
  ENV_PASSTHROUGH,
  assertLoopbackHost,
  endpointFor,
  buildSidecarEnv,
  detectProductionRuntime,
  getActiveFiscalSidecarAuthToken,
  createFiscalSidecarRuntime
};
