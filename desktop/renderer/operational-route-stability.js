'use strict';

(() => {
  const content = document.getElementById('route-content');
  const operational = window.PdvOperationalUi;
  const reportsV2 = window.PdvReportsV2;
  if (!content || typeof operational?.showRoute !== 'function') return;

  const STABLE_SIDEBAR_ROUTES = new Set(['inventory', 'finance', 'reports']);
  let scheduled = false;
  let restoring = false;
  let detachedStablePage = null;
  let detachedStableRoute = '';

  function activeOperationalRoute() {
    const active = document.querySelector('#sidebar-nav [data-route].active');
    const route = active?.dataset.route || '';
    return STABLE_SIDEBAR_ROUTES.has(route) ? route : '';
  }

  function operationalPageFromNode(node) {
    if (!(node instanceof Element)) return null;
    if (node.matches('.ops-page')) return node;
    return node.querySelector('.ops-page');
  }

  function captureDetachedPage(records) {
    if (content.querySelector('.ops-page')) return;
    const route = activeOperationalRoute();
    if (!route || route === 'reports') return;

    for (const record of records) {
      for (const removed of record.removedNodes) {
        const candidate = operationalPageFromNode(removed);
        if (!candidate) continue;
        detachedStablePage = candidate;
        detachedStableRoute = route;
        return;
      }
    }
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

    if (route !== 'reports' && detachedStablePage && detachedStableRoute === route) {
      restoring = true;
      try {
        const page = detachedStablePage;
        detachedStablePage = null;
        detachedStableRoute = '';
        content.replaceChildren(page);
      } finally {
        restoring = false;
      }
      return;
    }

    detachedStablePage = null;
    detachedStableRoute = '';
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

  new MutationObserver((records) => {
    captureDetachedPage(records);
    schedule();
  }).observe(content, { childList: true, subtree: true });
})();
