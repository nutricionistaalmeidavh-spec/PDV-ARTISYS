'use strict';

function bearer(request) {
  const value = String(request.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(payload));
}

function createAuthSessionRouter({ runtime, sessionStore, requireTerminalAuth = false } = {}) {
  if (!runtime) throw new TypeError('runtime is required.');
  if (!sessionStore) throw new TypeError('sessionStore is required.');

  return async function authSessionRoute(request, response) {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method !== 'GET' || url.pathname !== '/api/v1/auth/session') return false;

    const token = bearer(request);
    const session = sessionStore.get(token);
    if (!session || session.expiresAt <= Date.now()) {
      if (token) sessionStore.delete(token);
      sendJson(response, 401, { error: 'Sessao invalida ou expirada.' });
      return true;
    }

    if (requireTerminalAuth) {
      const terminal = runtime.terminals.listTerminals().find(item => item.terminalId === session.terminalId);
      if (!terminal || terminal.status !== 'ACTIVE') {
        sendJson(response, 401, { error: 'Terminal nao autorizado.' });
        return true;
      }
    }

    const user = runtime.catalog.getUser(session.userId);
    if (!user || !user.active) {
      sessionStore.delete(token);
      sendJson(response, 401, { error: 'Usuario inativo ou inexistente.' });
      return true;
    }

    sendJson(response, 200, {
      user,
      terminalId: session.terminalId || null,
      expiresAt: new Date(session.expiresAt).toISOString()
    });
    return true;
  };
}

module.exports = { createAuthSessionRouter };
