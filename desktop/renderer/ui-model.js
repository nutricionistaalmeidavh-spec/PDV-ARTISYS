'use strict';

(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PdvUiModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  const HOME_TILES = Object.freeze([
    { key: 'checkout', label: 'Balcão', description: 'Iniciar nova venda', shortcut: 'F2', route: 'checkout', tone: 'blue', icon: 'cart' },
    { key: 'customers', label: 'Cliente', description: 'Cadastrar e consultar clientes', shortcut: 'F3', route: 'customers', tone: 'green', icon: 'users' },
    { key: 'sellers', label: 'Vendedor', description: 'Gerenciar vendedores', shortcut: 'F4', route: 'sellers', tone: 'orange', icon: 'user' },
    { key: 'products', label: 'Produtos', description: 'Cadastrar e consultar produtos', shortcut: 'F5', route: 'products', tone: 'purple', icon: 'box' },
    { key: 'inventory', label: 'Estoque', description: 'Entradas, saídas e inventário', shortcut: 'F6', route: 'inventory', tone: 'teal', icon: 'cubes' },
    { key: 'cash', label: 'Caixa', description: 'Abertura, fechamento e sangria', shortcut: 'F7', route: 'cash', tone: 'red', icon: 'cash' },
    { key: 'finance', label: 'Financeiro', description: 'Contas a pagar e receber', shortcut: 'F8', route: 'finance', tone: 'emerald', icon: 'money' },
    { key: 'reports', label: 'Relatórios', description: 'Vendas, estoque e resultados', shortcut: 'F9', route: 'reports', tone: 'indigo', icon: 'chart' },
    { key: 'sales', label: 'Últimas vendas', description: 'Consultar vendas recentes', shortcut: 'F10', route: 'sales', tone: 'slate', icon: 'history' },
    { key: 'returns', label: 'Devolução', description: 'Trocas e devoluções', shortcut: 'F11', route: 'returns', tone: 'pink', icon: 'return' }
  ]);

  const GLOBAL_SHORTCUTS = Object.freeze(Object.fromEntries(HOME_TILES.map((tile) => [tile.shortcut, { type: 'navigate', route: tile.route }])));
  const CHECKOUT_SHORTCUTS = Object.freeze({
    F1: { type: 'checkout.new-sale' },
    F2: { type: 'checkout.focus-scan' },
    F3: { type: 'checkout.remove-selected' },
    F4: { type: 'checkout.cancel-sale' },
    F6: { type: 'checkout.suspend-sale' },
    F12: { type: 'checkout.finalize' }
  });

  function resolveShortcut(key, route) {
    const normalized = String(key || '').toUpperCase();
    if (route === 'checkout' && CHECKOUT_SHORTCUTS[normalized]) return { ...CHECKOUT_SHORTCUTS[normalized] };
    const action = GLOBAL_SHORTCUTS[normalized];
    return action ? { ...action } : null;
  }

  function formatCents(value) {
    const cents = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function percentageToDiscountCents(subtotalCents, percent) {
    const subtotal = Math.max(0, Math.round(Number(subtotalCents) || 0));
    const bounded = Math.min(Math.max(Number(percent) || 0, 0), 100);
    return Math.min(subtotal, Math.round(subtotal * bounded / 100));
  }

  function calculateMarginPercent(salePriceCents, costCents) {
    const sale = Math.max(0, Number(salePriceCents) || 0);
    const cost = Math.max(0, Number(costCents) || 0);
    if (!sale) return 0;
    return Number((((sale - cost) / sale) * 100).toFixed(2));
  }

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function filterProducts(products, query = '', categoryId = '') {
    const needle = normalizeSearch(query);
    return (Array.isArray(products) ? products : []).filter((product) => {
      if (categoryId && String(product.categoryId || '') !== String(categoryId)) return false;
      if (!needle) return true;
      const haystack = normalizeSearch([product.name, product.sku, product.barcode].filter(Boolean).join(' '));
      return haystack.includes(needle);
    });
  }

  function paymentMethodFromUi(value) {
    const key = String(value || '').trim().toLowerCase();
    return ({ cash: 'CASH', money: 'CASH', pix: 'PIX', card: 'CREDIT_CARD', credit: 'CREDIT_CARD', debit: 'DEBIT_CARD', tef: 'CREDIT_CARD', storecredit: 'STORE_CREDIT' })[key] || 'OTHER';
  }

  return {
    HOME_TILES,
    GLOBAL_SHORTCUTS,
    CHECKOUT_SHORTCUTS,
    resolveShortcut,
    formatCents,
    percentageToDiscountCents,
    calculateMarginPercent,
    normalizeSearch,
    filterProducts,
    paymentMethodFromUi
  };
});
