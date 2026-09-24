'use strict';

(() => {
  const PHONE_SELECTOR='input[name="phone"]';
  const ApiClient=window.PdvApiClient?.ApiClient;
  const api=ApiClient?new ApiClient():null;
  let deliveryRefreshBusy=false;

  function normalizePhoneValue(value) {
    let digits=String(value ?? '').replace(/\D/g,'');
    if(digits.length>11 && digits.startsWith('55'))digits=digits.slice(2);
    return digits.slice(0,11);
  }

  function configurePhoneInput(input) {
    if(!(input instanceof HTMLInputElement)||!input.matches(PHONE_SELECTOR))return;
    input.type='tel';
    input.inputMode='numeric';
    input.maxLength=11;
    input.pattern='\\d{10,11}';
    input.autocomplete='tel-national';
    const normalized=normalizePhoneValue(input.value);
    if(input.value!==normalized)input.value=normalized;
  }

  function configureVisiblePhoneInputs(root=document) {
    root.querySelectorAll?.(PHONE_SELECTOR).forEach(configurePhoneInput);
  }

  function validNationalPhone(value) {
    return /^\d{10,11}$/.test(normalizePhoneValue(value));
  }

  async function openReadyWhatsapp(order,button) {
    const openWhatsapp=window.artisysDesktop?.external?.openWhatsapp;
    if(typeof openWhatsapp!=='function')throw new Error('Abertura do WhatsApp indisponivel neste terminal.');
    const originalLabel=button.textContent;
    button.disabled=true;
    button.textContent='Abrindo WhatsApp...';
    try {
      await openWhatsapp({phone:normalizePhoneValue(order.phone),customerName:order.customerName});
      button.textContent='WhatsApp aberto';
      setTimeout(()=>{if(button.isConnected){button.textContent=originalLabel;button.disabled=false;}},1200);
    } catch(error) {
      button.textContent='Tentar novamente';
      button.disabled=false;
      throw error;
    }
  }

  function appendReadyButton(row,order) {
    if(row.querySelector('[data-whatsapp-pickup-ready]'))return;
    if(!(order.fulfillmentType === 'PICKUP' && order.status === 'READY'))return;
    const actions=row.querySelector('.vertical-actions')||row;
    const phoneOk=validNationalPhone(order.phone);
    const button=document.createElement('button');
    button.type='button';
    button.className='ghost';
    button.setAttribute('data-whatsapp-pickup-ready',String(order.id));
    button.textContent=phoneOk?'Avisar no WhatsApp':'WhatsApp sem telefone';
    if(!phoneOk){
      button.disabled=true;
      button.title='Cadastre um telefone com DDD (10 ou 11 numeros) para avisar o cliente.';
    } else {
      button.addEventListener('click',async()=>{
        try { await openReadyWhatsapp(order,button); }
        catch(error) { console.error('Falha ao abrir WhatsApp.',error); }
      });
    }
    actions.appendChild(button);
  }

  async function enhanceReadyPickupRows() {
    if(deliveryRefreshBusy||!api)return;
    const container=document.querySelector('[data-delivery-ops]');
    if(!container)return;
    const rows=[...container.querySelectorAll('[data-delivery-order]')];
    if(!rows.length)return;
    deliveryRefreshBusy=true;
    try {
      const orders=await api.delivery();
      const byId=new Map((Array.isArray(orders)?orders:[]).map(order=>[String(order.id),order]));
      for(const row of rows){
        const order=byId.get(String(row.dataset.deliveryOrder||''));
        if(order)appendReadyButton(row,order);
      }
    } catch(error) {
      console.error('Falha ao atualizar acoes de retirada.',error);
    } finally {
      deliveryRefreshBusy=false;
    }
  }

  function scheduleDeliveryEnhancement() {
    for(const delay of [0,120,400,900,1800,3000])setTimeout(()=>{void enhanceReadyPickupRows();},delay);
  }

  document.addEventListener('focusin',event=>{
    const input=event.target?.closest?.(PHONE_SELECTOR);
    if(input)configurePhoneInput(input);
  });

  document.addEventListener('input',event=>{
    const input=event.target?.closest?.(PHONE_SELECTOR);
    if(!input)return;
    configurePhoneInput(input);
    const normalized=normalizePhoneValue(input.value);
    if(input.value!==normalized)input.value=normalized;
  });

  document.addEventListener('paste',event=>{
    const input=event.target?.closest?.(PHONE_SELECTOR);
    if(!input)return;
    const text=event.clipboardData?.getData('text');
    if(text==null)return;
    event.preventDefault();
    input.value=normalizePhoneValue(text);
    input.dispatchEvent(new Event('input',{bubbles:true}));
  });

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('[data-route-module="DELIVERY"], [data-delivery-next], #delivery-form button'))scheduleDeliveryEnhancement();
  });

  configureVisiblePhoneInputs();
  scheduleDeliveryEnhancement();
})();
