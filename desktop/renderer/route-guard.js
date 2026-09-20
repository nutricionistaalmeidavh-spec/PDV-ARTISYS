'use strict';

(() => {
  const root = window;
  const content = document.getElementById('route-content');
  const authOverlay = document.getElementById('auth-overlay');
  if (!content) return;

  let visibleRoute = null;
  let repairScheduled = false;

  function authVisible() {
    return Boolean(authOverlay && !authOverlay.classList.contains('hidden'));
  }

  function heading() {
    return content.querySelector('h1')?.textContent?.trim() || '';
  }

  function rememberRoute(event) {
    const target = event.target?.closest?.('[data-route],[data-home-route]');
    if (!target) return;
    visibleRoute = target.dataset.route || target.dataset.homeRoute || null;
  }

  function repairReportsIfNeeded() {
    if (visibleRoute !== 'reports' || authVisible()) return;
    if (content.querySelector('.reports-page') || content.querySelector('.ops-error')) return;
    const currentHeading = heading();
    if (!currentHeading || currentHeading === 'Carregando' || currentHeading === 'Relatórios') return;
    if (repairScheduled) return;
    repairScheduled = true;
    queueMicrotask(() => {
      repairScheduled = false;
      if (visibleRoute !== 'reports' || authVisible()) return;
      if (content.querySelector('.reports-page') || content.querySelector('.ops-error')) return;
      void root.PdvReportsUi?.renderReports?.();
    });
  }

  root.addEventListener('click', rememberRoute, true);
  new MutationObserver(repairReportsIfNeeded).observe(content, { childList: true, subtree: true });

  root.PdvRouteGuard = Object.freeze({
    current: () => visibleRoute,
    ensure: repairReportsIfNeeded
  });
})();
