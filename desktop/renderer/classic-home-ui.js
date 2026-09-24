'use strict';

(() => {
  const content = document.getElementById('route-content');
  const brandButton = document.querySelector('.brand-mark');
  const ui = window.PdvUiModel;
  if (!content || !brandButton || !ui?.HOME_TILES) return;

  const symbols = {
    checkout: '🛒', customers: '👥', sellers: '●', products: '◇', inventory: '▦',
    cash: '▤', finance: '$', reports: '▥', sales: '◷', returns: '↩'
  };

  let classicActive = false;
  let activationQueued = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function iconMarkup(name, size = 50) {
    const paths = {
      cart: '<path d="M3 4h2l2 11h10l3-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
      box: '<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7v10l8 4 8-4V7M12 11v10"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 0 0-8M23 21v-2a4 4 0 0 0-3-3.9"/>',
      user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      cubes: '<path d="m12 2 5 3-5 3-5-3zM7 10l5 3-5 3-5-3zM17 10l5 3-5 3-5-3z"/><path d="M12 8v5M7 16v5M17 16v5"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/>',
      document: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
      cash: '<path d="M5 8h14v11H5zM8 8V5h8v3M8 12h8M9 16h6"/>',
      history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v6l4 2"/>',
      return: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>'
    };
    const path = paths[name] || paths.document;
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
  }

  function currentOperationalHome() {
    return content.querySelector('#home-hub[data-ux-preserved], .home-grid[data-ux-preserved]');
  }

  function setClassicShell(active) {
    classicActive = active;
    document.body.classList.toggle('home-view-classic', active);
    brandButton.classList.toggle('active', active);
    brandButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    const homeNav = document.querySelector('#sidebar-nav [data-route="home"]');
    if (homeNav) homeNav.classList.toggle('active', !active && document.body.dataset.activeRoute === 'home');
  }

  function renderClassicHome() {
    const operationalHome = currentOperationalHome();
    if (!operationalHome || document.body.dataset.activeRoute !== 'home') return false;

    content.querySelector('#classic-home-grid')?.remove();
    operationalHome.hidden = true;

    const classic = document.createElement('section');
    classic.id = 'classic-home-grid';
    classic.className = 'classic-home-grid home-grid';
    classic.setAttribute('aria-label', 'Painel de módulos');
    classic.innerHTML = ui.HOME_TILES.map((tile) => `
      <button type="button" class="home-tile tone-${escapeHtml(tile.tone)}" data-classic-route="${escapeHtml(tile.route)}" data-symbol="${escapeHtml(symbols[tile.key] || '•')}" aria-label="Abrir ${escapeHtml(tile.label)}">
        <span class="tile-icon">${iconMarkup(tile.icon, 50)}</span>
        <h2>${escapeHtml(tile.label)}</h2>
        <p>${escapeHtml(tile.description)}</p>
        <span class="shortcut-badge">${escapeHtml(tile.shortcut)}</span>
      </button>`).join('');

    classic.querySelectorAll('[data-classic-route]').forEach((button) => {
      button.addEventListener('click', () => {
        const route = button.dataset.classicRoute;
        const nativeLauncher = operationalHome.querySelector(`[data-home-route="${CSS.escape(route)}"]`);
        if (nativeLauncher) nativeLauncher.click();
      });
    });

    content.appendChild(classic);
    setClassicShell(true);
    content.focus({ preventScroll: true });
    return true;
  }

  function queueClassicActivation() {
    if (activationQueued) return;
    activationQueued = true;
    queueMicrotask(() => {
      activationQueued = false;
      if (renderClassicHome()) return;
      requestAnimationFrame(() => { renderClassicHome(); });
    });
  }

  function openClassicHome() {
    const homeNav = document.querySelector('#sidebar-nav [data-route="home"]');
    if (document.body.dataset.activeRoute !== 'home') homeNav?.click();
    queueClassicActivation();
  }

  brandButton.removeAttribute('data-route');
  brandButton.dataset.classicHome = 'true';
  brandButton.title = 'Painel de módulos';
  brandButton.setAttribute('aria-label', 'Painel de módulos');
  brandButton.setAttribute('aria-pressed', 'false');
  brandButton.addEventListener('click', openClassicHome);

  document.getElementById('sidebar-nav')?.addEventListener('click', (event) => {
    const homeButton = event.target.closest('[data-route="home"]');
    if (!homeButton) return;
    setClassicShell(false);
  }, true);

  new MutationObserver(() => {
    if (document.body.dataset.activeRoute !== 'home') setClassicShell(false);
  }).observe(document.body, { attributes: true, attributeFilter: ['data-active-route'] });
})();
