'use strict';

(() => {
  const { ApiClient } = window.PdvApiClient || {};
  const overlay = document.getElementById('auth-overlay');
  const toastRoot = document.getElementById('toast-root');
  if (!ApiClient || !overlay) return;

  const api = new ApiClient();
  let config = null;
  let rendering = false;

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

  async function replaceLegacySetup() {
    if (rendering) return;
    const title = overlay.querySelector('.auth-card h1')?.textContent?.trim();
    if (title !== 'Configurar ArtiSys PDV') return;
    rendering = true;
    try {
      await ensureConfig();
      const setup = await api.setupStatus();
      if (!setup?.needsSetup) return;
      if (setup.activation?.required) renderActivation();
      else renderFirstAccess(setup.activation?.activation?.accountEmail || '');
    } catch (error) {
      rendering = false;
      showToast(error.message, 'error');
    }
  }

  const observer = new MutationObserver(() => { void replaceLegacySetup(); });
  observer.observe(overlay, { childList:true, subtree:true });
  void replaceLegacySetup();
})();
