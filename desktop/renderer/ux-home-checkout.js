'use strict';

(() => {
  const content = document.getElementById('route-content');
  const ApiClient = window.PdvApiClient?.ApiClient;
  if (!content || !ApiClient) return;

  const api = new ApiClient();
  const GROUPS = [
    { key:'primary', label:'Ações principais', routes:['checkout','cash'] },
    { key:'operation', label:'Operação', routes:['sales','returns'] },
    { key:'cadastros', label:'Cadastros', routes:['products','customers','sellers'] },
    { key:'gestao', label:'Gestão', routes:['inventory','finance','reports'] }
  ];
  let scheduled = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  }

  function formatCents(value) {
    if (window.PdvUiModel?.formatCents) return window.PdvUiModel.formatCents(value);
    return (Number(value || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }

  function relabel(button, route) {
    if (route === 'checkout') {
      button.classList.add('home-primary-action','checkout');
      button.setAttribute('aria-label','Abrir Balcão');
    } else if (route === 'cash') {
      button.classList.add('home-primary-action','cash');
      button.setAttribute('aria-label','Abrir ou consultar caixa');
    } else {
      button.classList.add('home-module-link');
    }
    return button;
  }

  function adoptExtraLaunchers(root) {
    if (!root?.isConnected) return;
    const extraHost = root.querySelector('[data-home-extra-host]');
    if (!extraHost) return;
    const launchers = [...root.querySelectorAll(':scope > .home-tile:not([data-home-route])')];
    for (const launcher of launchers) {
      launcher.classList.add('home-module-link','home-extra-module-link');
      extraHost.appendChild(launcher);
    }
    const card = extraHost.closest('.home-extra-card');
    if (card) card.hidden = extraHost.children.length === 0;
  }

  async function hydrateRecentSales(root) {
    try {
      const sales = await api.salesHistory({ limit:5 });
      if (!root.isConnected) return;
      if (!Array.isArray(sales) || !sales.length) {
        root.innerHTML = '<div class="home-recent-state">Nenhuma venda concluída ainda.</div>';
        return;
      }
      root.innerHTML = `<div class="home-recent-row home-recent-header"><span>Venda</span><span>Hora</span><span>Cliente</span><span>Vendedor</span><span>Total</span></div>${sales.slice(0,5).map((sale) => {
        const date = new Date(sale.completedAt || sale.openedAt || '');
        const time = Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
        return `<div class="home-recent-row"><strong>${escapeHtml(sale.saleNumber || sale.id)}</strong><span>${escapeHtml(time)}</span><span>${escapeHtml(sale.customerName || 'Consumidor')}</span><span>${escapeHtml(sale.sellerName || sale.operatorName || sale.sellerId || sale.operatorId || '—')}</span><strong>${formatCents(sale.totalCents || 0)}</strong></div>`;
      }).join('')}`;
    } catch (error) {
      if (root.isConnected) root.innerHTML = `<div class="home-recent-state error">Não foi possível carregar as vendas recentes: ${escapeHtml(error.message)}</div>`;
    }
  }

  function enhanceHome() {
    if (!document.body.classList.contains('theme-home')) return;
    const existingHub = content.querySelector('#home-hub[data-ux-preserved]');
    if (existingHub) {
      adoptExtraLaunchers(existingHub);
      return;
    }

    const grid = content.querySelector('.home-grid:not([data-ux-preserved])');
    if (!grid) return;
    const buttons = [...grid.querySelectorAll(':scope > [data-home-route]')];
    const extraLaunchers = [...grid.querySelectorAll(':scope > .home-tile:not([data-home-route])')];
    const byRoute = new Map(buttons.map((button) => [button.dataset.homeRoute, button]));
    const required = GROUPS.flatMap((group) => group.routes);
    if (!required.every((route) => byRoute.has(route))) return;

    const hub = document.createElement('section');
    hub.id = 'home-hub';
    hub.className = 'home-hub home-grid';
    hub.dataset.uxPreserved = 'true';
    hub.dataset.uxRevision = 'UX-HOME-CHECKOUT-2026-09-21';
    hub.innerHTML = '<header class="home-hub-head"><div><h1>Início</h1><p>Acesso rápido às tarefas mais frequentes sem esconder nenhum módulo.</p></div></header>';

    const primary = document.createElement('div');
    primary.className = 'home-primary-grid';
    for (const route of GROUPS[0].routes) primary.appendChild(relabel(byRoute.get(route), route));
    hub.appendChild(primary);

    const context = document.createElement('div');
    context.className = 'home-context-grid';
    for (const group of GROUPS.slice(1)) {
      const section = document.createElement('section');
      section.className = 'home-context-card';
      const title = document.createElement('h2');
      title.textContent = group.label;
      section.appendChild(title);
      const list = document.createElement('div');
      list.className = 'home-module-list';
      for (const route of group.routes) list.appendChild(relabel(byRoute.get(route), route));
      section.appendChild(list);
      context.appendChild(section);
    }
    hub.appendChild(context);

    const extraCard = document.createElement('section');
    extraCard.className = 'home-extra-card';
    extraCard.hidden = true;
    extraCard.innerHTML = '<h2>Módulos adicionais</h2><div class="home-extra-list" data-home-extra-host></div>';
    hub.appendChild(extraCard);
    for (const launcher of extraLaunchers) hub.appendChild(launcher);

    const recent = document.createElement('section');
    recent.className = 'home-recent-card';
    recent.innerHTML = '<div class="home-recent-head"><div><h2>Últimas vendas</h2><p>Resumo operacional; o histórico completo continua no módulo existente.</p></div><button type="button" class="secondary-button home-history-link" data-home-history>Ver histórico <kbd>F10</kbd></button></div><div id="home-recent-sales" class="home-recent-table" aria-live="polite"><div class="home-recent-state">Carregando vendas recentes…</div></div>';
    recent.querySelector('[data-home-history]')?.addEventListener('click', () => byRoute.get('sales')?.click());
    hub.appendChild(recent);

    grid.dataset.uxPreserved = 'true';
    grid.replaceWith(hub);
    adoptExtraLaunchers(hub);
    void hydrateRecentSales(hub.querySelector('#home-recent-sales'));
  }

  function enhanceCheckout() {
    const layout = content.querySelector('.checkout-layout:not([data-ux-checkout-preserved])');
    if (!layout) return;

    const main = layout.querySelector(':scope > .checkout-main');
    const panel = layout.querySelector(':scope > .sale-panel');
    if (!main || !panel) return;

    const hero = main.querySelector(':scope > .checkout-hero');
    const tools = main.querySelector(':scope > .checkout-tools');
    const categories = main.querySelector(':scope > .category-chips');
    const productGrid = main.querySelector(':scope > .product-grid');
    const actions = main.querySelector(':scope > .checkout-actions');

    const sellerBlock = panel.querySelector('#seller-select')?.closest('.customer-block');
    const customerBlock = panel.querySelector('#customer-search')?.closest('.customer-block');
    const cartHead = panel.querySelector(':scope > .cart-head');
    const cartList = panel.querySelector(':scope > .cart-list');

    if (!hero || !tools || !categories || !productGrid || !actions || !sellerBlock || !customerBlock || !cartHead || !cartList) return;

    layout.dataset.uxCheckoutPreserved = 'true';

    const productRegion = document.createElement('section');
    productRegion.className = 'checkout-product-region';
    productRegion.dataset.checkoutProductsRegion = 'true';
    productRegion.appendChild(tools);
    productRegion.appendChild(categories);
    productRegion.appendChild(productGrid);
    main.insertBefore(productRegion, actions);
    actions.classList.add('checkout-secondary-actions');

    const contextRegion = document.createElement('div');
    contextRegion.className = 'sale-context-grid';
    contextRegion.dataset.checkoutSaleContext = 'true';
    contextRegion.appendChild(sellerBlock);
    contextRegion.appendChild(customerBlock);
    panel.insertBefore(contextRegion, panel.firstChild);

    const cartRegion = document.createElement('section');
    cartRegion.className = 'sale-cart-region';
    cartRegion.dataset.checkoutCartRegion = 'true';
    cartRegion.appendChild(cartHead);
    cartRegion.appendChild(cartList);
    const totals = panel.querySelector(':scope > .totals');
    if (totals) panel.insertBefore(cartRegion, totals);
    else panel.appendChild(cartRegion);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhanceHome();
      enhanceCheckout();
    });
  }

  new MutationObserver(schedule).observe(content, { childList:true, subtree:true });
  schedule();
})();
