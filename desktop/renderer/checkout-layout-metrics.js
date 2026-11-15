'use strict';

// Measure the usable checkout height in CSS pixels (also at Windows DPI scaling).
((root) => {
  const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  function calculateCheckoutSpace({ viewportHeight, routeBottom, routeTop, layoutTop } = {}) {
    const bottom = Math.min(finite(viewportHeight), finite(routeBottom));
    const top = Math.max(finite(routeTop), finite(layoutTop));
    return Math.max(0, Math.floor(bottom - top - 8));
  }
  const api = Object.freeze({ calculateCheckoutSpace });
  if (root) root.PdvCheckoutLayoutMetrics = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
