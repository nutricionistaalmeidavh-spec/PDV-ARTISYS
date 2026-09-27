'use strict';

(() => {
  const content = document.getElementById('route-content');
  const operational = window.PdvOperationalUi;
  const reportsV2 = window.PdvReportsV2;
  if (!content || typeof operational?.showRoute !== 'function') return;

  const STABLE_OPERATIONAL_ROUTES = new Set(['inventory', 'cash', 'sales', 'returns', 'finance', 'reports', 'settings']);
  let scheduled = false;
  let restoring = false;

  function activeOperationalRoute() {
    const route = document.body.dataset.activeRoute || '';
    return STABLE_OPERATIONAL_ROUTES.has(route) ? route : '';
  }

  function hasOwnedSubview(route) {
    return (route === 'settings' && Boolean(content.querySelector('.vertical-page')))
      || (route === 'returns' && Boolean(content.querySelector('[data-returns-ui]')));
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
    if (!route || hasOwnedSubview(route)) return;

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
