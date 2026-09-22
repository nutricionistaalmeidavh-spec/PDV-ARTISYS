'use strict';

(() => {
  const content = document.getElementById('route-content');
  const operational = window.PdvOperationalUi;
  const reportsV2 = window.PdvReportsV2;
  if (!content || typeof operational?.showRoute !== 'function') return;

  const STABLE_SIDEBAR_ROUTES = new Set(['inventory', 'finance', 'reports']);
  let scheduled = false;
  let restoring = false;

  function activeOperationalRoute() {
    const active = document.querySelector('#sidebar-nav [data-route].active');
    const route = active?.dataset.route || '';
    return STABLE_SIDEBAR_ROUTES.has(route) ? route : '';
  }

  async function renderCanonicalRoute(route) {
    if (route === 'reports' && typeof reportsV2?.render === 'function') {
      await reportsV2.render();
      return;
    }
    await operational.showRoute(route);
  }

  async function stabilize() {
    if (restoring || content.querySelector('.ops-page')) return;
    const route = activeOperationalRoute();
    if (!route) return;

    restoring = true;
    try {
      await renderCanonicalRoute(route);
    } finally {
      restoring = false;
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      void stabilize();
    });
  }

  new MutationObserver(schedule).observe(content, { childList: true, subtree: true });
})();
