'use strict';

(() => {
  const content = document.getElementById('route-content');
  const ApiClient = window.PdvApiClient?.ApiClient;
  const ui = window.PdvUiModel;
  if (!content || !ApiClient) return;

  const api = new ApiClient();
  const state = {
    productQuery:null,
    productCategory:null,
    customerQuery:null,
    productSearchFocused:false,
    productsById:new Map(),
    productsLoadedAt:0,
    loadProductsPromise:null,
    scheduled:false
  };

  const normalize = value => ui?.normalizeSearch
    ? ui.normalizeSearch(value)
    : String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();

  function productsPage() {
    const input = content.querySelector('#product-page-search');
    return input?.closest('section.page') || null;
  }

  function customersPage() {
    const input = content.querySelector('#customer-page-search');
    return input?.closest('section.page') || null;
  }

  function productList(page) {
    const card = page?.querySelector('.toolbar + .data-card') || [...(page?.querySelectorAll('.data-card') || [])].find(node => node.querySelector('[data-edit-product]')) || null;
    if (card) card.dataset.productList = '1';
    return card;
  }

  function customerList(page) {
    const card = page?.querySelector('.toolbar + .data-card') || [...(page?.querySelectorAll('.data-card') || [])].find(node => node.querySelector('[data-edit-customer]')) || null;
    if (card) card.dataset.customerList = '1';
    return card;
  }

  async function loadProducts(force=false) {
    const fresh = state.productsById.size && Date.now() - state.productsLoadedAt < 3000;
    if (!force && fresh) return state.productsById;
    if (state.loadProductsPromise) return state.loadProductsPromise;
    state.loadProductsPromise = api.products(true).then(rows => {
      state.productsById = new Map((Array.isArray(rows) ? rows : []).map(product => [String(product.id), product]));
      state.productsLoadedAt = Date.now();
      return state.productsById;
    }).catch(error => {
      console.warn('Busca estável de produtos sem metadados completos.', error?.message || error);
      return state.productsById;
    }).finally(() => { state.loadProductsPromise = null; });
    return state.loadProductsPromise;
  }

  function markRow(row, hidden) {
    row.classList.toggle('catalog-search-hidden', Boolean(hidden));
  }

  async function applyProductFilters(page=productsPage()) {
    if (!page) return;
    const input = page.querySelector('#product-page-search');
    const category = page.querySelector('#product-category-filter');
    const card = productList(page);
    if (!input || !card) return;

    if (state.productQuery === null) state.productQuery = input.value;
    if (state.productCategory === null) state.productCategory = category?.value || '';
    if (input.value !== state.productQuery) input.value = state.productQuery;
    if (category && category.value !== state.productCategory) category.value = state.productCategory;

    const map = await loadProducts(false);
    if (!page.isConnected) return;
    const query = normalize(state.productQuery);
    const categoryId = String(state.productCategory || '');
    let parentHidden = false;

    for (const row of card.querySelectorAll('.data-row')) {
      const edit = row.querySelector('[data-edit-product]');
      if (edit) {
        const product = map.get(String(edit.dataset.editProduct || '')) || null;
        const text = product
          ? `${product.name || ''} ${product.sku || ''} ${product.barcode || ''} ${product.id || ''}`
          : row.textContent || '';
        const queryMatches = !query || normalize(text).includes(query);
        const categoryMatches = !categoryId || !product || String(product.categoryId || '') === categoryId;
        parentHidden = !(queryMatches && categoryMatches);
        markRow(row, parentHidden);
      } else if (row.classList.contains('variant-child-row') || row.hasAttribute('data-product-variant-row')) {
        markRow(row, parentHidden);
      }
    }

    if (state.productSearchFocused && document.activeElement !== input) {
      input.focus({ preventScroll:true });
      const end = input.value.length;
      input.setSelectionRange?.(end,end);
    }
  }

  function applyCustomerFilter(page=customersPage()) {
    if (!page) return;
    const input = page.querySelector('#customer-page-search');
    const card = customerList(page);
    if (!input || !card) return;
    if (state.customerQuery === null) state.customerQuery = input.value;
    if (input.value !== state.customerQuery) input.value = state.customerQuery;
    const query = normalize(state.customerQuery);
    for (const row of card.querySelectorAll('.data-row')) {
      const edit = row.querySelector('[data-edit-customer]');
      if (!edit) continue;
      markRow(row, Boolean(query) && !normalize(row.textContent || '').includes(query));
    }
  }

  function decorate() {
    const productPage = productsPage();
    if (productPage) void applyProductFilters(productPage);
    const customerPage = customersPage();
    if (customerPage) applyCustomerFilter(customerPage);
  }

  function scheduleDecorate() {
    if (state.scheduled) return;
    state.scheduled = true;
    queueMicrotask(() => {
      state.scheduled = false;
      decorate();
    });
  }

  document.addEventListener('input', event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.id === 'product-page-search') {
      event.stopImmediatePropagation();
      state.productQuery = target.value;
      state.productSearchFocused = true;
      void applyProductFilters(target.closest('section.page'));
      return;
    }
    if (target.id === 'customer-page-search') {
      event.stopImmediatePropagation();
      state.customerQuery = target.value;
      applyCustomerFilter(target.closest('section.page'));
    }
  }, true);

  document.addEventListener('change', event => {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement) || target.id !== 'product-category-filter') return;
    event.stopImmediatePropagation();
    state.productCategory = target.value;
    void applyProductFilters(target.closest('section.page'));
  }, true);

  document.addEventListener('focusin', event => {
    const page = productsPage();
    if (!page) {
      state.productSearchFocused = false;
      return;
    }
    state.productSearchFocused = event.target?.id === 'product-page-search';
  }, true);

  document.addEventListener('click', event => {
    if (event.target?.closest?.('[data-product-photo-edit], [data-product-photo-remove], [data-edit-product], #new-product, #new-category, #sync-product-photos')) {
      state.productsLoadedAt = 0;
    }
  }, true);

  const observer = new MutationObserver(scheduleDecorate);
  observer.observe(content, { childList:true, subtree:true });
  scheduleDecorate();
})();
