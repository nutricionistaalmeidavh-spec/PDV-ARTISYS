'use strict';

(() => {
  const existing = window.PdvFeatureFlags && typeof window.PdvFeatureFlags === 'object'
    ? window.PdvFeatureFlags
    : {};

  window.PdvFeatureFlags = {
    productsDenseView: true,
    customersMasterDetailView: true,
    ...existing
  };
})();
