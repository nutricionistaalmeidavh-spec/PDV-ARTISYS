'use strict';

(() => {
  const ui = window.PdvUiModel;
  const { ApiClient } = window.PdvApiClient;
  const api = new ApiClient();

  const ROUTES = {
    home: { label: 'Início', icon: 'home' },
    checkout: { label: 'Balcão', icon: 'cart' },
    products: { label: 'Produtos', icon: 'box' },
    customers: { label: 'Clientes', icon: 'users' },
    inventory: { label: 'Estoque', icon: 'cubes', phase: 'E13' },
    finance: { label: 'Financeiro', icon: 'chart', phase: 'E16' },
    reports: { label: 'Relatórios', icon: 'document', phase: 'E17' },
    sellers: { label: 'Vendedores', icon: 'user' },
    cash: { label: 'Caixa', icon: 'cash', phase: 'E14' },
    sales: { label: 'Últimas vendas', icon: 'history', phase: 'E15' },
    returns: { label: 'Devolução', icon: 'return', phase: 'E15' },
    settings: { label: 'Configurações', icon: 'settings', phase: 'E23' }
  };

  const state = {
    route: 'home',
    config: null,
    user: null,
    online: false,
    products: [],
    categories: [],
    customers: [],
    users: [],
    sellers: [],
    sale: null,
    cashSession: null,
    suspendedSales: [],
    selectedProductId: null,
    productQuery: '',
    categoryId: '',
    customerQuery: '',
    discountPercent: 0,
    paymentDraft: [],
    selectedSellerId: '',
    photoSyncStatus: null
  };

  const content = document.getElementById('route-content');
  const modalRoot = document.getElementById('modal-root');
  const authOverlay = document.getElementById('auth-overlay');
  const toastRoot = document.getElementById('toast-root');

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function icon(name, size = 22) {
    const paths = {
      home: '<path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
      cart: '<path d="M3 4h2l2 11h10l3-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
      box: '<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7v10l8 4 8-4V7M12 11v10"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 0 0-8M23 21v-2a4 4 0 0 0-3-3.9"/>',
      user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      cubes: '<path d="m12 2 5 3-5 3-5-3zM7 10l5 3-5 3-5-3zM17 10l5 3-5 3-5-3z"/><path d="M12 8v5M7 16v5M17 16v5"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/>',
      document: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
      cash: '<path d="M5 8h14v11H5zM8 8V5h8v3M8 12h8M9 16h6"/>',
      history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v6l4 2"/>',
      return: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.5 1a7 7 0 0 0-1.7-1L14.4 3h-4.8L9.3 6a7 7 0 0 0-1.7 1L5 6 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.6-1a7 7 0 0 0 1.7 1l.3 3h4.8l.3-3a7 7 0 0 0 1.7-1l2.6 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1z"/>',
      store: '<path d="M4 10v11h16V10M3 10l2-6h14l2 6M8 21v-6h8v6"/>',
      terminal: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4"/>'
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.document}</svg>`;
  }

  function hydrateStaticIcons() {
    document.querySelectorAll('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
  }

  function centsFromInput(value) {
    const normalized = String(value ?? '').trim().replace(/\./g, '').replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  }

  function quantityLabel(value) {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }

  function roleLabel(role) {
    return ({ admin: 'Administrador', manager: 'Gerente', cashier: 'Operador' })[role] || role || '';
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function showToast(message, type = '') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastRoot.appendChild(toast);
    setTimeout(() => toast.remove(), 3500);
  }

  function setOnline(ok) {
    state.online = Boolean(ok);
    const status = document.getElementById('network-status');
    const footer = document.getElementById('footer-status');
    status?.classList.toggle('offline', !state.online);
    footer?.classList.toggle('offline', !state.online);
    if (status) status.querySelector('span').textContent = state.online ? 'Rede Local' : 'Servidor indisponível';
  }

  function openModal(title, bodyHtml, { wide = false, onMount } = {}) {
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML = `<section class="modal-card ${wide ? 'modal-wide' : ''}"><header class="modal-head"><h2>${escapeHtml(title)}</h2><button class="modal-close" type="button" data-close-modal>×</button></header><div class="modal-body">${bodyHtml}</div></section>`;
    modalRoot.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
    modalRoot.addEventListener('click', modalBackdropClose, { once: true });
    if (onMount) onMount(modalRoot);
  }

  function modalBackdropClose(event) { if (event.target === modalRoot) closeModal(); }
  function closeModal() { modalRoot.classList.add('hidden'); modalRoot.innerHTML = ''; }
  function formValue(form, name) { return form.elements.namedItem(name)?.value ?? ''; }

  function renderSidebar() {
    const nav = document.getElementById('sidebar-nav');
    const items = ['home','checkout','products','customers','inventory','finance','reports'];
    nav.innerHTML = items.map((route) => `<button class="nav-button ${state.route === route ? 'active' : ''}" type="button" data-route="${route}" title="${ROUTES[route].label}" aria-label="${ROUTES[route].label}">${icon(ROUTES[route].icon, 25)}</button>`).join('');
    document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.route)));
  }

  function updateTopbar() {
    if (!state.config) return;
    document.getElementById('store-name').textContent = state.config.storeName;
    document.getElementById('terminal-name').textContent = state.config.terminalName;
    document.getElementById('app-version').textContent = `Versão ${state.config.version}`;
    document.getElementById('operator-name').textContent = state.user?.name || 'Sem operador';
    document.getElementById('operator-role').textContent = roleLabel(state.user?.role);
  }

  function updateClock() {
    const now = new Date();
    const el = document.getElementById('clock');
    if (!el) return;
    const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    el.textContent = `${time}\n${date}`;
  }

  async function loadCommonData() {
    const [categories, products, customers, sellers] = await Promise.all([api.categories(), api.products(), api.customers(), api.sellers()]);
    state.categories = categories; state.products = products; state.customers = customers; state.sellers = sellers;
    try { state.photoSyncStatus = await api.syncProductPhotos(false); monitorProductPhotoSync(); } catch (error) { state.photoSyncStatus={failed:1,lastError:error.message}; }
    if (!state.selectedSellerId || !sellers.some((seller) => seller.id === state.selectedSellerId)) state.selectedSellerId = sellers.find((seller) => seller.id === state.user?.id)?.id || sellers[0]?.id || '';
    if (['admin','manager'].includes(state.user?.role)) {
      try { state.users = await api.users(true); } catch { state.users = []; }
    }
    try { state.cashSession = await api.openCash(state.config.terminalId); } catch { state.cashSession = null; }
  }

  async function restoreCheckoutState() {
    const [openSales, suspended] = await Promise.all([api.sales('OPEN', 20), api.sales('SUSPENDED', 30)]);
    state.suspendedSales = suspended;
    state.sale = openSales.find((sale) => sale.terminalId === state.config.terminalId && sale.operatorId === state.user.id) || null;
    if (state.sale?.sellerId) state.selectedSellerId = state.sale.sellerId;
    state.discountPercent = state.sale?.subtotalCents ? Number(((state.sale.discountCents / state.sale.subtotalCents) * 100).toFixed(2)) : 0;
  }

  async function navigate(route) {
    if (!ROUTES[route]) route = 'home';
    state.route = route;
    document.body.classList.toggle('theme-home', route === 'home');
    renderSidebar();
    if (route === 'checkout') {
      try { await restoreCheckoutState(); } catch (error) { showToast(error.message, 'error'); }
    }
    renderRoute(); content.focus({ preventScroll: true });
  }

  function renderRoute() {
    if (state.route === 'home') return renderHome();
    if (state.route === 'checkout') return renderCheckout();
    if (state.route === 'customers') return renderCustomers();
    if (state.route === 'sellers') return renderSellers();
    if (state.route === 'products') return renderProducts();
    return renderPlaceholder(state.route);
  }

  function renderHome() {
    const symbols = { checkout: '🛒', customers: '👥', sellers: '●', products: '◇', inventory: '▦', cash: '▤', finance: '$', reports: '▥', sales: '◷', returns: '↩' };
    content.innerHTML = `<section class="home-grid">${ui.HOME_TILES.map((tile) => `<button type="button" class="home-tile tone-${tile.tone}" data-home-route="${tile.route}" data-symbol="${symbols[tile.key] || '•'}"><span class="tile-icon">${icon(tile.icon, 50)}</span><h2>${escapeHtml(tile.label)}</h2><p>${escapeHtml(tile.description)}</p><span class="shortcut-badge">${tile.shortcut}</span></button>`).join('')}</section>`;
    content.querySelectorAll('[data-home-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.homeRoute)));
  }

  function renderPlaceholder(route) {
    const meta = ROUTES[route];
    content.innerHTML = `<section class="page"><header class="page-head"><div><h1>${escapeHtml(meta.label)}</h1><p>Módulo previsto para ${escapeHtml(meta.phase || 'próxima entrega')}.</p></div></header><div class="data-card"><div class="empty-state"><div style="font-size:42px;margin-bottom:14px">${icon(meta.icon, 48)}</div><strong>${escapeHtml(meta.label)}</strong><p>O atalho e a navegação já fazem parte da UI definitiva. A regra operacional será incorporada na etapa ${escapeHtml(meta.phase || 'seguinte')} sem criar funcionalidade simulada.</p></div></div></section>`;
  }

  function selectedCustomer() { return state.customers.find((customer) => customer.id === state.sale?.customerId) || null; }

  function renderCheckout() {
    const products = ui.filterProducts(state.products, state.productQuery, state.categoryId);
    const customer = selectedCustomer(); const sale = state.sale;
    content.innerHTML = `<section class="checkout-layout"><div class="checkout-main"><div class="checkout-hero"><div><h1>Balcão</h1><p>Venda rápida e prática para o seu cliente</p></div><em>Agilidade no atendimento,<br>mais vendas todos os dias.</em></div><div class="checkout-tools"><label class="search-field">${icon('document')}<input id="product-search" autocomplete="off" placeholder="Buscar produto por nome, código ou código de barras..." value="${escapeHtml(state.productQuery)}"><span>▥</span></label><button id="scan-focus" class="scan-button" type="button">▥ &nbsp; Ler código (F2)</button></div><div class="category-chips"><button class="category-chip ${!state.categoryId ? 'active' : ''}" data-category="">Todos</button>${state.categories.map((category) => `<button class="category-chip ${state.categoryId === category.id ? 'active' : ''}" data-category="${category.id}">${escapeHtml(category.name)}</button>`).join('')}</div><div class="product-grid">${products.map((product) => productCard(product)).join('') || '<div class="empty-state">Nenhum produto encontrado.</div>'}</div><div class="checkout-actions"><h3>Ações da venda</h3><div class="action-grid"><button class="action-button" id="new-sale" type="button">▶ &nbsp; Iniciar venda <small>F1</small></button><button class="action-button orange" id="remove-item" type="button">⌫ &nbsp; Cancelar item <small>F3</small></button><button class="action-button red" id="cancel-sale" type="button">⊗ &nbsp; Cancelar venda <small>F4</small></button><button class="action-button blue" id="suspend-sale" type="button">Ⅱ &nbsp; Suspender <small>F6</small></button></div></div></div><aside class="sale-panel"><div class="customer-block"><h3>Cliente <small style="color:#9aa6bb;font-weight:400">(opcional)</small></h3><label class="search-field">⌕<input id="customer-search" autocomplete="off" placeholder="Buscar cliente por nome, CPF ou código..." value="${escapeHtml(state.customerQuery)}"></label><div id="customer-suggestions"></div>${customer ? `<div class="customer-selected"><span class="avatar">${escapeHtml(initials(customer.name))}</span><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.document || 'Sem documento')}</small></div><button id="remove-customer" type="button">×</button></div>` : ''}</div><div class="cart-head"><h3>Itens da venda (${sale?.items?.length || 0})</h3><button id="clear-cart" class="secondary-button" type="button">Limpar carrinho</button></div><div class="cart-list">${sale?.items?.map((item) => cartLine(item)).join('') || '<div class="empty-state">Nenhum item na venda.</div>'}</div><div class="totals"><div class="total-row"><span>Subtotal</span><strong>${ui.formatCents(sale?.subtotalCents || 0)}</strong></div><div class="total-row"><span>Desconto</span><div class="discount-control"><span>%</span><input id="discount-percent" type="number" min="0" max="100" step="0.01" value="${state.discountPercent || 0}"><strong>${ui.formatCents(sale?.discountCents || 0)}</strong></div></div><div class="total-row grand-total"><span>Total da venda</span><strong>${ui.formatCents(sale?.totalCents || 0)}</strong></div></div><div class="payment-strip"><button class="pay-button" data-pay="cash">Dinheiro</button><button class="pay-button card" data-pay="card">Cartão</button><button class="pay-button pix" data-pay="pix">PIX</button><button class="pay-button tef" data-pay="tef">TEF</button></div><button class="finalize-button" id="finalize-sale" type="button">Finalizar venda (F12) &nbsp; ›</button></aside></section>`;
    content.querySelector('.sale-panel')?.insertAdjacentHTML('afterbegin', `<div class="customer-block"><h3>Vendedor / Garçom</h3><select id="seller-select" class="secondary-button" style="width:100%">${state.sellers.map((seller) => `<option value="${seller.id}" ${seller.id === (sale?.sellerId || state.selectedSellerId) ? 'selected' : ''}>${escapeHtml(seller.name)}</option>`).join('')}</select></div>`);
    hydrateProductPhotos();
    bindCheckoutEvents();
  }

  function productCard(product) {
    const visual=product.photo?`<img data-product-photo="${product.id}" alt="Foto de ${escapeHtml(product.name)}"><span class="photo-placeholder">${escapeHtml(initials(product.name))}</span>`:`<span>${escapeHtml(initials(product.name))}</span>`;
    return `<button type="button" class="product-card" data-add-product="${product.id}"><div><div class="product-visual">${visual}</div><h3>${escapeHtml(product.name)}</h3><small>Cód. ${escapeHtml(product.sku || product.barcode || product.id.slice(0, 8))}</small></div><strong>${ui.formatCents(product.salePriceCents)}<span class="add-cart">＋</span></strong></button>`;
  }

  function hydrateProductPhotos() {
    content.querySelectorAll('[data-product-photo]').forEach(async image => { try { const source=await api.productPhotoDataUrl(image.dataset.productPhoto);if(source){image.src=source;image.addEventListener('load',()=>image.parentElement?.classList.add('has-photo'),{once:true});} } catch {} });
  }

  function cartLine(item) {
    const changed = item.catalogUnitPriceCents != null && item.catalogUnitPriceCents !== item.unitPriceCents;
    const priceDetails = changed ? `<small><s>${ui.formatCents(item.catalogUnitPriceCents)}</s> → ${ui.formatCents(item.unitPriceCents)}${item.priceOverrideReason ? ` · ${escapeHtml(item.priceOverrideReason)}` : ''}</small>` : `<small>${ui.formatCents(item.unitPriceCents)}</small>`;
    const priceButton = ['admin','manager'].includes(state.user?.role) ? `<button type="button" class="secondary-button" data-price-item="${item.id}" style="padding:4px 7px;margin-top:4px">Alterar preço</button>` : '';
    return `<div class="cart-line ${state.selectedProductId === item.productId ? 'selected' : ''}" data-select-product="${item.productId}"><div><strong>${escapeHtml(item.productName)}</strong>${priceDetails}${priceButton}</div><div class="qty-control"><button type="button" data-qty-minus="${item.productId}">−</button><span>${quantityLabel(item.quantity)}</span><button type="button" data-qty-plus="${item.productId}">＋</button></div><div class="line-total">${ui.formatCents(item.totalCents)} <button type="button" data-remove="${item.productId}" style="border:0;background:transparent;color:#e22;font-size:18px">×</button></div></div>`;
  }

  function bindCheckoutEvents() {
    const search = document.getElementById('product-search');
    search?.addEventListener('input', () => { state.productQuery = search.value; renderCheckout(); document.getElementById('product-search')?.focus(); });
    document.getElementById('scan-focus')?.addEventListener('click', () => document.getElementById('product-search')?.focus());
    content.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => { state.categoryId = button.dataset.category; renderCheckout(); }));
    content.querySelectorAll('[data-add-product]').forEach((button) => button.addEventListener('click', () => addProduct(button.dataset.addProduct)));
    content.querySelectorAll('[data-select-product]').forEach((line) => line.addEventListener('click', (event) => { if (event.target.closest('button')) return; state.selectedProductId = line.dataset.selectProduct; renderCheckout(); }));
    content.querySelectorAll('[data-qty-minus]').forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.qtyMinus, -1)));
    content.querySelectorAll('[data-qty-plus]').forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.qtyPlus, 1)));
    content.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => removeProduct(button.dataset.remove)));
    content.querySelectorAll('[data-price-item]').forEach((button) => button.addEventListener('click', () => openPriceOverride(button.dataset.priceItem)));
    document.getElementById('seller-select')?.addEventListener('change', setSelectedSeller);
    document.getElementById('new-sale')?.addEventListener('click', newSale);
    document.getElementById('remove-item')?.addEventListener('click', () => state.selectedProductId ? removeProduct(state.selectedProductId) : showToast('Selecione um item.', 'error'));
    document.getElementById('cancel-sale')?.addEventListener('click', cancelCurrentSale);
    document.getElementById('suspend-sale')?.addEventListener('click', suspendCurrentSale);
    document.getElementById('clear-cart')?.addEventListener('click', clearCart);
    document.getElementById('discount-percent')?.addEventListener('change', applyDiscountFromInput);
    document.getElementById('customer-search')?.addEventListener('input', customerSearchInput);
    document.getElementById('remove-customer')?.addEventListener('click', () => setCustomer(null));
    content.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => openPaymentModal(button.dataset.pay)));
    document.getElementById('finalize-sale')?.addEventListener('click', () => openPaymentModal());
  }

  async function ensureSale() {
    if (state.sale?.status === 'OPEN') return state.sale;
    const saleNumber = `${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${Date.now().toString().slice(-6)}`;
    state.sale = await api.openSale({ saleNumber, terminalId: state.config.terminalId, sellerId: state.selectedSellerId || state.user.id }); state.discountPercent = 0; return state.sale;
  }

  async function setSelectedSeller(event) {
    state.selectedSellerId = event.target.value;
    if (!state.sale) return;
    try { state.sale = await api.setSaleSeller(state.sale.id, state.selectedSellerId); renderCheckout(); }
    catch (error) { showToast(error.message, 'error'); renderCheckout(); }
  }

  function openPriceOverride(itemId) {
    const item = state.sale?.items.find((entry) => entry.id === itemId); if (!item) return;
    openModal('Alterar preço do item', `<form id="price-override-form"><div class="field"><label>Novo preço *</label><input name="unitPrice" inputmode="decimal" required value="${(item.unitPriceCents / 100).toFixed(2).replace('.', ',')}"></div><div class="field"><label>Justificativa *</label><textarea name="reason" rows="3" required minlength="3" placeholder="Informe o motivo da alteração"></textarea></div><p>O preço original será preservado no histórico. Esta ação exige perfil de gerente ou administrador.</p><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Aplicar preço</button></div></form>`, { onMount(root) { root.querySelector('#price-override-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { state.sale = await api.overrideSaleItemPrice(state.sale.id, itemId, { unitPriceCents: centsFromInput(formValue(form, 'unitPrice')), reason: formValue(form, 'reason') }); closeModal(); renderCheckout(); showToast('Preço alterado e registrado na auditoria.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  async function newSale() {
    try {
      if (state.sale?.status === 'OPEN' && state.sale.items.length) return showToast('Finalize, suspenda ou cancele a venda atual antes de iniciar outra.', 'error');
      if (state.sale?.status === 'OPEN') return showToast('Venda já iniciada.');
      await ensureSale(); renderCheckout(); document.getElementById('product-search')?.focus();
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function addProduct(productId) {
    try { const sale = await ensureSale(); state.sale = await api.addSaleItem(sale.id, productId, 1); state.selectedProductId = productId; renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function changeQuantity(productId, delta) {
    const item = state.sale?.items.find((entry) => entry.productId === productId); if (!item) return;
    const next = Number((item.quantity + delta).toFixed(3)); if (next <= 0) return removeProduct(productId);
    try { state.sale = await api.updateSaleItem(state.sale.id, productId, next); renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function removeProduct(productId) {
    if (!state.sale) return;
    try { state.sale = await api.removeSaleItem(state.sale.id, productId); if (state.selectedProductId === productId) state.selectedProductId = null; renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function clearCart() {
    if (!state.sale?.items?.length) return;
    try { for (const item of [...state.sale.items]) state.sale = await api.removeSaleItem(state.sale.id, item.productId); state.selectedProductId = null; renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function applyDiscountFromInput() {
    if (!state.sale) return;
    const percent = Number(document.getElementById('discount-percent')?.value || 0); const discountCents = ui.percentageToDiscountCents(state.sale.subtotalCents, percent);
    try { state.sale = await api.discountSale(state.sale.id, discountCents); state.discountPercent = Math.min(Math.max(percent, 0), 100); renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  function customerSearchInput(event) { state.customerQuery = event.target.value; renderCustomerSuggestions(); }
  function renderCustomerSuggestions() {
    const root = document.getElementById('customer-suggestions'); if (!root) return;
    const needle = ui.normalizeSearch(state.customerQuery); if (!needle) { root.innerHTML = ''; return; }
    const matches = state.customers.filter((customer) => ui.normalizeSearch(`${customer.name} ${customer.document || ''} ${customer.id}`).includes(needle)).slice(0, 5);
    root.innerHTML = matches.map((customer) => `<button type="button" class="customer-selected" data-customer-id="${customer.id}" style="width:100%;border:0;text-align:left"><span class="avatar">${escapeHtml(initials(customer.name))}</span><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.document || '')}</small></div></button>`).join('');
    root.querySelectorAll('[data-customer-id]').forEach((button) => button.addEventListener('click', () => setCustomer(button.dataset.customerId)));
  }

  async function setCustomer(customerId) {
    try { const sale = await ensureSale(); state.sale = await api.setSaleCustomer(sale.id, customerId); state.customerQuery = ''; renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function cancelCurrentSale() {
    if (!state.sale || !['OPEN','SUSPENDED'].includes(state.sale.status)) return showToast('Não há venda aberta para cancelar.', 'error');
    openModal('Cancelar venda', `<p>Informe o motivo do cancelamento da venda atual.</p><div class="field"><label>Motivo</label><input id="cancel-reason" value="Cliente desistiu"></div><div class="modal-actions"><button class="secondary-button" data-close-modal>Voltar</button><button class="danger-button" id="confirm-cancel">Cancelar venda</button></div>`, { onMount(root) { root.querySelector('#confirm-cancel')?.addEventListener('click', async () => { try { await api.cancelSale(state.sale.id, root.querySelector('#cancel-reason').value); state.sale = null; state.selectedProductId = null; closeModal(); renderCheckout(); showToast('Venda cancelada.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  async function suspendCurrentSale() {
    if (!state.sale?.items?.length) return showToast('Adicione itens antes de suspender.', 'error');
    try { await api.suspendSale(state.sale.id); state.sale = null; state.selectedProductId = null; state.suspendedSales = await api.sales('SUSPENDED', 30); renderCheckout(); showSuspendedModal(); } catch (error) { showToast(error.message, 'error'); }
  }

  function showSuspendedModal() {
    openModal('Vendas suspensas', `<div class="suspended-list">${state.suspendedSales.map((sale) => `<div class="suspended-item"><div><strong>${escapeHtml(sale.saleNumber)}</strong><small>${sale.items.length} itens · ${ui.formatCents(sale.totalCents)}</small></div><button class="primary-button" data-resume="${sale.id}">Retomar</button></div>`).join('') || '<div class="empty-state">Nenhuma venda suspensa.</div>'}</div>`, { onMount(root) { root.querySelectorAll('[data-resume]').forEach((button) => button.addEventListener('click', async () => { try { state.sale = await api.resumeSale(button.dataset.resume); state.discountPercent = state.sale.subtotalCents ? Number(((state.sale.discountCents / state.sale.subtotalCents) * 100).toFixed(2)) : 0; closeModal(); renderCheckout(); } catch (error) { showToast(error.message, 'error'); } })); } });
  }

  async function ensureCashOpen() {
    try { state.cashSession = await api.openCash(state.config.terminalId); } catch { state.cashSession = null; }
    if (state.cashSession) return true;
    return new Promise((resolve) => {
      openModal('Abrir caixa', `<p>É necessário abrir o caixa antes de finalizar a venda.</p><div class="field"><label>Fundo de caixa</label><input id="initial-cash" inputmode="decimal" value="0,00"></div><div class="modal-actions"><button class="secondary-button" id="cancel-open-cash">Cancelar</button><button class="primary-button" id="confirm-open-cash">Abrir caixa</button></div>`, { onMount(root) { root.querySelector('#cancel-open-cash').addEventListener('click', () => { closeModal(); resolve(false); }); root.querySelector('#confirm-open-cash').addEventListener('click', async () => { try { const result = await api.createCash({ terminalId: state.config.terminalId, initialCashCents: centsFromInput(root.querySelector('#initial-cash').value) }); state.cashSession = result.session; closeModal(); resolve(true); } catch (error) { showToast(error.message, 'error'); } }); } });
    });
  }

  async function openPaymentModal(preferredMethod = '') {
    if (!state.sale?.items?.length) return showToast('Adicione itens antes de finalizar.', 'error');
    if (!(await ensureCashOpen())) return;
    const method = preferredMethod ? ui.paymentMethodFromUi(preferredMethod) : 'CASH'; state.paymentDraft = [{ method, amountCents: state.sale.totalCents }]; renderPaymentModal();
  }

  function renderPaymentModal() {
    const paid = state.paymentDraft.reduce((sum, payment) => sum + payment.amountCents, 0); const remaining = Math.max((state.sale?.totalCents || 0) - paid, 0);
    openModal('Pagamento da venda', `<div class="total-row grand-total"><span>Total</span><strong>${ui.formatCents(state.sale.totalCents)}</strong></div><div class="payment-list">${state.paymentDraft.map((payment, index) => `<div class="payment-line"><strong>${escapeHtml(paymentLabel(payment.method))}</strong><span>${ui.formatCents(payment.amountCents)}</span><button class="danger-button" data-remove-payment="${index}">×</button></div>`).join('')}</div><div class="total-row"><span>Restante</span><strong>${ui.formatCents(remaining)}</strong></div><div class="payment-add"><div class="field"><label>Forma</label><select id="new-payment-method"><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="DEBIT_CARD">Cartão débito</option><option value="CREDIT_CARD">Cartão crédito / TEF</option><option value="STORE_CREDIT">A prazo</option></select></div><div class="field"><label>Valor</label><input id="new-payment-value" inputmode="decimal" value="${(remaining / 100).toFixed(2).replace('.', ',')}"></div><button class="secondary-button" id="add-payment">Adicionar</button></div><div class="modal-actions"><button class="secondary-button" data-close-modal>Voltar</button><button class="primary-button" id="confirm-payment">Concluir venda</button></div>`, { wide: true, onMount(root) { root.querySelectorAll('[data-remove-payment]').forEach((button) => button.addEventListener('click', () => { state.paymentDraft.splice(Number(button.dataset.removePayment), 1); renderPaymentModal(); })); root.querySelector('#add-payment').addEventListener('click', () => { const amountCents = centsFromInput(root.querySelector('#new-payment-value').value); if (amountCents <= 0) return showToast('Informe um valor maior que zero.', 'error'); state.paymentDraft.push({ method: root.querySelector('#new-payment-method').value, amountCents }); renderPaymentModal(); }); root.querySelector('#confirm-payment').addEventListener('click', completeCurrentSale); } });
  }

  function paymentLabel(method) { return ({ CASH: 'Dinheiro', PIX: 'PIX', DEBIT_CARD: 'Cartão débito', CREDIT_CARD: 'Cartão crédito / TEF', STORE_CREDIT: 'A prazo', OTHER: 'Outro' })[method] || method; }

  async function completeCurrentSale() {
    try { const result = await api.completeSale(state.sale.id, state.paymentDraft); const completed = result.sale; closeModal(); state.sale = null; state.selectedProductId = null; state.discountPercent = 0; state.paymentDraft = []; state.products = await api.products(); showToast(`Venda ${completed.saleNumber} finalizada. Troco: ${ui.formatCents(completed.changeCents)}`, 'success'); renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  function renderCustomers() {
    const query = ui.normalizeSearch(state.customerQuery); const customers = state.customers.filter((customer) => !query || ui.normalizeSearch(`${customer.name} ${customer.document || ''} ${customer.phone || ''}`).includes(query));
    content.innerHTML = `<section class="page"><header class="page-head"><div><h1>Clientes</h1><p>Cadastro, consulta e limite de crédito.</p></div><button class="primary-button" id="new-customer">＋ Novo cliente</button></header><div class="toolbar"><label class="search-field">⌕<input id="customer-page-search" placeholder="Buscar por nome, CPF/CNPJ ou telefone" value="${escapeHtml(state.customerQuery)}"></label></div><div class="data-card">${customers.map((customer) => `<div class="data-row"><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.document || 'Sem documento')}</small></div><div><small>Telefone</small><strong>${escapeHtml(customer.phone || '—')}</strong></div><div><small>Limite</small><strong>${ui.formatCents(customer.creditLimitCents)}</strong></div><button class="secondary-button" data-edit-customer="${customer.id}">Editar</button></div>`).join('') || '<div class="empty-state">Nenhum cliente cadastrado.</div>'}</div></section>`;
    document.getElementById('new-customer')?.addEventListener('click', () => openCustomerForm());
    document.getElementById('customer-page-search')?.addEventListener('input', (event) => { state.customerQuery = event.target.value; renderCustomers(); document.getElementById('customer-page-search')?.focus(); });
    content.querySelectorAll('[data-edit-customer]').forEach((button) => button.addEventListener('click', () => openCustomerForm(state.customers.find((customer) => customer.id === button.dataset.editCustomer))));
  }

  function openCustomerForm(customer = null) {
    openModal(customer ? 'Editar cliente' : 'Novo cliente', `<form id="customer-form"><div class="field-grid"><div class="field wide"><label>Nome completo *</label><input name="name" required value="${escapeHtml(customer?.name || '')}"></div><div class="field"><label>CPF / CNPJ</label><input name="document" value="${escapeHtml(customer?.document || '')}"></div><div class="field"><label>Telefone</label><input name="phone" value="${escapeHtml(customer?.phone || '')}"></div><div class="field"><label>E-mail</label><input name="email" type="email" value="${escapeHtml(customer?.email || '')}"></div><div class="field"><label>Limite de crédito</label><input name="creditLimit" inputmode="decimal" value="${((customer?.creditLimitCents || 0)/100).toFixed(2).replace('.', ',')}"></div><div class="field wide"><label>Observações</label><textarea name="notes" rows="3">${escapeHtml(customer?.notes || '')}</textarea></div><label class="field wide"><span><input name="active" type="checkbox" ${customer?.active === false ? '' : 'checked'}> Cliente ativo</span></label></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Salvar cliente</button></div></form>`, { onMount(root) { root.querySelector('#customer-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const saved = await api.saveCustomer({ id: customer?.id, name: formValue(form,'name'), document: formValue(form,'document'), phone: formValue(form,'phone'), email: formValue(form,'email'), notes: formValue(form,'notes'), creditLimitCents: centsFromInput(formValue(form,'creditLimit')), creditUsedCents: customer?.creditUsedCents || 0, active: form.elements.namedItem('active').checked }); const index = state.customers.findIndex((item) => item.id === saved.id); if (index >= 0) state.customers[index] = saved; else state.customers.push(saved); state.customers.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR')); closeModal(); renderCustomers(); showToast('Cliente salvo.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  function renderSellers() {
    if (!['admin','manager'].includes(state.user?.role)) return renderPermissionDenied('Vendedores');
    const sellers = state.users.filter((user) => ['cashier','manager'].includes(user.role));
    content.innerHTML = `<section class="page"><header class="page-head"><div><h1>Vendedores</h1><p>Operadores, gerentes e permissões de acesso.</p></div><button class="primary-button" id="new-seller">＋ Novo vendedor</button></header><div class="data-card">${sellers.map((user) => `<div class="data-row"><div><strong>${escapeHtml(user.name)}</strong><small>@${escapeHtml(user.username)}</small></div><div><small>Perfil</small><strong>${escapeHtml(roleLabel(user.role))}</strong></div><div><small>Status</small><strong>${user.active ? 'Ativo' : 'Inativo'}</strong></div><button class="secondary-button" data-edit-seller="${user.id}">Editar</button></div>`).join('') || '<div class="empty-state">Nenhum vendedor cadastrado.</div>'}</div></section>`;
    document.getElementById('new-seller')?.addEventListener('click', () => openSellerForm());
    content.querySelectorAll('[data-edit-seller]').forEach((button) => button.addEventListener('click', () => openSellerForm(state.users.find((user) => user.id === button.dataset.editSeller))));
  }

  function renderPermissionDenied(title) { content.innerHTML = `<section class="page"><header class="page-head"><div><h1>${escapeHtml(title)}</h1><p>Acesso restrito.</p></div></header><div class="data-card"><div class="empty-state">Seu perfil não possui permissão para gerenciar este cadastro.</div></div></section>`; }

  function openSellerForm(user = null) {
    openModal(user ? 'Editar vendedor' : 'Novo vendedor', `<form id="seller-form"><div class="field-grid"><div class="field wide"><label>Nome *</label><input name="name" required value="${escapeHtml(user?.name || '')}"></div><div class="field"><label>Usuário *</label><input name="username" required value="${escapeHtml(user?.username || '')}"></div><div class="field"><label>Perfil</label><select name="role"><option value="cashier" ${user?.role === 'cashier' ? 'selected' : ''}>Operador</option><option value="manager" ${user?.role === 'manager' ? 'selected' : ''}>Gerente</option></select></div><div class="field wide"><label>${user ? 'Nova senha (deixe em branco para manter)' : 'Senha *'}</label><input name="password" type="password" ${user ? '' : 'required'} minlength="10"></div><label class="field wide"><span><input name="active" type="checkbox" ${user?.active === false ? '' : 'checked'}> Usuário ativo</span></label></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Salvar vendedor</button></div></form>`, { onMount(root) { root.querySelector('#seller-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const saved = await api.saveUser({ id: user?.id, name: formValue(form,'name'), username: formValue(form,'username'), role: formValue(form,'role'), password: formValue(form,'password'), active: form.elements.namedItem('active').checked }); const index = state.users.findIndex((item) => item.id === saved.id); if (index >= 0) state.users[index] = saved; else state.users.push(saved); closeModal(); renderSellers(); showToast('Vendedor salvo.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  function renderProducts() {
    const products = ui.filterProducts(state.products, state.productQuery, state.categoryId);
    const sync=state.photoSyncStatus||{};const syncLabel=sync.running?`Sincronizando · ${sync.pending||0} pendentes`:sync.failed?`${sync.failed} falha(s) · tentar novamente`:sync.lastCompletedAt?`Última sincronização ${new Date(sync.lastCompletedAt).toLocaleString('pt-BR')}`:'Fotos ainda não sincronizadas';
    content.innerHTML = `<section class="page"><header class="page-head"><div><h1>Produtos</h1><p>Catálogo, preços, fotos, custo, margem e estoque mínimo.</p></div><div style="display:flex;gap:8px"><button class="secondary-button" id="sync-product-photos">↻ Sincronizar fotos agora</button><button class="secondary-button" id="new-category">＋ Categoria</button><button class="primary-button" id="new-product">＋ Novo produto</button></div></header><div class="toolbar"><label class="search-field">⌕<input id="product-page-search" placeholder="Buscar por nome, SKU ou código de barras" value="${escapeHtml(state.productQuery)}"></label><select id="product-category-filter" class="secondary-button"><option value="">Todas categorias</option>${state.categories.map((category) => `<option value="${category.id}" ${state.categoryId === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select><small>${escapeHtml(syncLabel)}</small></div><div class="data-card">${products.map((product) => `<div class="data-row"><div><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.sku || 'Sem SKU')} · ${escapeHtml(product.categoryName || 'Sem categoria')}</small></div><div><small>Preço / custo</small><strong>${ui.formatCents(product.salePriceCents)} / ${ui.formatCents(product.costCents)}</strong></div><div><small>Estoque</small><strong>${quantityLabel(product.stockQuantity)} ${escapeHtml(product.unit)}</strong></div><div style="display:flex;gap:6px"><button class="secondary-button" data-product-photo-edit="${product.id}">${product.photo?'Trocar foto':'Adicionar foto'}</button>${product.photo?`<button class="secondary-button" data-product-photo-remove="${product.id}">Remover foto</button>`:''}<button class="secondary-button" data-edit-product="${product.id}">Editar</button></div></div>`).join('') || '<div class="empty-state">Nenhum produto cadastrado.</div>'}</div></section>`;
    document.getElementById('new-product')?.addEventListener('click', () => openProductForm()); document.getElementById('new-category')?.addEventListener('click', openCategoryForm);
    document.getElementById('product-page-search')?.addEventListener('input', (event) => { state.productQuery = event.target.value; renderProducts(); document.getElementById('product-page-search')?.focus(); });
    document.getElementById('product-category-filter')?.addEventListener('change', (event) => { state.categoryId = event.target.value; renderProducts(); });
    document.getElementById('sync-product-photos')?.addEventListener('click',()=>syncProductPhotos(true));
    content.querySelectorAll('[data-product-photo-edit]').forEach(button=>button.addEventListener('click',()=>uploadProductPhoto(button.dataset.productPhotoEdit)));
    content.querySelectorAll('[data-product-photo-remove]').forEach(button=>button.addEventListener('click',()=>removeProductPhoto(button.dataset.productPhotoRemove)));
    content.querySelectorAll('[data-edit-product]').forEach((button) => button.addEventListener('click', () => openProductForm(state.products.find((product) => product.id === button.dataset.editProduct))));
  }

  function monitorProductPhotoSync(){setTimeout(async()=>{try{state.photoSyncStatus=await api.productPhotoSyncStatus();if(state.route==='products')renderProducts();if(state.route==='checkout')hydrateProductPhotos();if(state.photoSyncStatus.running)monitorProductPhotoSync();}catch{}},1000);}
  async function syncProductPhotos(force=false){try{state.photoSyncStatus=await api.syncProductPhotos(force);renderProducts();showToast('Sincronização de fotos iniciada em segundo plano.','success');monitorProductPhotoSync();}catch(error){showToast(error.message,'error');}}
  async function uploadProductPhoto(productId){try{const saved=await api.uploadProductPhoto(productId);if(!saved)return;state.products=await api.products();renderProducts();showToast('Foto e miniatura salvas no computador principal.','success');}catch(error){showToast(error.message,'error');}}
  async function removeProductPhoto(productId){if(!confirm('Remover a foto deste produto? O arquivo ficará protegido por 30 dias.'))return;try{await api.removeProductPhoto(productId);state.products=await api.products();renderProducts();showToast('Foto removida com período de segurança de 30 dias.','success');}catch(error){showToast(error.message,'error');}}

  function openCategoryForm() {
    openModal('Nova categoria', `<form id="category-form"><div class="field"><label>Nome *</label><input name="name" required></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Salvar categoria</button></div></form>`, { onMount(root) { root.querySelector('#category-form').addEventListener('submit', async (event) => { event.preventDefault(); try { const saved = await api.saveCategory({ name: formValue(event.currentTarget,'name') }); state.categories.push(saved); state.categories.sort((a,b) => a.name.localeCompare(b.name,'pt-BR')); closeModal(); renderProducts(); showToast('Categoria criada.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  function openProductForm(product = null) {
    openModal(product ? 'Editar produto' : 'Novo produto', `<form id="product-form"><div class="field-grid"><div class="field wide"><label>Nome *</label><input name="name" required value="${escapeHtml(product?.name || '')}"></div><div class="field"><label>SKU / código</label><input name="sku" value="${escapeHtml(product?.sku || '')}"></div><div class="field"><label>Código de barras</label><input name="barcode" value="${escapeHtml(product?.barcode || '')}"></div><div class="field"><label>Categoria</label><select name="categoryId"><option value="">Sem categoria</option>${state.categories.map((category) => `<option value="${category.id}" ${product?.categoryId === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></div><div class="field"><label>Unidade</label><select name="unit"><option value="UN" ${product?.unit === 'UN' ? 'selected' : ''}>UN</option><option value="KG" ${product?.unit === 'KG' ? 'selected' : ''}>KG</option><option value="LT" ${product?.unit === 'LT' ? 'selected' : ''}>LT</option><option value="CX" ${product?.unit === 'CX' ? 'selected' : ''}>CX</option></select></div><div class="field"><label>Preço de venda</label><input id="product-price" name="salePrice" inputmode="decimal" value="${((product?.salePriceCents || 0)/100).toFixed(2).replace('.', ',')}"></div><div class="field"><label>Custo</label><input id="product-cost" name="cost" inputmode="decimal" value="${((product?.costCents || 0)/100).toFixed(2).replace('.', ',')}"></div><div class="field"><label>Margem</label><input id="product-margin" readonly value="${ui.calculateMarginPercent(product?.salePriceCents || 0, product?.costCents || 0).toFixed(2)}%"></div><div class="field"><label>Estoque mínimo</label><input name="minimumStock" type="number" min="0" step="0.001" value="${product?.minimumStock || 0}"></div><label class="field"><span><input name="trackStock" type="checkbox" ${product?.trackStock === false ? '' : 'checked'}> Controlar estoque</span></label><label class="field"><span><input name="active" type="checkbox" ${product?.active === false ? '' : 'checked'}> Produto ativo</span></label></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Salvar produto</button></div></form>`, { wide: true, onMount(root) { const updateMargin = () => { root.querySelector('#product-margin').value = `${ui.calculateMarginPercent(centsFromInput(root.querySelector('#product-price').value), centsFromInput(root.querySelector('#product-cost').value)).toFixed(2)}%`; }; root.querySelector('#product-price').addEventListener('input', updateMargin); root.querySelector('#product-cost').addEventListener('input', updateMargin); root.querySelector('#product-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const saved = await api.saveProduct({ id: product?.id, name: formValue(form,'name'), sku: formValue(form,'sku'), barcode: formValue(form,'barcode'), categoryId: formValue(form,'categoryId'), unit: formValue(form,'unit'), salePriceCents: centsFromInput(formValue(form,'salePrice')), costCents: centsFromInput(formValue(form,'cost')), minimumStock: Number(formValue(form,'minimumStock') || 0), trackStock: form.elements.namedItem('trackStock').checked, active: form.elements.namedItem('active').checked }); const index = state.products.findIndex((item) => item.id === saved.id); if (index >= 0) state.products[index] = saved; else state.products.push(saved); state.products.sort((a,b) => a.name.localeCompare(b.name,'pt-BR')); closeModal(); renderProducts(); showToast('Produto salvo.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  function showSetup() {
    authOverlay.classList.remove('hidden');
    authOverlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Configurar ArtiSys PDV</h1><p>Crie o primeiro administrador desta instalação local.</p><form id="setup-form"><div class="field"><label>Nome</label><input name="name" required value="Administrador"></div><div class="field"><label>Usuário</label><input name="username" required value="admin"></div><div class="field"><label>Senha</label><input name="password" type="password" minlength="10" required></div><button class="primary-button" type="submit">Criar administrador</button></form></section>`;
    authOverlay.querySelector('#setup-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api.setupAdmin({ name: formValue(form,'name'), username: formValue(form,'username'), password: formValue(form,'password') }); showLogin('Administrador criado. Entre com seus dados.'); } catch (error) { showToast(error.message, 'error'); } });
  }

  function showLogin(message = '') {
    authOverlay.classList.remove('hidden');
    authOverlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>ArtiSys PDV</h1><p>${escapeHtml(message || 'Entre para iniciar a operação local.')}</p><form id="login-form"><div class="field"><label>Usuário</label><input name="username" autocomplete="username" required></div><div class="field"><label>Senha</label><input name="password" type="password" autocomplete="current-password" required></div><button class="primary-button" type="submit">Entrar</button></form></section>`;
    authOverlay.querySelector('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const login = await api.login({ username: formValue(form,'username'), password: formValue(form,'password'), terminalId: state.config.terminalId }); state.user = login.user; updateTopbar(); await loadCommonData(); await navigate('home'); authOverlay.classList.add('hidden'); authOverlay.innerHTML = ''; } catch (error) { showToast(error.message, 'error'); } });
  }

  async function restorePersistedSession() {
    if (!api.sessionToken) return false;
    try {
      const session = await api.currentSession();
      state.user = session.user;
      updateTopbar();
      await loadCommonData();
      await navigate('home');
      authOverlay.classList.add('hidden');
      authOverlay.innerHTML = '';
      return true;
    } catch (error) {
      if (error.status === 401) {
        api.logout();
        return false;
      }
      throw error;
    }
  }

  function logout() { api.logout(); state.user = null; state.sale = null; updateTopbar(); showLogin(); }

  async function executeShortcut(action) {
    if (!action || !state.user) return;
    if (action.type === 'navigate') return navigate(action.route);
    if (action.type === 'checkout.new-sale') return newSale();
    if (action.type === 'checkout.focus-scan') return document.getElementById('product-search')?.focus();
    if (action.type === 'checkout.remove-selected') return state.selectedProductId ? removeProduct(state.selectedProductId) : showToast('Selecione um item.', 'error');
    if (action.type === 'checkout.cancel-sale') return cancelCurrentSale();
    if (action.type === 'checkout.suspend-sale') return suspendCurrentSale();
    if (action.type === 'checkout.finalize') return openPaymentModal();
  }

  function bindGlobalEvents() {
    document.querySelectorAll('[data-window]').forEach((button) => button.addEventListener('click', () => window.artisysDesktop.window[button.dataset.window]?.()));
    document.getElementById('operator-button').addEventListener('click', () => { if (!state.user) return; openModal('Operador', `<div style="text-align:center;padding:12px"><div class="auth-logo" style="margin:0 auto 12px">${escapeHtml(initials(state.user.name))}</div><h3>${escapeHtml(state.user.name)}</h3><p>${escapeHtml(roleLabel(state.user.role))}</p><button id="logout-button" class="danger-button">Sair desta sessão</button></div>`, { onMount(root) { root.querySelector('#logout-button').addEventListener('click', () => { closeModal(); logout(); }); } }); });
    document.addEventListener('keydown', (event) => { if (!/^F\d+$/.test(event.key)) return; const action = ui.resolveShortcut(event.key, state.route); if (action) { event.preventDefault(); void executeShortcut(action); } });
  }

  async function boot() {
    hydrateStaticIcons(); bindGlobalEvents(); updateClock(); setInterval(updateClock, 30000);
    try {
      state.config = await api.initialize();
      updateTopbar();
      await api.health();
      setOnline(true);
      const setup = await api.setupStatus();
      renderSidebar();
      renderHome();
      if (setup.needsSetup) {
        showSetup();
        return;
      }
      const restored = await restorePersistedSession();
      if (restored) return;
      showLogin();
    } catch (error) {
      setOnline(false);
      renderSidebar();
      renderHome();
      showToast(`Falha ao iniciar servidor local: ${error.message}`, 'error');
    }
  }

  void boot();
})();