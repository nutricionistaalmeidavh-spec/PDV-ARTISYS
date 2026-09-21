'use strict';

const { validateSecretConnection, publicConnection, validateReference } = require('./fiscal-core');
const {
  normalizeAuthToken,
  normalizeBoundedInteger,
  sanitizeText
} = require('./security-hardening');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function normalizeLoopbackBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Fiscal sidecar local indisponivel.');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Endereco do fiscal sidecar invalido.');
  }
  if (parsed.protocol !== 'http:') throw new Error('Fiscal sidecar deve usar HTTP local.');
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) throw new Error('Fiscal sidecar deve usar somente loopback local.');
  if (parsed.username || parsed.password) throw new Error('Endereco do fiscal sidecar nao pode conter credenciais.');
  return parsed.origin;
}

function createAcbrLocalProvider({
  connection,
  baseUrl,
  authToken,
  fetchImpl = globalThis.fetch,
  timeoutMs = 10000,
  maxRequestBytes = 512 * 1024,
  maxResponseBytes = 2 * 1024 * 1024
} = {}) {
  const localConnection = validateSecretConnection(connection);
  if (localConnection.provider !== 'acbr-local') throw new Error('Provedor fiscal local nao suportado.');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required.');
  const endpoint = normalizeLoopbackBaseUrl(baseUrl);
  const safeToken = normalizeAuthToken(authToken);
  const safeTimeoutMs = normalizeBoundedInteger(timeoutMs, {
    name:'Timeout do provider fiscal local', fallback:10000, min:1000, max:60000
  });
  const safeMaxRequestBytes = normalizeBoundedInteger(maxRequestBytes, {
    name:'Limite de request fiscal local', fallback:512 * 1024, min:16 * 1024, max:2 * 1024 * 1024
  });
  const safeMaxResponseBytes = normalizeBoundedInteger(maxResponseBytes, {
    name:'Limite de resposta fiscal local', fallback:2 * 1024 * 1024, min:64 * 1024, max:4 * 1024 * 1024
  });

  function documentType(value) {
    const type = String(value || localConnection.documentType).trim().toLowerCase();
    if (!['nfce','nfe'].includes(type)) throw new Error('Tipo de documento fiscal invalido.');
    return type;
  }

  async function request(pathname, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
    try {
      const headers = {
        accept:'application/json',
        authorization:`Bearer ${safeToken}`
      };
      let payload;
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body);
        if (Buffer.byteLength(payload, 'utf8') > safeMaxRequestBytes) {
          const error = new Error('Payload fiscal local excede o limite permitido.');
          error.statusCode = 413;
          throw error;
        }
      }
      const response = await fetchImpl(`${endpoint}${pathname}`, {
        method,
        headers,
        body:payload,
        signal:controller.signal
      });
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > safeMaxResponseBytes) throw new Error('Resposta fiscal local excede o limite permitido.');
      let data = null;
      if (text) {
        try { data = JSON.parse(text); }
        catch { data = { message:text.slice(0, 4000) }; }
      }
      return {
        ok:Boolean(response.ok),
        status:Number(response.status || 0),
        data,
        error:response.ok ? null : sanitizeText(data?.error || data?.message || `HTTP ${response.status || 0}`)
      };
    } catch (error) {
      if (error?.name === 'AbortError') return { ok:false, status:408, data:null, error:'Tempo limite na comunicacao com o fiscal sidecar.' };
      return {
        ok:false,
        status:Number(error?.statusCode || 0),
        data:null,
        error:sanitizeText(error?.message || String(error))
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeSidecarResult(response) {
    if (!response?.ok) return response || { ok:false, status:0, data:null, error:'Fiscal sidecar indisponivel.' };
    const result = response.data?.result;
    if (!result || typeof result.ok !== 'boolean') {
      return { ok:false, status:502, data:response.data || null, error:'Resposta invalida do fiscal sidecar.' };
    }
    return {
      ok:Boolean(result.ok),
      status:Number(result.status || (result.ok ? 200 : 500)),
      data:result.data ?? null,
      error:result.error ? sanitizeText(result.error) : null
    };
  }

  async function status() {
    return { ...publicConnection(localConnection), baseUrl:endpoint };
  }

  async function testConnection() {
    const response = await request('/v1/health');
    return {
      ...publicConnection(localConnection),
      reachable:Boolean(response.ok && response.data?.healthy === true),
      status:response.status,
      error:response.error || (response.ok && response.data?.healthy !== true ? 'Fiscal sidecar nao confirmou saude.' : null),
      sidecar:response.data || null
    };
  }

  async function sefazStatus() {
    return normalizeSidecarResult(await request('/v1/sefaz/status'));
  }

  async function issue(document = {}) {
    const type = documentType(document.documentType);
    const reference = encodeURIComponent(validateReference(document.reference));
    return normalizeSidecarResult(await request(`/v1/documents/${type}/${reference}`, {
      method:'POST',
      body:{ payload:document.payload || {}, environment:localConnection.environment }
    }));
  }

  async function query(reference, type = localConnection.documentType) {
    const safeType = documentType(type);
    const safeReference = encodeURIComponent(validateReference(reference));
    return normalizeSidecarResult(await request(`/v1/documents/${safeType}/${safeReference}?environment=${encodeURIComponent(localConnection.environment)}`));
  }

  async function cancel(reference, justification, type = localConnection.documentType) {
    const safeType = documentType(type);
    const safeReference = encodeURIComponent(validateReference(reference));
    const reason = String(justification || '').trim();
    if (reason.length < 15) throw new Error('Justificativa de cancelamento deve ter ao menos 15 caracteres.');
    return normalizeSidecarResult(await request(`/v1/documents/${safeType}/${safeReference}/cancel`, {
      method:'POST',
      body:{ justification:reason, environment:localConnection.environment }
    }));
  }

  return Object.freeze({ status, testConnection, sefazStatus, issue, query, cancel });
}

module.exports = {
  LOOPBACK_HOSTS,
  normalizeLoopbackBaseUrl,
  createAcbrLocalProvider
};
