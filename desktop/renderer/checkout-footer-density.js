'use strict';

// Optional, reversible CSS-only density preference for the Balcão footer.
// The original #208 layout is untouched and is restored immediately when
// the operator selects "Altura normal". Never replace payment or sale nodes.
(() => {
  const lifecycle = window.PdvUiLifecycle;
  const routeContent = document.getElementById('route-content');
  if (!lifecycle?.on || !routeContent) return;

  const STORAGE_KEY = 'artisys.checkout.footerDensity.v1';
  let scheduled = false;
  let fallbackMode = 'compact';

  function readMode() {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'normal' ? 'normal' : 'compact';
    } catch {
      return fallbackMode;
    }
  }

  function saveMode(mode) {
    fallbackMode = mode;
    try { localStorage.setItem(STORAGE_KEY, mode); } catch {
      // Protected kiosk profiles may disable storage: switching still works
      // until the window closes.
    }
  }

  function update(footer, toggle, mode) {
    footer.dataset.footerDensity = mode;
    const compact = mode === 'compact';
    toggle.setAttribute('aria-pressed', String(compact));
    toggle.setAttribute('aria-label', compact
      ? 'Restaurar altura anterior do rodapé'
      : 'Usar rodapé compacto');
    toggle.title = compact
      ? 'Voltar ao rodapé anterior'
      : 'Compactar o rodapé';
    toggle.textContent = compact ? 'Altura normal' : 'Compactar';
  }

  function enhance() {
    if (document.body.dataset.activeRoute !== 'checkout') return;
    const footer = routeContent.querySelector('.checkout-clarity-footer');
    if (!footer) return;

    let toggle = footer.querySelector('.checkout-density-toggle');
    if (!toggle) {
      const header = footer.querySelector('.checkout-adjustments .checkout-section-header');
      if (!header) return;
      // "Opcionais" is already indicated by the two optional action buttons.
      // Use the same header row rather than adding another row to the footer.
      header.querySelector('small')?.remove();
      toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'checkout-density-toggle';
      header.append(toggle);
      toggle.addEventListener('click', () => {
        const mode = footer.dataset.footerDensity === 'compact' ? 'normal' : 'compact';
        saveMode(mode);
        update(footer, toggle, mode);
      });
    }
    update(footer, toggle, readMode());
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhance();
    });
  }

  // Registered after the #208 extension so the live grouped footer exists.
  lifecycle.on('route:mounted', ({route}) => { if (route === 'checkout') schedule(); });
  lifecycle.on('route:updated', ({route}) => { if (route === 'checkout') schedule(); });
  if (document.body.dataset.activeRoute === 'checkout') schedule();
})();
