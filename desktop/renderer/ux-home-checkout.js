'use strict';

(() => {
  const content = document.getElementById('route-content');
  if (!content) return;
  let scheduled = false;

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
    productRegion.append(tools, categories, productGrid);
    main.insertBefore(productRegion, actions);
    actions.classList.add('checkout-secondary-actions');

    const contextRegion = document.createElement('div');
    contextRegion.className = 'sale-context-grid';
    contextRegion.dataset.checkoutSaleContext = 'true';
    contextRegion.append(sellerBlock, customerBlock);
    panel.insertBefore(contextRegion, panel.firstChild);

    const cartRegion = document.createElement('section');
    cartRegion.className = 'sale-cart-region';
    cartRegion.dataset.checkoutCartRegion = 'true';
    cartRegion.append(cartHead, cartList);
    const totals = panel.querySelector(':scope > .totals');
    if (totals) panel.insertBefore(cartRegion, totals);
    else panel.appendChild(cartRegion);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhanceCheckout();
    });
  }

  new MutationObserver(schedule).observe(content, { childList:true, subtree:true });
  schedule();
})();
