'use strict';

const http = require('node:http');
const {
  normalizeAuthToken,
  authorizeRequest,
  sanitizeText,
  sanitizeValue,
  normalizeBoundedInteger
} = require('../../js/domains/fiscal/security-hardening');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1']);
const DOCUMENT_TYPES = new Set(['nfce', 'nfe']);

function assertLoopbackHost(host) {
  const value = String(host || '').trim();
  if (!LOOPBACK_HOSTS.has(value)) throw new Error('Fiscal sidecar deve escutar somente em loopback local.');
  return value;
}

function normalizePort(value) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Porta do fiscal sidecar invalida.');
  return port;
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  if (res.headersSent || res.destroyed) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'content-type':'application/json; charset=utf-8',
    'content-length':Buffer.byteLength(body),
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    ...extraHeaders
  });
  res.end(body);
}

async function readJson(req, maxBytes) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error('Payload fiscal local excede o limite permitido.');
    error.statusCode = 413;
    throw error;
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Payload fiscal local excede o limite permitido.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('JSON fiscal local invalido.');
    error.statusCode = 400;
    throw error;
  }
}

function validateType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (!DOCUMENT_TYPES.has(type)) {
    const error = new Error('Tipo de documento fiscal invalido.');
    error.statusCode = 400;
    throw error;
  }
  return type;
}

function validateReference(value) {
  const reference = String(value || '').trim();
  if (!reference || reference.length > 80 || !/^[A-Za-z0-9._-]+$/.test(reference)) {
    const error = new Error('Referencia fiscal invalida.');
    error.statusCode = 400;
    throw error;
  }
  return reference;
}

function normalizeAdapterResult(result) {
  if (!result || typeof result !== 'object' || typeof result.ok !== 'boolean') {
    return { ok:false, status:502, data:null, error:'Adapter fiscal retornou resposta invalida.' };
  }
  return {
    ok:Boolean(result.ok),
    status:Number(result.status || (result.ok ? 200 : 500)),
    data:sanitizeValue(result.data ?? null),
    error:result.error ? sanitizeText(result.error) : null
  };
}

function createFiscalSidecar({
  adapter,
  authToken,
  host = '127.0.0.1',
  port = 0,
  maxBodyBytes = 512 * 1024,
  requestTimeoutMs = 45000,
  headersTimeoutMs = 5000,
  maxHeadersCount = 32
} = {}) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Fiscal adapter is required.');
  for (const method of ['status','issue','query','cancel']) {
    if (typeof adapter[method] !== 'function') throw new TypeError(`Fiscal adapter must implement ${method}().`);
  }

  const safeToken = normalizeAuthToken(authToken);
  const safeHost = assertLoopbackHost(host);
  const safePort = normalizePort(port);
  const safeMaxBodyBytes = normalizeBoundedInteger(maxBodyBytes, {
    name:'Limite de payload fiscal', fallback:512 * 1024, min:16 * 1024, max:2 * 1024 * 1024
  });
  const safeRequestTimeoutMs = normalizeBoundedInteger(requestTimeoutMs, {
    name:'Timeout de requisicao fiscal', fallback:45000, min:5000, max:120000
  });
  const safeHeadersTimeoutMs = normalizeBoundedInteger(headersTimeoutMs, {
    name:'Timeout de headers fiscal', fallback:5000, min:1000, max:Math.min(30000, safeRequestTimeoutMs)
  });
  const safeMaxHeadersCount = normalizeBoundedInteger(maxHeadersCount, {
    name:'Limite de headers fiscal', fallback:32, min:8, max:64
  });
  let server = null;

  async function handle(req, res) {
    if (!authorizeRequest(req, safeToken)) {
      return sendJson(res, 401, { error:'Nao autorizado.' }, { 'www-authenticate':'Bearer' });
    }

    const origin = `http://${safeHost === '::1' ? '[::1]' : safeHost}`;
    const url = new URL(req.url || '/', origin);
    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET' && url.pathname === '/v1/health') {
      const adapterStatus = normalizeAdapterResult(await adapter.status());
      return sendJson(res, 200, {
        healthy:true,
        service:'artisys-fiscal-sidecar',
        loopbackOnly:true,
        authenticated:true,
        adapter:{
          ok:adapterStatus.ok,
          status:adapterStatus.status,
          data:adapterStatus.data,
          error:adapterStatus.error
        }
      });
    }

    if (method === 'GET' && url.pathname === '/v1/sefaz/status') {
      return sendJson(res, 200, { result:normalizeAdapterResult(await adapter.status()) });
    }

    const match = url.pathname.match(/^\/v1\/documents\/([^/]+)\/([^/]+)(\/cancel)?$/);
    if (!match) return sendJson(res, 404, { error:'Rota fiscal local nao encontrada.' });

    const type = validateType(decodeURIComponent(match[1]));
    const reference = validateReference(decodeURIComponent(match[2]));
    const isCancel = Boolean(match[3]);

    if (isCancel) {
      if (method !== 'POST') return sendJson(res, 405, { error:'Metodo nao permitido.' });
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return sendJson(res, 415, { error:'Content-Type fiscal deve ser application/json.' });
      }
      const body = await readJson(req, safeMaxBodyBytes);
      const result = await adapter.cancel({
        type,
        reference,
        justification:String(body.justification || ''),
        environment:String(body.environment || 'homologation')
      });
      return sendJson(res, 200, { result:normalizeAdapterResult(result) });
    }

    if (method === 'POST') {
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return sendJson(res, 415, { error:'Content-Type fiscal deve ser application/json.' });
      }
      const body = await readJson(req, safeMaxBodyBytes);
      const result = await adapter.issue({
        type,
        reference,
        payload:body.payload && typeof body.payload === 'object' ? body.payload : {},
        environment:String(body.environment || 'homologation')
      });
      return sendJson(res, 200, { result:normalizeAdapterResult(result) });
    }

    if (method === 'GET') {
      const result = await adapter.query({
        type,
        reference,
        environment:String(url.searchParams.get('environment') || 'homologation')
      });
      return sendJson(res, 200, { result:normalizeAdapterResult(result) });
    }

    return sendJson(res, 405, { error:'Metodo nao permitido.' });
  }

  function start() {
    if (server) return Promise.resolve(server.address());
    server = http.createServer((req, res) => {
      Promise.resolve(handle(req, res)).catch(error => {
        const statusCode = Number(error?.statusCode || 500);
        sendJson(res, statusCode >= 400 && statusCode <= 599 ? statusCode : 500, {
          error:sanitizeText(error?.message || String(error))
        });
      });
    });
    server.keepAliveTimeout = 5000;
    server.requestTimeout = safeRequestTimeoutMs;
    server.headersTimeout = safeHeadersTimeoutMs;
    server.maxHeadersCount = safeMaxHeadersCount;
    server.maxRequestsPerSocket = 100;
    return new Promise((resolve, reject) => {
      const onError = error => {
        server?.removeListener('listening', onListening);
        server = null;
        reject(error);
      };
      const onListening = () => {
        server?.removeListener('error', onError);
        resolve(server.address());
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(safePort, safeHost);
    });
  }

  function stop() {
    if (!server) return Promise.resolve();
    const current = server;
    server = null;
    return new Promise((resolve, reject) => {
      current.close(error => error ? reject(error) : resolve());
    });
  }

  function address() {
    return server?.address() || null;
  }

  return Object.freeze({ start, stop, address });
}

module.exports = {
  LOOPBACK_HOSTS,
  DOCUMENT_TYPES,
  assertLoopbackHost,
  createFiscalSidecar
};
