'use strict';

(() => {
  const { ApiClient } = window.PdvApiClient || {};
  const overlay = document.getElementById('auth-overlay');
  const toastRoot = document.getElementById('toast-root');
  if (!ApiClient || !overlay) return;

  if (!ApiClient.prototype.requestPasswordRecovery) {
    ApiClient.prototype.requestPasswordRecovery = function requestPasswordRecovery(body) {
      return this.request('/api/v1/auth/password-recovery/request', { method:'POST', body });
    };
  }
  if (!ApiClient.prototype.confirmPasswordRecovery) {
    ApiClient.prototype.confirmPasswordRecovery = function confirmPasswordRecovery(body) {
      return this.request('/api/v1/auth/password-recovery/confirm', { method:'POST', body });
    };
  }

  const api = new ApiClient();
  let config = null;
  let rendering = false;
  let setupCache = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function showToast(message, type = '') {
    if (!toastRoot) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = String(message || 'Falha no primeiro acesso.');
    toastRoot.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  async function ensureConfig() {
    if (!config) config = await api.initialize();
    return config;
  }

  async function setupStatus(force = false) {
    if (!setupCache || force) setupCache = await api.setupStatus();
    return setupCache;
  }

  function renderFirstAccess(prefillEmail = '') {
    rendering = true;
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Primeiro acesso ao ArtiSys</h1><p>Crie o administrador principal desta instalação. O acesso ao PDV continua local.</p><form id="first-access-form"><div class="field"><label>Nome</label><input name="name" autocomplete="name" required value="Administrador"></div><div class="field"><label>Usuário</label><input name="username" autocomplete="username" required value="admin"></div><div class="field"><label>E-mail <small>(opcional)</small></label><input name="email" type="email" autocomplete="email" value="${escapeHtml(prefillEmail)}"></div><div class="field"><label>Senha</label><input name="password" type="password" autocomplete="new-password" minlength="10" required></div><div class="field"><label>Confirmar senha</label><input name="passwordConfirm" type="password" autocomplete="new-password" minlength="10" required></div><button class="primary-button" type="submit">Criar administrador e entrar</button></form></section>`;
    const form = overlay.querySelector('#first-access-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const name = String(values.get('name') || '').trim();
      const username = String(values.get('username') || '').trim();
      const email = String(values.get('email') || '').trim();
      const password = String(values.get('password') || '');
      const passwordConfirm = String(values.get('passwordConfirm') || '');
      if (password !== passwordConfirm) return showToast('As senhas não conferem.', 'error');
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const cfg = await ensureConfig();
        await api.setupAdmin({ name, username, password, ...(email ? { email } : {}) });
        await api.login({ username, password, terminalId: cfg.terminalId });
        window.location.reload();
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
      }
    });
    queueMicrotask(() => { rendering = false; });
  }

  function renderActivation() {
    rendering = true;
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Ativar instalação</h1><p>Esta instalação foi configurada para ativação comercial. Dados operacionais e senhas permanecem neste computador.</p><form id="activation-request-form"><div class="field"><label>E-mail da conta</label><input name="email" type="email" autocomplete="email" required></div><button class="primary-button" type="submit">Enviar código</button></form></section>`;
    const requestForm = overlay.querySelector('#activation-request-form');
    requestForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = String(new FormData(requestForm).get('email') || '').trim();
      const button = requestForm.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        await api.requestSetupActivation(email);
        overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Confirmar ativação</h1><p>Informe o código enviado para <strong>${escapeHtml(email)}</strong>.</p><form id="activation-verify-form"><div class="field"><label>Código</label><input name="code" inputmode="numeric" autocomplete="one-time-code" required></div><button class="primary-button" type="submit">Confirmar ativação</button></form></section>`;
        const verifyForm = overlay.querySelector('#activation-verify-form');
        verifyForm?.addEventListener('submit', async (verifyEvent) => {
          verifyEvent.preventDefault();
          const code = String(new FormData(verifyForm).get('code') || '').trim();
          const verifyButton = verifyForm.querySelector('button[type="submit"]');
          if (verifyButton) verifyButton.disabled = true;
          try {
            await api.verifySetupActivation(email, code);
            setupCache = null;
            renderFirstAccess(email);
          } catch (error) {
            if (verifyButton) verifyButton.disabled = false;
            showToast(error.message, 'error');
          }
        });
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
      }
    });
    queueMicrotask(() => { rendering = false; });
  }

  function renderRecoveryRequest() {
    rendering = true;
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Recuperar senha</h1><p>Informe o e-mail vinculado ao administrador desta instalação.</p><form id="password-recovery-request-form"><div class="field"><label>E-mail</label><input name="recoveryEmail" type="email" autocomplete="email" required></div><button class="primary-button" type="submit">Enviar código</button><button class="secondary-button" type="button" data-back-login>Voltar</button></form></section>`;
    overlay.querySelector('[data-back-login]')?.addEventListener('click', () => window.location.reload());
    const form = overlay.querySelector('#password-recovery-request-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = String(new FormData(form).get('recoveryEmail') || '').trim();
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const result = await api.requestPasswordRecovery({ email });
        showToast(result?.message || 'Se o e-mail estiver cadastrado, o código será enviado.', 'success');
        renderRecoveryConfirm(email);
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
      }
    });
    queueMicrotask(() => { rendering = false; });
  }

  function renderRecoveryConfirm(email) {
    rendering = true;
    overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Recuperar senha</h1><p>Informe o código recebido por e-mail e crie uma nova senha local.</p><form id="password-recovery-confirm-form"><div class="field"><label>Código</label><input name="recoveryCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></div><div class="field"><label>Nova senha</label><input name="newPassword" type="password" autocomplete="new-password" minlength="10" required></div><div class="field"><label>Confirmar nova senha</label><input name="newPasswordConfirm" type="password" autocomplete="new-password" minlength="10" required></div><button class="primary-button" type="submit">Alterar senha</button><button class="secondary-button" type="button" data-resend>Enviar novo código</button></form></section>`;
    overlay.querySelector('[data-resend]')?.addEventListener('click', renderRecoveryRequest);
    const form = overlay.querySelector('#password-recovery-confirm-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const code = String(values.get('recoveryCode') || '').trim();
      const password = String(values.get('newPassword') || '');
      const passwordConfirm = String(values.get('newPasswordConfirm') || '');
      if (password !== passwordConfirm) return showToast('As senhas não conferem.', 'error');
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        await api.confirmPasswordRecovery({ email, code, password });
        overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Senha alterada</h1><p>A nova senha foi salva somente neste computador e as sessões anteriores foram encerradas.</p><button class="primary-button" type="button" data-back-login>Entrar com a nova senha</button></section>`;
        overlay.querySelector('[data-back-login]')?.addEventListener('click', () => window.location.reload());
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
      }
    });
    queueMicrotask(() => { rendering = false; });
  }

  async function syncAuthOverlay() {
    if (rendering) return;
    const title = overlay.querySelector('.auth-card h1')?.textContent?.trim();
    if (title === 'Configurar ArtiSys PDV') {
      rendering = true;
      try {
        await ensureConfig();
        const setup = await setupStatus(true);
        if (!setup?.needsSetup) return;
        if (setup.activation?.required) renderActivation();
        else renderFirstAccess(setup.activation?.activation?.accountEmail || '');
      } catch (error) {
        rendering = false;
        showToast(error.message, 'error');
      }
      return;
    }

    if (title === 'ArtiSys PDV' && overlay.querySelector('#login-form') && !overlay.querySelector('[data-password-recovery]')) {
      rendering = true;
      try {
        await ensureConfig();
        const setup = await setupStatus(true);
        if (overlay.querySelector('.auth-card h1')?.textContent?.trim() !== 'ArtiSys PDV') return;
        if (setup?.activation?.configured) {
          const form = overlay.querySelector('#login-form');
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'secondary-button';
          link.dataset.passwordRecovery = 'true';
          link.textContent = 'Esqueci minha senha';
          link.addEventListener('click', renderRecoveryRequest);
          form?.appendChild(link);
        }
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        rendering = false;
      }
    }
  }

  const observer = new MutationObserver(() => { void syncAuthOverlay(); });
  observer.observe(overlay, { childList:true, subtree:true });
  void syncAuthOverlay();
})();