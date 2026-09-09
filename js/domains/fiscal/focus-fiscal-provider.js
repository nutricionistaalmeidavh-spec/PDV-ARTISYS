'use strict';
const { validateSecretConnection, publicConnection, validateReference } = require('./fiscal-core');

const BASE_URLS = Object.freeze({
  homologation: 'https://homologacao.focusnfe.com.br',
  production: 'https://api.focusnfe.com.br'
});

function createFocusFiscalProvider({ connection, fetchImpl = globalThis.fetch, timeoutMs = 15000, maxResponseBytes = 2 * 1024 * 1024 } = {}) {
  const secret = validateSecretConnection(connection);
  if (secret.provider !== 'focus') throw new Error('Provedor fiscal nao suportado.');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required.');
  const baseUrl = BASE_URLS[secret.environment];
  const authorization = `Basic ${Buffer.from(`${secret.token}:`, 'utf8').toString('base64')}`;

  async function request(pathname, { method = 'GET', body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 15000));
    try {
      const headers = { accept: 'application/json', Authorization: authorization };
      let payload;
      if (body !== undefined) {
        headers['content-type'] = 'application/json';
        payload = JSON.stringify(body);
      }
      const response = await fetchImpl(`${baseUrl}${pathname}`, { method, headers, body: payload, signal: controller.signal });
      const text = await response.text();
      if (Buffer.byteLength(text, 'utf8') > maxResponseBytes) throw new Error('Resposta fiscal excede o limite permitido.');
      let data = null;
      if (text) {
        try { data = JSON.parse(text); }
        catch { data = { message: text.slice(0, 4000) }; }
      }
      const ok = Boolean(response.ok);
      return {
        ok,
        status: Number(response.status || 0),
        data,
        error: ok ? null : String(data?.mensagem || data?.message || data?.erro || `HTTP ${response.status || 0}`)
      };
    } catch (error) {
      if (error?.name === 'AbortError') return { ok:false, status:408, data:null, error:'Tempo limite na comunicacao fiscal.' };
      return { ok:false, status:0, data:null, error:error?.message || String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  function documentType(value) {
    const type = String(value || secret.documentType).trim().toLowerCase();
    if (!['nfce','nfe'].includes(type)) throw new Error('Tipo de documento fiscal invalido.');
    return type;
  }

  async function status() {
    return publicConnection(secret);
  }

  async function testConnection() {
    const result = await request('/v2/empresas', { method:'GET' });
    return { configured:true, reachable:result.ok, status:result.status, error:result.error || null, ...publicConnection(secret) };
  }

  async function issue(document = {}) {
    const type = documentType(document.documentType);
    const reference = encodeURIComponent(validateReference(document.reference));
    return request(`/v2/${type}?ref=${reference}`, { method:'POST', body:document.payload || {} });
  }

  async function query(reference, type = secret.documentType) {
    const safeType = documentType(type);
    const safeReference = encodeURIComponent(validateReference(reference));
    return request(`/v2/${safeType}/${safeReference}`);
  }

  async function cancel(reference, justification, type = secret.documentType) {
    const safeType = documentType(type);
    const safeReference = encodeURIComponent(validateReference(reference));
    const reason = String(justification || '').trim();
    if (reason.length < 15) throw new Error('Justificativa de cancelamento deve ter ao menos 15 caracteres.');
    return request(`/v2/${safeType}/${safeReference}`, { method:'DELETE', body:{ justificativa:reason } });
  }

  return Object.freeze({ status, testConnection, issue, query, cancel });
}

module.exports = { BASE_URLS, createFocusFiscalProvider };
