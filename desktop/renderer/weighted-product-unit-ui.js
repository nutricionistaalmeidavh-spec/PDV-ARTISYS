'use strict';

(function attachWeightedProductUnitUi(root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.document) {
    root.PdvWeightedProductUnitUi = api;
    api.install();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function weightedProductUnitUiFactory(root) {
  function normalizeUnit(value) {
    return String(value || '').trim().toUpperCase();
  }

  function createGramOption() {
    const option = root?.document?.createElement ? root.document.createElement('option') : { value:'', textContent:'' };
    option.value = 'G';
    option.textContent = 'G';
    return option;
  }

  function ensureGramOption(select, selectedUnit = '') {
    if (!select || typeof select.querySelector !== 'function') return false;
    let option = select.querySelector('option[value="G"]');
    if (!option) {
      option = createGramOption();
      const kilogram = select.querySelector('option[value="KG"]');
      if (kilogram && typeof kilogram.insertAdjacentElement === 'function') kilogram.insertAdjacentElement('afterend', option);
      else if (typeof select.appendChild === 'function') select.appendChild(option);
      else return false;
    }
    if (normalizeUnit(selectedUnit) === 'G') select.value = 'G';
    return true;
  }

  async function resolveProductUnit(productId) {
    if (!productId || !root?.PdvApiClient?.ApiClient) return '';
    try {
      const api = new root.PdvApiClient.ApiClient();
      await api.initialize();
      const products = await api.products(false);
      const product = (Array.isArray(products) ? products : []).find(item => String(item.id) === String(productId));
      return normalizeUnit(product?.unit);
    } catch {
      return '';
    }
  }

  async function enhanceProductForm(productId = null) {
    const select = root?.document?.querySelector?.('#product-form select[name="unit"]');
    if (!select) return false;
    ensureGramOption(select);
    if (productId) {
      const unit = await resolveProductUnit(productId);
      if (unit === 'G') ensureGramOption(select, unit);
    }
    return true;
  }

  function install() {
    if (!root?.document?.addEventListener) return false;
    root.document.addEventListener('click', event => {
      const edit = event.target?.closest?.('[data-edit-product]');
      const create = event.target?.closest?.('#new-product');
      if (!edit && !create) return;
      const productId = edit?.dataset?.editProduct || null;
      root.setTimeout(() => { void enhanceProductForm(productId); }, 0);
    }, true);
    return true;
  }

  return { normalizeUnit, ensureGramOption, enhanceProductForm, install };
});
