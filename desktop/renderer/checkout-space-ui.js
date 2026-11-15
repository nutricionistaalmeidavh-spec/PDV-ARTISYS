'use strict';

// Progressive checkout enhancement. Move the live controls (and their listeners),
// rather than reimplementing sales, discount, customer or seller operations.
(() => {
  const lifecycle = window.PdvUiLifecycle;
  const routeContent = document.getElementById('route-content');
  if (!lifecycle || !routeContent) return;

  let scheduled = false;
  let cartExpanded = false;

  function action(label, className = 'checkout-space-action') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
  }

  function detailDialog(panel, key, title, content, doneLabel = 'Concluir') {
    const dialog = document.createElement('dialog');
    const headingId = `checkout-detail-title-${key}`;
    dialog.className = 'checkout-detail-dialog';
    dialog.setAttribute('aria-labelledby', headingId);
    const header = document.createElement('header');
    header.className = 'checkout-dialog-heading';
    const heading = document.createElement('h2');
    heading.id = headingId;
    heading.textContent = title;
    const closeButton = action('×', 'checkout-dialog-close');
    closeButton.setAttribute('aria-label', `Fechar ${title}`);
    closeButton.addEventListener('click', () => dialog.close());
    header.append(heading, closeButton);

    const body = document.createElement('div');
    body.className = 'checkout-dialog-body';
    body.append(content);
    const footer = document.createElement('footer');
    footer.className = 'checkout-dialog-actions';
    const done = action(doneLabel, 'checkout-dialog-done');
    done.addEventListener('click', () => dialog.close());
    footer.append(done);
    dialog.append(header, body, footer);
    panel.append(dialog);

    let opener = null;
    dialog.addEventListener('close', () => {
      if (opener?.isConnected) opener.focus({ preventScroll:true });
    });
    // Avoid dispatching checkout function keys while a secondary dialog is open.
    dialog.addEventListener('keydown', event => {
      if (/^F(?:1|2|3|4|6|12)$/.test(event.key)) event.stopPropagation();
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
    });
    return {
      dialog, done,
      open(button, firstControl) {
        opener = button;
        if (!dialog.open) dialog.showModal();
        (firstControl || closeButton).focus({ preventScroll:true });
      }
    };
  }

  function enhanceCheckout() {
    const layout = routeContent.querySelector('.checkout-layout[data-ux-checkout-preserved]:not([data-checkout-space])');
    if (!layout) return;
    const panel = layout.querySelector('.sale-panel');
    const context = panel?.querySelector('.sale-context-grid');
    const cartHead = panel?.querySelector('.cart-head');
    const footer = panel?.querySelector('.sale-checkout-footer');
    const seller = context?.querySelector('#seller-select')?.closest('.customer-block');
    const customer = context?.querySelector('#customer-search')?.closest('.customer-block');
    const observation = panel?.querySelector('[data-sale-observation]');
    const discount = footer?.querySelector('.discount-control');
    const discountRow = discount?.closest('.total-row');
    const clear = cartHead?.querySelector('#clear-cart');
    if (!panel || !context || !cartHead || !footer || !seller || !customer || !observation || !discount || !discountRow || !clear) return;

    layout.dataset.checkoutSpace = 'true';
    layout.classList.toggle('cart-focus-mode', cartExpanded);

    // The old seller/customer fields and their original listeners remain intact.
    const sellerSelect = seller.querySelector('#seller-select');
    const sellerButton = action('Vendedor', 'checkout-context-action');
    const sellerName = document.createElement('strong');
    sellerButton.append(sellerName);
    const updateSeller = () => {
      sellerName.textContent = sellerSelect.selectedOptions?.[0]?.textContent || 'Selecionar';
    };
    updateSeller();
    sellerSelect.addEventListener('change', updateSeller);
    const sellerModal = detailDialog(panel, 'seller', 'Vendedor / Garçom', seller);
    sellerButton.addEventListener('click', () => {
      updateSeller();
      sellerModal.open(sellerButton, sellerSelect);
    });

    const customerInput = customer.querySelector('#customer-search');
    const customerButton = action('Cliente', 'checkout-context-action');
    const customerName = document.createElement('strong');
    customerName.textContent = customer.querySelector('.customer-selected strong')?.textContent || 'Vincular cliente';
    customerButton.append(customerName);
    const customerModal = detailDialog(panel, 'customer', 'Vincular cliente', customer);
    customerButton.addEventListener('click', () => customerModal.open(customerButton, customerInput));
    context.append(sellerButton, customerButton);

    const noteInput = observation.querySelector('#sale-observation');
    const printInput = observation.querySelector('#sale-observation-print');
    const quickActions = document.createElement('div');
    quickActions.className = 'checkout-quick-actions';
    const noteButton = action('Observação');
    const noteStatus = document.createElement('small');
    noteButton.append(noteStatus);
    const updateNote = () => {
      noteStatus.textContent = noteInput.value.trim()
        ? (printInput.checked ? 'No cupom' : 'Registrada')
        : 'Opcional';
      noteButton.classList.toggle('has-value', Boolean(noteInput.value.trim()));
    };
    noteInput.addEventListener('input', updateNote);
    printInput.addEventListener('change', updateNote);
    updateNote();
    const noteModal = detailDialog(panel, 'note', 'Observação da venda', observation);
    noteButton.addEventListener('click', () => noteModal.open(noteButton, noteInput));

    const currentDiscount = discount.querySelector('strong')?.textContent || 'R$ 0,00';
    const discountAmount = document.createElement('strong');
    discountAmount.className = 'checkout-discount-amount';
    discountAmount.textContent = currentDiscount;
    discountRow.replaceChild(discountAmount, discount);
    const discountInput = discount.querySelector('#discount-percent');
    const discountButton = action('Desconto');
    const discountStatus = document.createElement('small');
    discountStatus.textContent = currentDiscount;
    discountButton.append(discountStatus);
    discountButton.classList.toggle('has-value', Number(discountInput.value) > 0);
    const discountModal = detailDialog(panel, 'discount', 'Desconto da venda (%)', discount, 'Aplicar desconto');
    let lastSubmittedValue = discountInput.value;
    discountInput.addEventListener('change', () => { lastSubmittedValue = discountInput.value; }, true);
    discountModal.done.addEventListener('click', () => {
      if (discountInput.value !== lastSubmittedValue) {
        discountInput.dispatchEvent(new Event('change', { bubbles:true }));
      }
    });
    discountButton.addEventListener('click', () => discountModal.open(discountButton, discountInput));
    quickActions.append(noteButton, discountButton);
    footer.prepend(quickActions);

    const expand = action(cartExpanded ? 'Voltar ao catálogo' : 'Ampliar itens', 'checkout-expand-cart');
    expand.setAttribute('aria-pressed', String(cartExpanded));
    expand.addEventListener('click', () => {
      cartExpanded = !cartExpanded;
      layout.classList.toggle('cart-focus-mode', cartExpanded);
      expand.textContent = cartExpanded ? 'Voltar ao catálogo' : 'Ampliar itens';
      expand.setAttribute('aria-pressed', String(cartExpanded));
    });
    clear.textContent = 'Limpar';
    clear.setAttribute('aria-label', 'Limpar carrinho');
    clear.setAttribute('title', 'Limpar carrinho');
    cartHead.insertBefore(expand, clear);

    // Confirm a destructive action, then pass it through the canonical handler.
    const confirmation = document.createElement('p');
    confirmation.textContent = 'Esta ação remove todos os produtos adicionados à venda.';
    const clearModal = detailDialog(panel, 'clear', 'Limpar todos os itens?', confirmation, 'Cancelar');
    const confirm = action('Sim, limpar carrinho', 'checkout-dialog-danger');
    clearModal.dialog.querySelector('.checkout-dialog-actions').prepend(confirm);
    let approved = false;
    clear.addEventListener('click', event => {
      if (approved || !panel.querySelector('.cart-line')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      clearModal.open(clear, clearModal.done);
    }, true);
    confirm.addEventListener('click', () => {
      clearModal.dialog.close();
      approved = true;
      try { clear.click(); } finally { approved = false; }
    });
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      enhanceCheckout();
    });
  }
  const onRouteChange = ({ route }) => {
    if (route === 'checkout') schedule();
    else cartExpanded = false;
  };
  lifecycle.on('route:mounted', onRouteChange);
  lifecycle.on('route:updated', onRouteChange);
  if (document.body.dataset.activeRoute === 'checkout') schedule();
})();
