'use strict';
const {statusForError}=require('./http-error-status');

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store'
  });
  res.end(JSON.stringify(payload));
}

async function readJson(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('Corpo fiscal excede o limite permitido.'), { statusCode:413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSON fiscal invalido.'), { statusCode:400 });
  }
}

function bearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function safeCompany(settings) {
  if (!settings) return null;
  const { createdAt:_, updatedAt:__, ...safe } = settings;
  return safe;
}

function productCoverage(runtime) {
  const products = runtime.catalog.listProducts();
  let configuredProducts = 0;
  for (const product of products) {
    const fiscal = runtime.fiscalConfiguration.getProductFiscalData(product.id);
    if (fiscal && fiscal.active !== false) configuredProducts += 1;
  }
  const totalProducts = products.length;
  const pendingProducts = totalProducts - configuredProducts;
  const coveragePercent = totalProducts === 0 ? 100 : Math.round((configuredProducts / totalProducts) * 100);
  return { totalProducts, configuredProducts, pendingProducts, coveragePercent };
}

function createFiscalBlock6Router({ runtime, sessionStore, bodyLimitBytes=2*1024*1024 }={}) {
  if (!runtime?.fiscalProduction || !runtime?.fiscalConfiguration || !sessionStore) {
    throw new TypeError('runtime fiscal P14-P16 e sessionStore sao obrigatorios.');
  }

  function session(req) {
    const token = bearer(req);
    const current = sessionStore.get(token);
    if (!current || current.expiresAt <= Date.now()) {
      if (token) sessionStore.delete(token);
      throw Object.assign(new Error('Sessao invalida ou expirada.'), { statusCode:401 });
    }
    if (!['admin','manager'].includes(current.role)) {
      throw Object.assign(new Error('Permissao insuficiente.'), { statusCode:403 });
    }
    return current;
  }

  function actor(current) {
    return { userId:current.userId, role:current.role, terminalId:current.terminalId || null };
  }

  function saveSettings(body, currentActor) {
    const currentSettings = runtime.fiscalConfiguration.getCompanySettings();
    const environment = String(body.environment || currentSettings?.environment || 'homologation').toLowerCase();
    if (environment === 'production' && !runtime.fiscalProduction.getActivation().enabled) {
      throw new Error('Producao ainda nao ativada pelo checklist fiscal.');
    }
    return safeCompany(runtime.fiscalConfiguration.saveCompanySettings(body, currentActor));
  }

  return async function route(req, res) {
    const url = new URL(req.url || '/', 'http://localhost');
    const pathname = url.pathname;
    const legacyProductProfile = /^\/api\/v1\/fiscal\/products\/[^/]+\/profile$/.test(pathname);
    const canonicalProductFiscal = /^\/api\/v1\/products\/[^/]+\/fiscal$/.test(pathname);
    const profileItem = /^\/api\/v1\/fiscal\/profiles\/[^/]+$/.test(pathname);
    const isFiscalConfig = pathname === '/api/v1/fiscal/configuration'
      || pathname === '/api/v1/fiscal/settings'
      || pathname === '/api/v1/fiscal/profiles'
      || profileItem
      || pathname === '/api/v1/fiscal/sequences'
      || pathname === '/api/v1/fiscal/product-coverage'
      || legacyProductProfile
      || canonicalProductFiscal;

    if (!isFiscalConfig
      && !pathname.startsWith('/api/v1/fiscal/production')
      && !pathname.startsWith('/api/v1/fiscal/contingencies')
      && !/\/api\/v1\/fiscal\/documents\/[^/]+\/contingency/.test(pathname)) return false;

    let current;
    try {
      current = session(req);
    } catch (error) {
      sendJson(res, Number(error.statusCode || 401), { error:error.message });
      return true;
    }

    const currentActor = actor(current);
    const method = String(req.method || 'GET').toUpperCase();

    try {
      if (method === 'GET' && pathname === '/api/v1/fiscal/settings') {
        sendJson(res, 200, safeCompany(runtime.fiscalConfiguration.getCompanySettings()));
        return true;
      }
      if (method === 'PUT' && pathname === '/api/v1/fiscal/settings') {
        const body = await readJson(req, bodyLimitBytes);
        sendJson(res, 200, saveSettings(body, currentActor));
        return true;
      }

      if (method === 'GET' && pathname === '/api/v1/fiscal/configuration') {
        const settings = runtime.fiscalConfiguration.getCompanySettings();
        const certificate = runtime.fiscalConfiguration.getCertificateMetadata();
        sendJson(res, 200, {
          settings:safeCompany(settings),
          certificate,
          profiles:runtime.fiscalConfiguration.listProfiles({ includeInactive:true }),
          production:runtime.fiscalProduction.getReadiness()
        });
        return true;
      }
      if (method === 'PUT' && pathname === '/api/v1/fiscal/configuration') {
        const body = await readJson(req, bodyLimitBytes);
        sendJson(res, 200, saveSettings(body, currentActor));
        return true;
      }

      if (method === 'GET' && pathname === '/api/v1/fiscal/profiles') {
        sendJson(res, 200, runtime.fiscalConfiguration.listProfiles({ includeInactive:url.searchParams.get('includeInactive') === 'true' }));
        return true;
      }
      if (method === 'POST' && pathname === '/api/v1/fiscal/profiles') {
        const body = await readJson(req, bodyLimitBytes);
        sendJson(res, 201, runtime.fiscalConfiguration.upsertProfile(body, currentActor));
        return true;
      }

      let match = pathname.match(/^\/api\/v1\/fiscal\/profiles\/([^/]+)$/);
      if (method === 'GET' && match) {
        const item = runtime.fiscalConfiguration.getProfile(decodeURIComponent(match[1]));
        if (!item) throw Object.assign(new Error('Perfil fiscal nao encontrado.'), { statusCode:404 });
        sendJson(res, 200, item);
        return true;
      }
      if (method === 'PUT' && match) {
        const body = await readJson(req, bodyLimitBytes);
        const id = decodeURIComponent(match[1]);
        sendJson(res, 200, runtime.fiscalConfiguration.upsertProfile({ ...body, id }, currentActor));
        return true;
      }

      if (method === 'GET' && pathname === '/api/v1/fiscal/product-coverage') {
        sendJson(res, 200, productCoverage(runtime));
        return true;
      }

      if (method === 'GET' && pathname === '/api/v1/fiscal/sequences') {
        sendJson(res, 200, runtime.fiscalConfiguration.getSequence({
          documentType:url.searchParams.get('documentType'),
          environment:url.searchParams.get('environment'),
          series:url.searchParams.get('series')
        }));
        return true;
      }
      if (method === 'PUT' && pathname === '/api/v1/fiscal/sequences') {
        const body = await readJson(req, bodyLimitBytes);
        sendJson(res, 200, runtime.fiscalConfiguration.initializeSequence(body, currentActor));
        return true;
      }
      if (method === 'POST' && pathname === '/api/v1/fiscal/sequences') {
        const body = await readJson(req, bodyLimitBytes);
        sendJson(res, 201, runtime.fiscalConfiguration.initializeSequence(body, currentActor));
        return true;
      }

      match = pathname.match(/^\/api\/v1\/fiscal\/products\/([^/]+)\/profile$/);
      if (!match) match = pathname.match(/^\/api\/v1\/products\/([^/]+)\/fiscal$/);
      if (method === 'GET' && match) {
        sendJson(res, 200, runtime.fiscalConfiguration.getProductFiscalData(decodeURIComponent(match[1])));
        return true;
      }
      if (method === 'PUT' && match) {
        const body = await readJson(req, bodyLimitBytes);
        sendJson(res, 200, runtime.fiscalConfiguration.assignProductProfile({
          productId:decodeURIComponent(match[1]),
          profileId:body.profileId,
          gtin:body.gtin,
          overrides:body.overrides
        }, currentActor));
        return true;
      }

      if (method === 'GET' && pathname === '/api/v1/fiscal/production/readiness') {
        sendJson(res, 200, runtime.fiscalProduction.getReadiness());
        return true;
      }
      if (method === 'POST' && pathname === '/api/v1/fiscal/production/evidence') {
        const body = await readJson(req, bodyLimitBytes);
        sendJson(res, 200, runtime.fiscalProduction.recordEvidence(body.key, {
          passed:body.passed,
          message:body.message,
          metadata:body.metadata
        }, currentActor));
        return true;
      }
      if (method === 'POST' && pathname === '/api/v1/fiscal/production/activate') {
        sendJson(res, 200, runtime.fiscalProduction.activateProduction(currentActor));
        return true;
      }
      if (method === 'POST' && pathname === '/api/v1/fiscal/production/deactivate') {
        sendJson(res, 200, runtime.fiscalProduction.deactivateProduction(currentActor));
        return true;
      }
      if (method === 'GET' && pathname === '/api/v1/fiscal/contingencies') {
        const status = url.searchParams.get('status');
        sendJson(res, 200, runtime.fiscalProduction.listContingencies({ status:status || null }));
        return true;
      }

      match = pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/contingency$/);
      if (method === 'GET' && match) {
        const item = runtime.fiscalProduction.getContingency(decodeURIComponent(match[1]));
        if (!item) throw Object.assign(new Error('Contingencia fiscal nao encontrada.'), { statusCode:404 });
        sendJson(res, 200, item);
        return true;
      }
      if (method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        const body = await readJson(req, bodyLimitBytes);
        const entry = runtime.fiscalProduction.enterContingency(id, { reason:body.reason, actor:currentActor });
        let prepared = entry;
        if (body.prepare !== false) {
          try {
            prepared = await runtime.fiscalProduction.prepareContingency(id, { actor:currentActor });
          } catch (error) {
            sendJson(res, 202, { contingency:runtime.fiscalProduction.getContingency(id), warning:error.message });
            return true;
          }
        }
        sendJson(res, 201, prepared);
        return true;
      }

      match = pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/contingency\/prepare$/);
      if (method === 'POST' && match) {
        sendJson(res, 200, await runtime.fiscalProduction.prepareContingency(decodeURIComponent(match[1]), { actor:currentActor }));
        return true;
      }
      match = pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/contingency\/transmit$/);
      if (method === 'POST' && match) {
        sendJson(res, 200, await runtime.fiscalProduction.transmitContingency(decodeURIComponent(match[1]), { actor:currentActor }));
        return true;
      }
      match = pathname.match(/^\/api\/v1\/fiscal\/documents\/([^/]+)\/contingency\/reconcile$/);
      if (method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        runtime.fiscalProduction.reconcileContingency(id, { actor:currentActor });
        const dispatch = await runtime.dispatchPending();
        sendJson(res, 200, { contingency:runtime.fiscalProduction.getContingency(id), dispatch });
        return true;
      }
      return false;
    } catch (error) {
      sendJson(res, statusForError(error), { error:error.message || 'Falha fiscal.' });
      return true;
    }
  };
}

module.exports = { createFiscalBlock6Router };
