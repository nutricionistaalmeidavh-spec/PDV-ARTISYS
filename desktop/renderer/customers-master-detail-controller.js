'use strict';

(() => {
  const ApiClient = window.PdvApiClient?.ApiClient;
  const content = document.getElementById('route-content');
  const PdvCustomersMasterDetail = window.PdvCustomersMasterDetail;
  const ArtisysUxComponents = window.ArtisysUxComponents;
  const ui = window.PdvUiModel;
  if (!ApiClient || !content || !PdvCustomersMasterDetail || !ArtisysUxComponents) return;

  const api = new ApiClient();
  let selectedCustomerId = '';
  let historyOpen = false;
  let customersById = new Map();
  let sales = [];
  let customersLoadedAt = 0;
  let salesLoadedAt = 0;
  let scheduled = false;
  let decorating = false;

  const enabled = () => !window.PdvFeatureFlags || window.PdvFeatureFlags.customersMasterDetailView !== false;
  const customersPage = () => {
    const page = content.querySelector('section.page');
    return page?.querySelector('.page-head h1')?.textContent?.trim() === 'Clientes' ? page : null;
  };
  const money = cents => ui?.formatCents ? ui.formatCents(Number(cents || 0)) : (Number(cents || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const when = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
  };

  async function loadData(force = false) {
    const now = Date.now();
    const needCustomers = force || !customersById.size || now - customersLoadedAt >= 1500;
    const needSales = force || now - salesLoadedAt >= 1500;
    const [customerResult, salesResult] = await Promise.all([
      needCustomers ? api.customers(true).then(value => ({ ok:true, value })).catch(error => ({ ok:false, error })) : Promise.resolve({ ok:true, value:[...customersById.values()] }),
      needSales ? api.sales('COMPLETED', 200).then(value => ({ ok:true, value })).catch(error => ({ ok:false, error })) : Promise.resolve({ ok:true, value:sales })
    ]);

    if (customerResult.ok) {
      const list = Array.isArray(customerResult.value) ? customerResult.value : [];
      customersById = new Map(list.map(customer => [String(customer.id), customer]));
      customersLoadedAt = now;
    } else if (!customersById.size) throw customerResult.error;

    if (salesResult.ok) {
      sales = Array.isArray(salesResult.value) ? salesResult.value : [];
      salesLoadedAt = now;
    } else if (!salesLoadedAt) {
      sales = [];
      salesLoadedAt = now;
    }
  }

  function baseCustomerCard(page) {
    return page.querySelector('.toolbar + .data-card') || [...page.querySelectorAll('.data-card')].find(card => card.querySelector('[data-edit-customer]')) || null;
  }

  function ensureToolbar(page) {
    const toolbar = page.querySelector('.toolbar');
    if (!toolbar) return;
    toolbar.classList.add('customers-master-toolbar');
    const search = page.querySelector('#customer-page-search');
    const field = search?.closest('.search-field');
    if (!field) return;
    field.classList.add('customers-master-search');
    if (!field.querySelector('[data-customers-search-shortcut]')) {
      const shortcut = document.createElement('kbd');
      shortcut.dataset.customersSearchShortcut = '1';
      shortcut.textContent = 'Ctrl+K';
      field.appendChild(shortcut);
    }
  }

  function ensureHeader(card) {
    let header = card.querySelector('[data-customers-master-header]');
    if (header) return header;
    header = document.createElement('div');
    header.className = 'customers-master-header';
    header.dataset.customersMasterHeader = '1';
    header.innerHTML = '<span>Cliente</span><span>Telefone</span><span>Crédito</span><span>Última compra</span><span>Ações</span>';
    card.prepend(header);
    return header;
  }

  function ensureLayout(page, card) {
    let layout = page.querySelector('[data-customers-master-layout]');
    if (!layout) {
      layout = document.createElement('div');
      layout.className = 'customers-master-layout';
      layout.dataset.customersMasterLayout = '1';
      card.parentNode.insertBefore(layout, card);
      layout.appendChild(card);
    }
    card.classList.add('customers-master-list');
    let panel = layout.querySelector('[data-customers-master-panel]');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'customers-master-panel';
      panel.dataset.customersMasterPanel = '1';
      layout.appendChild(panel);
    }
    return panel;
  }

  function ensureLastSaleCell(row, latestSale) {
    let cell = row.querySelector('[data-customer-last-sale]');
    if (!cell) {
      cell = document.createElement('div');
      cell.className = 'customers-master-last-sale';
      cell.dataset.customerLastSale = '1';
      const edit = row.querySelector('[data-edit-customer]');
      if (edit) row.insertBefore(cell, edit);
      else row.appendChild(cell);
    }
    const signature = latestSale ? `${latestSale.id}:${latestSale.completedAt || latestSale.openedAt || ''}:${latestSale.totalCents || 0}` : 'none';
    if (cell.dataset.saleSignature !== signature) {
      cell.dataset.saleSignature = signature;
      cell.innerHTML = latestSale
        ? `<small>${when(latestSale.completedAt || latestSale.openedAt)}</small><strong>${money(latestSale.totalCents || 0)}</strong>`
        : '<small>Sem compras</small><strong>—</strong>';
    }
  }

  function ensureCreditMeta(row, customer) {
    const creditCell = row.children[2];
    if (!creditCell) return;
    creditCell.classList.add('customers-master-credit');
    const credit = PdvCustomersMasterDetail.creditSnapshot(customer);
    let meta = creditCell.querySelector('[data-customer-credit-available]');
    if (!meta) {
      meta = document.createElement('small');
      meta.dataset.customerCreditAvailable = '1';
      creditCell.appendChild(meta);
    }
    const text = `Disponível ${money(credit.availableCents)}`;
    if (meta.textContent !== text) meta.textContent = text;
  }

  function decorateRows(card) {
    const visibleIds = [];
    for (const row of card.querySelectorAll('.data-row')) {
      const edit = row.querySelector('[data-edit-customer]');
      if (!edit) continue;
      const id = String(edit.dataset.editCustomer || '');
      const customer = customersById.get(id);
      if (!customer) continue;
      visibleIds.push(id);
      row.classList.add('customers-master-row');
      row.dataset.customerMasterRow = '1';
      row.dataset.customerId = id;
      row.tabIndex = 0;
      const customerSales = PdvCustomersMasterDetail.salesForCustomer(sales, id);
      ensureCreditMeta(row, customer);
      ensureLastSaleCell(row, customerSales[0] || null);
    }

    if (!visibleIds.includes(selectedCustomerId)) {
      selectedCustomerId = visibleIds[0] || '';
      historyOpen = false;
    }
    for (const row of card.querySelectorAll('[data-customer-master-row]')) {
      row.setAttribute('aria-selected', String(row.dataset.customerId === selectedCustomerId));
    }
    return visibleIds;
  }

  function renderPanel(page) {
    const panel = page.querySelector('[data-customers-master-panel]');
    if (!panel) return;
    const customer = customersById.get(String(selectedCustomerId)) || null;
    const customerSales = customer ? PdvCustomersMasterDetail.salesForCustomer(sales, customer.id) : [];
    const latest = customerSales[0] || null;
    const signature = customer
      ? `${customer.id}:${customer.updatedAt || ''}:${customer.creditLimitCents || 0}:${customer.creditUsedCents || 0}:${latest?.id || ''}:${latest?.completedAt || latest?.openedAt || ''}:${historyOpen}`
      : `empty:${historyOpen}`;
    if (panel.dataset.renderSignature === signature) return;
    panel.dataset.renderSignature = signature;
    panel.innerHTML = PdvCustomersMasterDetail.renderCustomerDetail({
      customer,
      sales,
      components:ArtisysUxComponents,
      formatCents:money,
      formatDate:when,
      historyOpen
    });
  }

  function selectCustomer(page, id) {
    const normalized = String(id || '');
    if (!normalized || normalized === selectedCustomerId) return;
    selectedCustomerId = normalized;
    historyOpen = false;
    for (const row of page.querySelectorAll('[data-customer-master-row]')) row.setAttribute('aria-selected', String(row.dataset.customerId === normalized));
    const panel = page.querySelector('[data-customers-master-panel]');
    if (panel) delete panel.dataset.renderSignature;
    renderPanel(page);
  }

  function restoreLegacy(page) {
    page.removeAttribute('data-customers-view');
    page.classList.remove('customers-master-page');
    page.querySelector('[data-customers-master-header]')?.remove();
    page.querySelector('[data-customers-search-shortcut]')?.remove();
    page.querySelector('.toolbar')?.classList.remove('customers-master-toolbar');
    page.querySelector('.search-field')?.classList.remove('customers-master-search');
    const card = baseCustomerCard(page);
    card?.querySelectorAll('[data-customer-last-sale]').forEach(node => node.remove());
    card?.querySelectorAll('[data-customer-credit-available]').forEach(node => node.remove());
    card?.querySelectorAll('.customers-master-credit').forEach(node => node.classList.remove('customers-master-credit'));
    card?.querySelectorAll('[data-customer-master-row]').forEach(row => {
      row.classList.remove('customers-master-row');
      row.removeAttribute('data-customer-master-row');
      row.removeAttribute('data-customer-id');
      row.removeAttribute('aria-selected');
      row.removeAttribute('tabindex');
    });
    card?.classList.remove('customers-master-list');
    const layout = page.querySelector('[data-customers-master-layout]');
    if (layout && card) {
      layout.parentNode.insertBefore(card, layout);
      layout.remove();
    } else layout?.remove();
  }

  async function decorateCustomers(page = customersPage(), { forceData = false } = {}) {
    if (!page || decorating) return;
    if (!enabled()) {
      restoreLegacy(page);
      return;
    }

    decorating = true;
    try {
      page.dataset.customersView = 'master-detail';
      page.classList.add('customers-master-page');
      ensureToolbar(page);
      const card = baseCustomerCard(page);
      if (!card) return;
      ensureHeader(card);
      ensureLayout(page, card);
      await loadData(forceData);
      if (!page.isConnected || !enabled()) return;
      decorateRows(card);
      renderPanel(page);
    } catch (error) {
      console.warn('Master-detail de Clientes indisponível; mantendo UI legada.', error?.message || error);
    } finally {
      decorating = false;
    }
  }

  function scheduleDecorate({ forceData = false } = {}) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const page = customersPage();
      if (page) void decorateCustomers(page, { forceData });
    }, 0);
  }

  document.addEventListener('keydown', event => {
    if (!enabled()) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    const page = customersPage();
    if (!page) return;
    const search = page.querySelector('#customer-page-search');
    if (!search) return;
    event.preventDefault();
    search.focus();
    search.select?.();
  });

  document.addEventListener('click', event => {
    if (!enabled()) return;
    const page = customersPage();
    if (!page) return;

    const row = event.target.closest('[data-customer-master-row]');
    if (row) selectCustomer(page, row.dataset.customerId);

    const panelAction = event.target.closest('[data-customers-master-panel] [data-action]');
    if (panelAction?.dataset.action === 'edit-customer') {
      const id = String(panelAction.dataset.entityId || selectedCustomerId || '');
      const originalEdit = [...page.querySelectorAll('[data-edit-customer]')].find(button => String(button.dataset.editCustomer) === id);
      customersLoadedAt = 0;
      originalEdit?.click();
      return;
    }
    if (panelAction?.dataset.action === 'customer-history') {
      historyOpen = !historyOpen;
      const panel = page.querySelector('[data-customers-master-panel]');
      if (panel) delete panel.dataset.renderSignature;
      renderPanel(page);
      return;
    }

    if (event.target.closest('[data-edit-customer], #new-customer')) customersLoadedAt = 0;
  }, true);

  document.addEventListener('keydown', event => {
    if (!enabled() || !['Enter', ' '].includes(event.key)) return;
    const row = event.target.closest?.('[data-customer-master-row]');
    if (!row || event.target.closest('button, input, select, textarea, a')) return;
    event.preventDefault();
    const page = customersPage();
    if (page) selectCustomer(page, row.dataset.customerId);
  });

  const observer = new MutationObserver(() => scheduleDecorate());
  observer.observe(content, { childList:true, subtree:true });
  scheduleDecorate({ forceData:true });
})();
