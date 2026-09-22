'use strict';

(() => {
  const overlay = document.getElementById('auth-overlay');
  const toastRoot = document.getElementById('toast-root');
  if (!overlay || !toastRoot) return;

  let guardingKitReload = false;

  function showReloadGuard() {
    guardingKitReload = true;
    overlay.classList.remove('hidden');
    overlay.dataset.reloadGuard = 'kit';
    overlay.innerHTML = '<section class="auth-card"><div class="auth-logo">A</div><h1>Atualizando catálogo</h1><p>Salvando o kit e restaurando sua sessão...</p></section>';
  }

  function releaseReloadGuard() {
    if (!guardingKitReload) return;
    guardingKitReload = false;
    delete overlay.dataset.reloadGuard;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  document.addEventListener('submit', (event) => {
    if (event.target?.id !== 'kc-kit-form') return;
    showReloadGuard();
  }, true);

  const toastObserver = new MutationObserver((records) => {
    if (!guardingKitReload) return;
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches?.('.toast.error') || node.querySelector?.('.toast.error')) {
          releaseReloadGuard();
          return;
        }
      }
    }
  });
  toastObserver.observe(toastRoot, { childList: true, subtree: true });
})();
