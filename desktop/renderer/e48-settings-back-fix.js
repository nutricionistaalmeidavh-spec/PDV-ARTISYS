'use strict';

(() => {
  window.addEventListener('click', event => {
    const button = event.target.closest?.('#e48-back');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.PdvOperationalUi?.showRoute?.('settings');
  }, true);
})();
