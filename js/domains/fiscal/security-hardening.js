'use strict';

const crypto = require('node:crypto');

const MIN_AUTH_TOKEN_BYTES = 32;
const MAX_LOG_TEXT_LENGTH = 4096;
const MOCK_MODES = new Set(['mock-success', 'mock-failure']);

function normalizeAuthToken(value) {
  const token = String(value || '').trim();
  if (Buffer.byteLength(token, 'utf8') < MIN_AUTH_TOKEN_BYTES || token.length > 256) {
    throw new Error('Token de autenticacao do fiscal sidecar invalido.');
  }
  if (!/^[A-Za-z0-9._~-]+$/.test(token)) {
    throw new Error('Token de autenticacao do fiscal sidecar invalido.');
  }
  return token;
}

function bearerTokenFromHeader(value) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(value || '').trim());
  return match ? match[1] : '';
}

function safeTokenEquals(expected, actual) {
  const left = Buffer.from(String(expected || ''), 'utf8');
  const right = Buffer.from(String(actual || ''), 'utf8');
  if (!left.length || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function authorizeRequest(req, expectedToken) {
  const actual = bearerTokenFromHeader(req?.headers?.authorization);
  return safeTokenEquals(normalizeAuthToken(expectedToken), actual);
}

function sanitizeText(value, maxLength = MAX_LOG_TEXT_LENGTH) {
  let text = String(value ?? '');
  text = text.replace(/(Bearer\s+)[A-Za-z0-9._~+\/=:-]+/gi, '$1[REDACTED]');
  text = text.replace(/((?:authorization|token|access[_-]?token|secret|password|passphrase|api[_-]?key|csc|pfx(?:base64)?)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}&]+)/gi, '$1[REDACTED]');
  const limit = Math.max(256, Math.min(16384, Number(maxLength) || MAX_LOG_TEXT_LENGTH));
  return text.length > limit ? `${text.slice(0, limit)}...[truncated]` : text;
}

function sanitizeValue(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return sanitizeText(value);
  if (typeof value !== 'object') return value;
  if (depth >= 6) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitizeValue(item, depth + 1, seen));
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 100)) {
    if (/^(?:authorization|token|accessToken|access_token|secret|password|passphrase|apiKey|api_key|csc|pfx|pfxBase64)$/i.test(key)) {
      output[key] = '[REDACTED]';
    } else {
      output[key] = sanitizeValue(item, depth + 1, seen);
    }
  }
  return output;
}

function isProductionEnvironment(env = process.env) {
  return String(env.ARTISYS_FISCAL_PRODUCTION || '').trim() === '1' || String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function assertProductionAdapterMode(mode, { production = isProductionEnvironment() } = {}) {
  const normalized = String(mode || 'unconfigured').trim().toLowerCase();
  if (production && MOCK_MODES.has(normalized)) {
    throw new Error('Adapter fiscal mock e proibido em producao.');
  }
  return normalized;
}

function normalizeBoundedInteger(value, { name = 'Valor', fallback, min, max } = {}) {
  const parsed = value == null || value === '' ? Number(fallback) : Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} fora do limite permitido.`);
  }
  return parsed;
}

module.exports = {
  MIN_AUTH_TOKEN_BYTES,
  MAX_LOG_TEXT_LENGTH,
  MOCK_MODES,
  normalizeAuthToken,
  bearerTokenFromHeader,
  safeTokenEquals,
  authorizeRequest,
  sanitizeText,
  sanitizeValue,
  isProductionEnvironment,
  assertProductionAdapterMode,
  normalizeBoundedInteger
};
