'use strict';

function normalizeEmail(value) {
  const text = String(value || '').trim().toLowerCase();
  return text || null;
}

function normalizeEndpoint(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function createAccountService({
  db,
  installationId='local',
  endpoint='',
  requireCommercialActivation=false,
  fetchImpl=globalThis.fetch,
  countUsers=()=>0,
  now=()=>new Date().toISOString()
}={}) {
  if (!db) throw new TypeError('Database is required.');
  const baseUrl = normalizeEndpoint(endpoint);
  const id = String(installationId || 'local').trim() || 'local';

  function activation() {
    const row = db.prepare(`SELECT installation_id,account_email,license_id,activated_at,activation_source,metadata_json
      FROM installation_activation WHERE installation_id=?`).get(id);
    if (!row) return null;
    return {
      installationId:row.installation_id,
      accountEmail:row.account_email,
      licenseId:row.license_id,
      activatedAt:row.activated_at,
      activationSource:row.activation_source,
      metadata:row.metadata_json ? JSON.parse(row.metadata_json) : null
    };
  }

  function status() {
    const current = activation();
    const configured = Boolean(baseUrl);
    const existingInstall = Number(countUsers() || 0) > 0;
    const required = Boolean(requireCommercialActivation) && configured && !existingInstall && !current;
    return { configured, required, activated:Boolean(current), activation:current };
  }

  async function remote(path, body) {
    if (!baseUrl || typeof fetchImpl !== 'function') throw new Error('Servico de conta indisponivel.');
    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method:'POST',
        headers:{ 'content-type':'application/json' },
        body:JSON.stringify(body)
      });
      let payload = {};
      try { payload = await response.json(); } catch { payload = {}; }
      if (!response.ok) throw new Error(payload.error || `Falha no servico de conta (${response.status}).`);
      return payload;
    } catch (error) {
      if (/Falha no servico de conta|ativacao|recuperacao|codigo/i.test(String(error?.message || ''))) throw error;
      throw new Error('Servico de conta indisponivel.');
    }
  }

  async function requestActivation(email) {
    const accountEmail = normalizeEmail(email);
    if (!accountEmail) throw new Error('E-mail obrigatorio para ativacao comercial.');
    return remote('/v1/activation/request', { installationId:id, email:accountEmail });
  }

  async function verifyActivation({ email, code }={}) {
    const accountEmail = normalizeEmail(email);
    const token = String(code || '').trim();
    if (!accountEmail || !token) throw new Error('E-mail e codigo sao obrigatorios para ativacao.');
    const payload = await remote('/v1/activation/verify', { installationId:id, email:accountEmail, code:token });
    const licenseId = String(payload.licenseId || payload.license_id || '').trim();
    if (!licenseId) throw new Error('Resposta de ativacao sem licenca valida.');
    const normalizedRemoteEmail = normalizeEmail(payload.accountEmail || payload.account_email || accountEmail) || accountEmail;
    const activatedAt = String(payload.activatedAt || payload.activated_at || now());
    const metadata = payload.metadata && typeof payload.metadata === 'object' ? payload.metadata : null;
    db.prepare(`INSERT INTO installation_activation(installation_id,account_email,license_id,activated_at,activation_source,metadata_json)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(installation_id) DO UPDATE SET account_email=excluded.account_email,license_id=excluded.license_id,
        activated_at=excluded.activated_at,activation_source=excluded.activation_source,metadata_json=excluded.metadata_json`)
      .run(id, normalizedRemoteEmail, licenseId, activatedAt, 'cloudflare-account', metadata ? JSON.stringify(metadata) : null);
    return activation();
  }

  async function requestPasswordRecovery(email) {
    const accountEmail = normalizeEmail(email);
    if (!accountEmail) throw new Error('E-mail obrigatorio para recuperacao.');
    return remote('/v1/password-recovery/request', { email:accountEmail });
  }

  async function verifyPasswordRecovery({ email, code }={}) {
    const accountEmail = normalizeEmail(email);
    const token = String(code || '').trim();
    if (!accountEmail || !token) throw new Error('E-mail e codigo sao obrigatorios para recuperacao.');
    const payload = await remote('/v1/password-recovery/verify', { email:accountEmail, code:token });
    const verifiedEmail = normalizeEmail(payload.accountEmail || payload.account_email || accountEmail);
    if (!payload.verified || !verifiedEmail) throw new Error('Codigo de recuperacao invalido ou expirado.');
    return { verified:true, accountEmail:verifiedEmail };
  }

  return {
    status,
    activation,
    requestActivation,
    verifyActivation,
    requestPasswordRecovery,
    verifyPasswordRecovery
  };
}

module.exports = { createAccountService, normalizeEmail };