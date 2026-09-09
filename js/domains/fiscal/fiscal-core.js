'use strict';

const PROVIDERS = new Set(['focus']);
const ENVIRONMENTS = new Set(['homologation','production']);
const DOCUMENT_TYPES = new Set(['nfce','nfe']);

function normalize(value) { return String(value || '').trim().toLowerCase(); }

function validateConnection(input = {}) {
  const provider = normalize(input.provider);
  const environment = normalize(input.environment);
  const documentType = normalize(input.documentType);
  if (!PROVIDERS.has(provider)) throw new Error('Provedor fiscal invalido.');
  if (!ENVIRONMENTS.has(environment)) throw new Error('Ambiente fiscal invalido.');
  if (!DOCUMENT_TYPES.has(documentType)) throw new Error('Tipo de documento fiscal invalido.');
  return { provider, environment, documentType };
}

function validateSecretConnection(input = {}) {
  const connection = validateConnection(input);
  const token = String(input.token || '').trim();
  if (!token) throw new Error('Token fiscal obrigatorio.');
  return { ...connection, token };
}

function publicConnection(input) {
  if (!input || typeof input !== 'object') return { configured:false };
  try {
    const connection = validateConnection(input);
    return { configured:Boolean(String(input.token || '').trim()), ...connection };
  } catch {
    return { configured:false };
  }
}

function validateReference(value) {
  const reference = String(value || '').trim();
  if (!reference) throw new Error('Referencia fiscal obrigatoria.');
  if (reference.length > 80) throw new Error('Referencia fiscal excede o limite permitido.');
  if (!/^[A-Za-z0-9._-]+$/.test(reference)) throw new Error('Referencia fiscal invalida.');
  return reference;
}

module.exports = {
  PROVIDERS,
  ENVIRONMENTS,
  DOCUMENT_TYPES,
  validateConnection,
  validateSecretConnection,
  publicConnection,
  validateReference
};
