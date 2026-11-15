'use strict';

// Presentation-only checkout footer. Keep the existing input/button nodes and their
// handlers; no sales, payment, fiscal, or persistence logic is duplicated here.
(() => {
  const lifecycle = window.PdvUiLifecycle;
  const routeContent = document.getElementById('route-content');
  if (!lifecycle?.on || !routeContent) return;

  let scheduled = false;

  function section(name, title, description) {
    const element = document.createElement('section');
    element.className = `checkout-${name}`;
    element.dataset.checkoutSection = name;
    element.setAttribute('aria-label', title);

    const header = document.createElement('div');
    header.className = 'checkout-section-header';
    const heading = document.createElement('h3');
    heading.textContent = title;
    header.append(heading);
    if (description) {
      const hint = document.createElement('small');
      hint.textContent = description;
      header.append(hint);
    }
    element.append(header);
    return element;
  }

  function paymentIcon(method) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('width','18');
    svg.setAttribute('height','18');
    svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','1.9');
    svg.setAttribute('stroke-linecap','round');
    svg.setAttribute('stroke-linejoin','round');
    svg.setAttribute('aria-hidden','true');
    svg.classList.add('checkout-pay-icon');

    const strokes = {
      cash:[
        ['rect',{x:'2',y:'5',width:'20',height:'14',rx:'2'}],
        ['circle',{cx:'12',cy:'12',r:'2'}],
        ['path',{d:'M6 12h.01M18 12h.01'}]
      ],
      card:[
        ['rect',{x:'2',y:'5',width:'20',height:'14',rx:'2'}],
        ['path',{d:'M2 10h20'}]
      ],
      pix:[
        ['rect',{x:'3',y:'3',width:'7',height:'7',rx:'1'}],
        ['rect',{x:'14',y:'3',width:'7',height:'7',rx:'1'}],
        ['rect',{x:'3',y:'14',width:'7',height:'7',rx:'1'}],
        ['path',{d:'M16 14v3h3M21 14v2M14 21h2M19 19h2'}]
      ]
    };
    for (const [tag, attributes] of (strokes[method] || strokes.card)) {
      const child = document.createElementNS('http://www.w3.org/2000/svg',tag);
      for (const [key, value] of Object.entries(attributes)) child.setAttribute(key,value);
      svg.append(child);
    }
    return svg;
  }

  function enhanceCheckout() {
    const layout = routeContent.querySelector('.checkout-layout[data-checkout-space]');
    const footer = layout?.querySelector('.sale-checkout-footer:not(.checkout-clarity-footer)');
    if (!footer) return;

    const buttons = footer.querySelector('.checkout-quick-actions');
    const totals = footer.querySelector('.totals');
    const paymentStrip = footer.querySelector('.payment-strip');
    const finalize = footer.querySelector('#finalize-sale');
    const noteButton = buttons?.querySelector('button:first-child');
    const discountButton = buttons?.querySelector('button:nth-child(2)');
    const grandTotal = totals?.querySelector('.grand-total');
    if (!buttons || !totals || !paymentStrip || !finalize || !noteButton || !discountButton || !grandTotal) return;

    const adjustments = section('adjustments','Ajustes da venda','Opcionais');
    const summary = section('summary','Resumo da venda');
    const payment = section('payment','Forma de pagamento');

    // Reparent, do not clone. Canonical listeners stay attached to these nodes.
    adjustments.append(buttons);
    summary.append(totals);
    payment.append(paymentStrip,finalize);
    footer.append(adjustments,summary,payment);
    footer.classList.add('checkout-clarity-footer');

    const totalLabel = grandTotal.querySelector('span');
    if (totalLabel) totalLabel.textContent = 'Total a receber';

    const noteInput = layout.querySelector('#sale-observation');
    const notePrint = layout.querySelector('#sale-observation-print');
    const discountInput = layout.querySelector('#discount-percent');
    const noteState = noteButton.querySelector('small');
    const discountState = discountButton.querySelector('small');
    const discountAmount = totals.querySelector('.checkout-discount-amount');

    function updateIndicators() {
      if (noteState && noteInput) {
        noteState.textContent = noteInput.value.trim()
          ? (notePrint?.checked ? 'No cupom' : 'Registrada')
          : 'Não adicionada';
        noteButton.classList.toggle('has-value',Boolean(noteInput.value.trim()));
      }
      if (discountState && discountInput) {
        const applied = Number(discountInput.value) > 0;
        discountState.textContent = applied ? 'Aplicado' : 'Nenhum aplicado';
        discountButton.classList.toggle('has-value',applied);
      }
    }
    noteInput?.addEventListener('input',updateIndicators);
    notePrint?.addEventListener('change',updateIndicators);
    discountInput?.addEventListener('input',updateIndicators);
    discountInput?.addEventListener('change',updateIndicators);
    updateIndicators();

    if (discountAmount) {
      const raw = discountAmount.textContent.trim();
      const cents = Number(raw.replace(/[^\d,.]/g,'').replace(/\./g,'').replace(',','.')) || 0;
      if (cents > 0 && !raw.startsWith('−') && !raw.startsWith('-')) {
        discountAmount.textContent = `− ${raw}`;
      }
    }

    for (const button of paymentStrip.querySelectorAll('[data-pay]')) {
      const label = button.textContent.trim();
      button.prepend(paymentIcon(button.dataset.pay));
      button.setAttribute('aria-label',`Escolher pagamento: ${label}`);
      button.setAttribute('title',`Receber por ${label}`);
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (document.body.dataset.activeRoute === 'checkout') enhanceCheckout();
    });
  }

  lifecycle.on('route:mounted',({route}) => { if (route === 'checkout') schedule(); });
  lifecycle.on('route:updated',({route}) => { if (route === 'checkout') schedule(); });
  if (document.body.dataset.activeRoute === 'checkout') schedule();
})();
