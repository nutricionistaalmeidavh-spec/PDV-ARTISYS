'use strict';

// Layout-only enhancement; sale handlers, totals, stock, fiscal and payments remain canonical.
(() => {
  const lifecycle = window.PdvUiLifecycle;
  const metrics = window.PdvCheckoutLayoutMetrics;
  const content = document.getElementById('route-content');
  if (!lifecycle || !metrics || !content) return;

  let layout = null;
  let observer = null;
  let scheduled = false;
  let frame = 0;
  let showCatalog = false;
  let lastHeight = -1;

  function disconnect() {
    if (observer) observer.disconnect();
    observer = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    layout = null;
    lastHeight = -1;
  }

  function measure() {
    frame = 0;
    if (!layout?.isConnected || document.body.dataset.activeRoute !== 'checkout') return;
    const route = content.getBoundingClientRect();
    const top = layout.getBoundingClientRect().top;
    const height = metrics.calculateCheckoutSpace({
      viewportHeight:window.innerHeight,
      routeBottom:route.bottom,
      routeTop:route.top,
      layoutTop:top
    });
    if (height !== lastHeight) {
      lastHeight = height;
      layout.style.setProperty('--checkout-fit-height', `${height}px`);
    }
    const styles = getComputedStyle(content);
    const width = content.clientWidth - parseFloat(styles.paddingLeft || 0) - parseFloat(styles.paddingRight || 0);
    const narrow = width < 860;
    layout.classList.toggle('checkout-narrow', narrow);
    layout.classList.toggle('checkout-short', height < 570);
    layout.classList.toggle('checkout-very-short', height < 420);
    layout.classList.toggle('checkout-narrow-show-catalog', narrow && showCatalog);
    layout.classList.add('checkout-responsive-ready');
  }

  function queueMeasure() {
    if (frame) return;
    frame = requestAnimationFrame(measure);
  }

  function show(which) {
    showCatalog = which === 'catalog';
    if (!layout?.isConnected) return;
    layout.classList.toggle('checkout-narrow-show-catalog', showCatalog);
    const target = showCatalog
      ? layout.querySelector('.checkout-narrow-nav-cart')
      : layout.querySelector('.checkout-narrow-nav-products');
    target?.focus({preventScroll:true});
  }

  function enhance() {
    const candidate = content.querySelector('.checkout-layout[data-checkout-space]');
    if (!candidate) return;
    if (candidate === layout) { queueMeasure(); return; }
    disconnect();
    layout = candidate;

    const cartHead = layout.querySelector('.cart-head');
    const hero = layout.querySelector('.checkout-hero');
    if (!cartHead || !hero) { disconnect(); return; }

    const products = document.createElement('button');
    products.type = 'button';
    products.className = 'checkout-narrow-nav-products';
    products.textContent = 'Ver produtos';
    products.setAttribute('aria-label', 'Mostrar catálogo de produtos');
    products.addEventListener('click', () => show('catalog'));
    const clearCart = cartHead.querySelector('#clear-cart');
    cartHead.insertBefore(products, clearCart || null);

    const cart = document.createElement('button');
    cart.type = 'button';
    cart.className = 'checkout-narrow-nav-cart';
    cart.textContent = 'Ver carrinho';
    cart.setAttribute('aria-label', 'Mostrar os itens da venda');
    cart.addEventListener('click', () => show('cart'));
    hero.append(cart);

    if (typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(queueMeasure);
      observer.observe(content);
    }
    queueMeasure();
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhance();
    });
  }

  window.addEventListener('resize', queueMeasure, {passive:true});
  lifecycle.on('route:mounted', ({route}) => {
    if (route === 'checkout') schedule();
    else { disconnect(); showCatalog = false; }
  });
  lifecycle.on('route:updated', ({route}) => {
    if (route === 'checkout') schedule();
  });
  if (document.body.dataset.activeRoute === 'checkout') schedule();
})();
