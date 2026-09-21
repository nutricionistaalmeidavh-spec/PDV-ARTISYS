'use strict';

(() => {
  const ApiClient = window.PdvApiClient?.ApiClient;
  const content = document.getElementById('route-content');
  const dense = window.PdvProductsDenseView;
  const ux = window.ArtisysUxComponents;
  if (!ApiClient || !content || !dense || !ux) return;

  const api = new ApiClient();
  let stockFilter = '';
  let scheduled = false;
  let decorating = false;
  let productsById = new Map();
  let productsLoadedAt = 0;

  const enabled = () => window.PdvFeatureFlags?.productsDenseView !== false;
  const productsPage = () => {
    const page = content.querySelector('section.page');
    return page?.querySelector('.page-head h1')?.textContent?.trim() === 'Produtos' ? page : null;
  };

  async function loadProducts(force = false) {
    if (!force && productsById.size && Date.now() - productsLoadedAt < 1500) return productsById;
    const products = await api.products(true);
    productsById = new Map((Array.isArray(products) ? products : []).map(product => [String(product.id), product]));
    productsLoadedAt = Date.now();
    return productsById;
  }

  function baseProductCard(page) {
    return page.querySelector('.toolbar + .data-card') || [...page.querySelectorAll('.data-card')].find(card => card.querySelector('[data-edit-product]')) || null;
  }

  function ensureHeader(card) {
    let header = card.querySelector('[data-products-dense-header]');
    if (header) return header;
    header = document.createElement('div');
    header.className = 'products-dense-header';
    header.dataset.productsDenseHeader = '1';
    header.innerHTML = '<span>Produto / SKU</span><span>Preço / custo</span><span>Estoque</span><span>Status</span><span>Ações</span>';
    card.prepend(header);
    return header;
  }

  function ensureToolbar(page) {
    const toolbar = page.querySelector('.toolbar');
    if (!toolbar) return;
    toolbar.classList.add('products-dense-toolbar');

    const search = page.querySelector('#product-page-search');
    const searchField = search?.closest('.search-field');
    if (searchField) {
      searchField.classList.add('products-dense-search');
      if (!searchField.querySelector('[data-products-search-shortcut]')) {
        const shortcut = document.createElement('kbd');
        shortcut.dataset.productsSearchShortcut = '1';
        shortcut.textContent = 'Ctrl+K';
        searchField.appendChild(shortcut);
      }
    }

    const category = page.querySelector('#product-category-filter');
    category?.classList.add('products-dense-filter');

    let stock = page.querySelector('#products-stock-filter');
    if (!stock) {
      stock = document.createElement('select');
      stock.id = 'products-stock-filter';
      stock.className = 'secondary-button products-dense-filter';
      stock.setAttribute('aria-label', 'Filtrar produtos por situação de estoque');
      stock.innerHTML = '<option value="">Estoque: todos</option><option value="normal">Normal</option><option value="low">Baixo</option><option value="out">Sem estoque</option><option value="uncontrolled">Sem controle</option>';
      stock.value = stockFilter;
      stock.addEventListener('change', event => {
        stockFilter = event.currentTarget.value;
        const currentPage = productsPage();
        if (currentPage) void decorateProducts(currentPage, { forceProducts:false });
      });
      if (category) category.insertAdjacentElement('afterend', stock);
      else toolbar.appendChild(stock);
    } else if (stock.value !== stockFilter) stock.value = stockFilter;

    const sync = toolbar.querySelector('small');
    sync?.classList.add('products-dense-sync');
  }

  function ensureStatusCell(row, status) {
    let cell = row.querySelector('[data-dense-status-cell]');
    if (!cell) {
      cell = document.createElement('div');
      cell.className = 'products-dense-status-cell';
      cell.dataset.denseStatusCell = '1';
      const actions = row.lastElementChild;
      if (actions) row.insertBefore(cell, actions);
      else row.appendChild(cell);
    }
    const signature = `${status.key}:${status.label}:${status.tone}`;
    if (cell.dataset.statusSignature !== signature) {
      cell.dataset.statusSignature = signature;
      cell.innerHTML = ux.StatusBadge(status);
    }
  }

  function decorateBaseRow(row, product) {
    const title = row.children[0];
    const stock = row.children[2];
    if (title) {
      title.dataset.productTitle = '1';
      title.classList.add('products-dense-product-cell');
    }
    if (stock) {
      stock.dataset.productStockCell = '1';
      stock.classList.add('products-dense-stock-cell');
    }
    row.classList.add('products-dense-row');
    row.dataset.denseProductId = String(product.id);
    const status = dense.productStatus(product);
    row.dataset.denseStockStatus = status.key;
    ensureStatusCell(row, status);
  }

  function applyStockFilter(card, visibleProducts) {
    const allowed = new Set(dense.filterByStock(visibleProducts, stockFilter).map(product => String(product.id)));
    let visibleCount = 0;
    let parentHidden = false;

    for (const row of card.querySelectorAll('.data-row')) {
      const edit = row.querySelector('[data-edit-product]');
      if (edit) {
        parentHidden = Boolean(stockFilter) && !allowed.has(String(edit.dataset.editProduct));
        row.hidden = parentHidden;
        if (!parentHidden) visibleCount += 1;
      } else if (row.classList.contains('variant-child-row')) {
        row.hidden = parentHidden;
      }
    }

    card.querySelector('[data-products-filter-empty]')?.remove();
    if (stockFilter && visibleCount === 0) {
      const empty = document.createElement('div');
      empty.dataset.productsFilterEmpty = '1';
      empty.innerHTML = ux.EmptyState({
        title:'Nenhum produto neste filtro de estoque',
        description:'Selecione outra situação de estoque ou limpe o filtro.'
      });
      card.appendChild(empty);
    }
  }

  function restoreLegacy(page) {
    page.removeAttribute('data-products-view');
    page.classList.remove('products-dense-page');
    page.querySelector('[data-products-dense-header]')?.remove();
    page.querySelector('#products-stock-filter')?.remove();
    page.querySelector('[data-products-search-shortcut]')?.remove();
    page.querySelector('[data-products-filter-empty]')?.remove();
    page.querySelector('.toolbar')?.classList.remove('products-dense-toolbar');
    page.querySelector('.search-field')?.classList.remove('products-dense-search');
    page.querySelector('#product-category-filter')?.classList.remove('products-dense-filter');
    page.querySelectorAll('[data-dense-status-cell]').forEach(node => node.remove());
    page.querySelectorAll('.products-dense-row').forEach(row => {
      row.classList.remove('products-dense-row');
      row.hidden = false;
      delete row.dataset.denseProductId;
      delete row.dataset.denseStockStatus;
      row.children[0]?.removeAttribute('data-product-title');
      row.children[2]?.removeAttribute('data-product-stock-cell');
    });
    baseProductCard(page)?.classList.remove('products-dense-table');
  }

  async function decorateProducts(page = productsPage(), { forceProducts = false } = {}) {
    if (!page || decorating) return;
    if (!enabled()) {
      restoreLegacy(page);
      return;
    }

    decorating = true;
    try {
      page.dataset.productsView = 'dense';
      page.classList.add('products-dense-page');
      ensureToolbar(page);
      const card = baseProductCard(page);
      if (!card) return;
      card.classList.add('products-dense-table');
      ensureHeader(card);

      const map = await loadProducts(forceProducts);
      if (!page.isConnected || !enabled()) return;
      const visibleProducts = [];
      for (const row of card.querySelectorAll('.data-row')) {
        const edit = row.querySelector('[data-edit-product]');
        if (!edit) continue;
        const product = map.get(String(edit.dataset.editProduct));
        if (!product) continue;
        visibleProducts.push(product);
        decorateBaseRow(row, product);
      }
      applyStockFilter(card, visibleProducts);
    } catch (error) {
      console.warn('Produtos densos indisponíveis; mantendo UI legada.', error?.message || error);
    } finally {
      decorating = false;
    }
  }

  function scheduleDecorate({ forceProducts = false } = {}) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const page = productsPage();
      if (page) void decorateProducts(page, { forceProducts });
    }, 0);
  }

  document.addEventListener('keydown', event => {
    if (!enabled()) return;
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    const page = productsPage();
    if (!page) return;
    const search = page.querySelector('#product-page-search');
    if (!search) return;
    event.preventDefault();
    search.focus();
    search.select?.();
  });

  document.addEventListener('click', event => {
    if (!enabled()) return;
    if (event.target.closest('[data-product-photo-edit], [data-product-photo-remove], [data-edit-product], #new-product, #new-category, #sync-product-photos')) {
      productsLoadedAt = 0;
    }
  }, true);

  const observer = new MutationObserver(() => scheduleDecorate());
  observer.observe(content, { childList:true, subtree:true });
  scheduleDecorate({ forceProducts:true });
})();
