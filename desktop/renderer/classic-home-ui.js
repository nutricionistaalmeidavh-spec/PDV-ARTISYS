'use strict';

(() => {
  const content = document.getElementById('route-content');
  const brandButton = document.querySelector('.brand-mark');
  const ui = window.PdvUiModel;
  const roleModel = window.PdvHomeRoleModel;
  if (!content || !brandButton || !ui?.HOME_TILES || !roleModel?.homeForRole) return;

  const symbols = {
    checkout:'🛒', customers:'👥', sellers:'●', products:'◇', inventory:'▦', cash:'▤',
    finance:'$', reports:'▥', sales:'◷', returns:'↩', management:'↗', team:'👥',
    devices:'⌁', fiscal:'✓', backup:'↻', modules:'+'
  };
  let scheduled = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[char]);
  }

  function iconMarkup(name, size = 46) {
    const paths = {
      cart:'<path d="M3 4h2l2 11h10l3-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
      box:'<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7v10l8 4 8-4V7M12 11v10"/>',
      users:'<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 0 0-8M23 21v-2a4 4 0 0 0-3-3.9"/>',
      user:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      cubes:'<path d="m12 2 5 3-5 3-5-3zM7 10l5 3-5 3-5-3zM17 10l5 3-5 3-5-3z"/><path d="M12 8v5M7 16v5M17 16v5"/>',
      chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/>',
      document:'<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
      cash:'<path d="M5 8h14v11H5zM8 8V5h8v3M8 12h8M9 16h6"/>',
      history:'<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v6l4 2"/>',
      return:'<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>',
      device:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 17h6"/>',
      shield:'<path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/><path d="m9 12 2 2 4-5"/>',
      database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
      modules:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
      management:'<path d="M4 20V9l8-5 8 5v11"/><path d="M8 20v-6h8v6M3 20h18M8 9h.01M12 9h.01M16 9h.01"/>'
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.document}</svg>`;
  }

  const baseHome = () => content.querySelector('.home-grid:not(#classic-home-grid)');

  function setHomeShell(active) {
    document.body.classList.toggle('home-view-classic', active);
    brandButton.classList.toggle('active', active);
    const homeNav = document.querySelector('#sidebar-nav [data-route="home"]');
    if (homeNav) homeNav.classList.toggle('active', active);
  }

  function focusSettingsTarget(selector, attempts = 24) {
    if (!selector || attempts <= 0 || document.body.dataset.activeRoute !== 'settings') return;
    const target = document.querySelector(selector);
    if (target) {
      target.scrollIntoView({ behavior:'smooth', block:'start' });
      target.classList.add('home-target-highlight');
      window.setTimeout(() => target.classList.remove('home-target-highlight'), 1600);
      return;
    }
    window.setTimeout(() => focusSettingsTarget(selector, attempts - 1), 100);
  }

  function openTile(tile, nativeHome) {
    const nativeLauncher = nativeHome.querySelector(`[data-home-route="${CSS.escape(tile.route)}"]`);
    const routeLauncher = document.querySelector(`[data-route="${CSS.escape(tile.route)}"]`);
    setHomeShell(false);
    (nativeLauncher || routeLauncher)?.click();
    if (tile.target) focusSettingsTarget(tile.target);
  }

  function tileMarkup(tile) {
    return `<button type="button" class="home-tile tone-${escapeHtml(tile.tone || 'blue')}" data-classic-route="${escapeHtml(tile.route)}" data-home-key="${escapeHtml(tile.key || tile.route)}" data-symbol="${escapeHtml(symbols[tile.key] || symbols[tile.route] || '•')}" aria-label="Abrir ${escapeHtml(tile.label)}">
      <span class="tile-icon">${iconMarkup(tile.icon, 46)}</span>
      <h3>${escapeHtml(tile.label)}</h3>
      <p>${escapeHtml(tile.description)}</p>
      ${tile.shortcut ? `<span class="shortcut-badge">${escapeHtml(tile.shortcut)}</span>` : ''}
    </button>`;
  }

  function adoptExtraLaunchers(nativeHome, canonicalHome) {
    canonicalHome.querySelector('.classic-home-extras')?.remove();
  }

  function renderCanonicalHome() {
    if (document.body.dataset.activeRoute !== 'home') {
      setHomeShell(false);
      return;
    }
    const nativeHome = baseHome();
    const existing = content.querySelector('#classic-home-grid');
    if (!nativeHome) return;
    if (existing?.dataset.homeRole === (document.body.dataset.userRole || 'cashier')) {
      adoptExtraLaunchers(nativeHome, existing);
      return;
    }
    existing?.remove();
    nativeHome.hidden = true;

    const view = roleModel.homeForRole(document.body.dataset.userRole || 'cashier', ui.HOME_TILES);
    const operatorName = document.getElementById('operator-name')?.textContent?.trim() || '';
    const canonical = document.createElement('section');
    canonical.id = 'classic-home-grid';
    canonical.className = 'classic-home-grid';
    canonical.dataset.homeRole = view.role;
    canonical.setAttribute('aria-label', `Início de ${view.label}`);
    canonical.innerHTML = `<header class="classic-home-head">
      <div><span class="classic-home-eyebrow">Início · ${escapeHtml(view.label)}</span><h1>${escapeHtml(view.title)}</h1><p>${escapeHtml(view.subtitle)}</p></div>
      ${operatorName ? `<span class="classic-home-operator">${escapeHtml(operatorName)}</span>` : ''}
    </header>${view.sections.map((section) => `<section class="classic-home-section" data-home-section="${escapeHtml(section.key)}">
      ${section.label?`<h2>${escapeHtml(section.label)}</h2>`:''}<div class="classic-home-tiles">${section.tiles.map(tileMarkup).join('')}</div>
    </section>`).join('')}`;

    canonical.querySelectorAll('[data-home-key]').forEach((button) => {
      const tile = view.sections.flatMap((section) => section.tiles).find((item) => (item.key || item.route) === button.dataset.homeKey);
      if (tile) button.addEventListener('click', () => openTile(tile, nativeHome));
    });
    adoptExtraLaunchers(nativeHome, canonical);
    content.appendChild(canonical);
    setHomeShell(true);
    content.focus({ preventScroll:true });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      renderCanonicalHome();
    });
  }

  brandButton.title = 'Início';
  brandButton.setAttribute('aria-label', 'Ir para início');
  new MutationObserver(schedule).observe(content, { childList:true, subtree:true });
  new MutationObserver(schedule).observe(document.body, { attributes:true, attributeFilter:['data-active-route','data-user-role'] });
  schedule();
})();
