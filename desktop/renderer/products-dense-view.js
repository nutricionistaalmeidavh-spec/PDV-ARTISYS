'use strict';

(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PdvProductsDenseView = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  const PRODUCTS_UX_LEVEL = 2;
  const PRODUCTS_UX_GUARDS = Object.freeze({
    reversible: true,
    progressiveEnhancement: true,
    legacyHandlersPreserved: true,
    parityGuarded: true
  });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

  function productStatus(product = {}) {
    if (product.active === false) return { key:'inactive', label:'Inativo', tone:'muted' };
    if (product.trackStock === false) return { key:'uncontrolled', label:'Sem controle', tone:'info' };
    const stock = Number(product.stockQuantity || 0);
    const minimum = Math.max(Number(product.minimumStock || 0), 0);
    if (stock <= 0) return { key:'out', label:'Sem estoque', tone:'danger' };
    if (minimum > 0 && stock <= minimum) return { key:'low', label:'Baixo', tone:'warning' };
    return { key:'normal', label:'Normal', tone:'success' };
  }

  function filterByStock(products = [], filter = '') {
    const list = Array.isArray(products) ? products : [];
    if (!filter) return [...list];
    return list.filter(product => productStatus(product).key === filter);
  }

  function renderProductsDense(input = {}, components) {
    if (!components?.DataTable || !components?.StatusBadge || !components?.SearchField || !components?.FilterBar) {
      throw new Error('Componentes UX da ArtiSys indisponíveis para Produtos.');
    }

    const {
      products = [], categories = [], query = '', categoryId = '', stockFilter = '', syncLabel = '',
      formatCents = cents => String(cents ?? 0), quantityLabel = value => String(value ?? 0),
      calculateMarginPercent = () => 0
    } = input;

    const search = components.SearchField({
      id:'product-page-search',
      label:'Buscar produtos',
      placeholder:'Buscar nome, SKU ou código de barras...',
      value:query,
      shortcut:'Ctrl+K'
    });

    const filters = components.FilterBar({
      filters:[
        {
          id:'category',
          label:'Categoria',
          value:categoryId,
          options:[{ value:'', label:'Todas categorias' }, ...categories.map(category => ({ value:category.id, label:category.name }))]
        },
        {
          id:'stock',
          label:'Estoque',
          value:stockFilter,
          options:[
            { value:'', label:'Estoque: todos' },
            { value:'normal', label:'Normal' },
            { value:'low', label:'Baixo' },
            { value:'out', label:'Sem estoque' },
            { value:'uncontrolled', label:'Sem controle' }
          ]
        }
      ],
      activeChips:[],
      clearAction:'products.clear-filters'
    });

    const columns = [
      {
        key:'product',
        label:'Produto',
        render:product => `<div data-product-title><strong>${esc(product.name)}</strong><small>${esc(product.categoryName || 'Sem categoria')}</small></div>`
      },
      {
        key:'sku',
        label:'SKU',
        render:product => `<div class="products-dense-code"><strong>${esc(product.sku || 'Sem SKU')}</strong><small>${esc(product.barcode || 'Sem código de barras')}</small></div>`
      },
      {
        key:'price',
        label:'Preço',
        align:'end',
        render:product => {
          const margin = Number(calculateMarginPercent(product.salePriceCents || 0, product.costCents || 0));
          return `<div class="products-dense-price"><strong>${esc(formatCents(product.salePriceCents || 0))}</strong><small>Custo ${esc(formatCents(product.costCents || 0))} · Margem ${Number.isFinite(margin) ? margin.toFixed(2) : '0.00'}%</small></div>`;
        }
      },
      {
        key:'stock',
        label:'Estoque',
        align:'end',
        render:product => `<div data-product-stock-cell><strong>${esc(quantityLabel(product.stockQuantity))} ${esc(product.unit || 'UN')}</strong><small>${product.trackStock === false ? 'Sem controle de estoque' : `Mín. ${esc(quantityLabel(product.minimumStock || 0))}`}</small></div>`
      },
      {
        key:'status',
        label:'Status',
        render:product => components.StatusBadge(productStatus(product))
      },
      {
        key:'actions',
        label:'Ações',
        align:'end',
        render:product => `<div class="products-dense-actions"><button class="secondary-button" type="button" data-product-photo-edit="${esc(product.id)}">${product.photo ? 'Trocar foto' : 'Adicionar foto'}</button>${product.photo ? `<button class="secondary-button" type="button" data-product-photo-remove="${esc(product.id)}">Remover foto</button>` : ''}<button class="secondary-button" type="button" data-edit-product="${esc(product.id)}">Editar</button></div>`
      }
    ];

    const table = components.DataTable({
      ariaLabel:'Produtos',
      className:'products-dense-table data-card',
      columns,
      rows:products,
      empty:{
        title:'Nenhum produto encontrado',
        description:query || categoryId || stockFilter ? 'Revise a busca ou os filtros aplicados.' : 'Cadastre o primeiro produto para começar.'
      }
    });

    return `<section class="page products-dense-page" data-products-view="dense"><header class="page-head"><div><h1>Produtos</h1><p>Catálogo, preços, fotos, custo, margem e estoque mínimo.</p></div><div class="products-dense-head-actions"><button class="secondary-button" id="sync-product-photos">↻ Sincronizar fotos agora</button><button class="secondary-button" id="new-category">＋ Categoria</button><button class="primary-button" id="new-product">＋ Novo produto</button></div></header><div class="products-dense-toolbar">${search}${filters}<small class="products-dense-sync">${esc(syncLabel)}</small></div>${table}</section>`;
  }

  return Object.freeze({
    PRODUCTS_UX_LEVEL,
    PRODUCTS_UX_GUARDS,
    productStatus,
    filterByStock,
    renderProductsDense
  });
});
