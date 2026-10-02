'use strict';

(()=>{
  const ApiClient=window.PdvApiClient?.ApiClient;if(!ApiClient)return;
  const api=new ApiClient();
  const content=()=>document.getElementById('route-content');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const quantity=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  let refs={customers:[],products:[],locations:[]};
  let cart=[];

  function toast(message,error=false){const root=document.getElementById('toast-root');if(!root)return;const node=document.createElement('div');node.className=`toast ${error?'error':'success'}`;node.textContent=message;root.appendChild(node);setTimeout(()=>node.remove(),3200);}
  function select(name,label,rows,{value='id',text='name'}={}){return `<label class="field"><span>${esc(label)}</span><select name="${esc(name)}" required><option value="">Selecione</option>${rows.map(row=>`<option value="${esc(row[value])}">${esc(row[text]||row[value])}</option>`).join('')}</select></label>`;}
  function field(name,label,type='text',extra=''){return `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" ${extra}></label>`;}
  function status(value){const labels={QUOTED:'Cotado',CONFIRMED:'Confirmado',PARTIALLY_FULFILLED:'Parcial',FULFILLED:'Atendido',CANCELLED:'Cancelado'};return labels[value]||value;}

  async function loadRefs(){
    if(!api.config)await api.initialize();
    const [customers,products,locations]=await Promise.all([api.customers(),api.products(false),api.stockLocations()]);
    refs={customers:customers.filter(row=>row.active!==false),products:products.filter(row=>row.active!==false),locations:locations.filter(row=>row.active!==false)};
  }

  function cartHtml(){
    if(!cart.length)return '<p class="ops-muted">Nenhum item adicionado.</p>';
    const total=cart.reduce((sum,item)=>sum+item.totalCents,0);
    return `${cart.map(item=>`<article class="ops-row"><div><strong>${esc(item.productName)}</strong><small>${quantity(item.quantity)} × ${money(item.unitPriceCents)}${item.tierId?` · faixa ${quantity(item.minQuantity)}+`:''}</small></div><div class="ops-actions"><strong>${money(item.totalCents)}</strong><button type="button" class="ops-secondary" data-remove-cart="${esc(item.productId)}">Remover</button></div></article>`).join('')}<div class="ops-row"><strong>Total cotado</strong><strong>${money(total)}</strong></div>`;
  }

  async function renderTiers(productId){
    const host=content()?.querySelector('[data-wholesale-tiers]');if(!host)return;
    if(!productId){host.innerHTML='<p class="ops-muted">Selecione um produto para consultar as faixas.</p>';return;}
    try{
      const rows=await api.wholesaleTiers(productId);
      host.innerHTML=rows.length?rows.map(row=>`<article class="ops-row"><div><strong>A partir de ${quantity(row.minQuantity)}</strong><small>Preço base ${money(row.baseUnitPriceCents)} → atacado ${money(row.unitPriceCents)}</small></div><button type="button" class="ops-secondary" data-disable-tier="${esc(row.id)}">Desativar</button></article>`).join(''):'<p class="ops-muted">Sem faixas configuradas; será usado o preço normal do produto.</p>';
      host.querySelectorAll('[data-disable-tier]').forEach(button=>button.addEventListener('click',async()=>{try{await api.deactivateWholesaleTier(button.dataset.disableTier);toast('Faixa desativada.');await renderTiers(productId);}catch(error){toast(error.message,true);}}));
    }catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
  }

  async function loadOrders(){
    const host=content()?.querySelector('[data-wholesale-orders]');if(!host)return;
    try{
      const rows=await api.wholesaleOrders();
      host.innerHTML=rows.length?rows.map(order=>`<article class="ops-card" data-order="${esc(order.id)}"><div class="ops-card-head"><div><strong>${esc(order.customerName||order.customerId)}</strong><p class="ops-muted">${status(order.status)} · ${money(order.totalCents)} · ${esc(order.fulfillmentType)}</p></div><div class="ops-actions">${order.status==='QUOTED'?'<button class="ops-primary" data-order-action="confirm">Confirmar</button>':''}${['CONFIRMED','PARTIALLY_FULFILLED'].includes(order.status)?'<button class="ops-primary" data-order-action="fulfill">Atender pendente</button>':''}${!['FULFILLED','CANCELLED'].includes(order.status)?'<button class="ops-secondary" data-order-action="cancel">Cancelar</button>':''}</div></div><div>${order.items.map(item=>`<div class="ops-row"><span>${esc(item.productName)} · ${quantity(item.pendingQuantity)} pendente</span><span>${money(item.unitPriceCents)}${item.pricingSnapshot?.tierId?` · faixa ${quantity(item.pricingSnapshot.minQuantity)}+`:''}</span></div>`).join('')}</div></article>`).join(''):'<p class="ops-muted">Nenhum pedido de atacado.</p>';
      host.querySelectorAll('[data-order]').forEach(card=>card.querySelectorAll('[data-order-action]').forEach(button=>button.addEventListener('click',async()=>{
        const order=rows.find(row=>row.id===card.dataset.order);if(!order)return;
        try{
          if(button.dataset.orderAction==='confirm')await api.confirmWholesaleOrder(order.id);
          if(button.dataset.orderAction==='cancel')await api.cancelWholesaleOrder(order.id,'Cancelado no módulo Atacado');
          if(button.dataset.orderAction==='fulfill'){
            const pending=order.items.filter(item=>item.pendingQuantity>0).map(item=>({productId:item.productId,quantity:item.pendingQuantity}));
            const total=order.items.filter(item=>item.pendingQuantity>0).reduce((sum,item)=>sum+Math.round(item.pendingQuantity*item.unitPriceCents),0);
            const method=content()?.querySelector('#wholesale-payment-method')?.value||'PIX';
            const terminalId=api.config?.terminalId||'PDV-01';const operatorId=order.createdBy;
            if(!operatorId)throw new Error('Operador do pedido não identificado.');
            await api.fulfillWholesaleOrder(order.id,{items:pending,payments:[{method,amountCents:total}],terminalId,operatorId,sellerId:operatorId});
          }
          toast('Pedido atualizado.');await loadOrders();
        }catch(error){toast(error.message,true);}
      })));
    }catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
  }

  async function show(){
    await loadRefs();cart=[];
    const root=content();if(!root)return;
    root.innerHTML=`<section class="ops-page" data-module-workspace="WHOLESALE"><header class="ops-head"><div><h1>Atacado</h1><p>Pedidos com cliente obrigatório e preço automático por quantidade, usando o mesmo estoque, caixa e financeiro do ArtiSys.</p></div><button type="button" class="ops-secondary" id="wholesale-home">← Início</button></header>
      <div class="ops-grid">
        <section class="ops-card"><h2>Novo pedido</h2><form id="wholesale-item-form" class="ops-form-grid">${select('customerId','Cliente',refs.customers)}${select('locationId','Local de estoque',refs.locations)}${select('productId','Produto',refs.products)}${field('quantity','Quantidade','number','min="0.001" step="0.001" value="1" required')}<label class="field"><span>Atendimento</span><select name="fulfillmentType"><option value="PICKUP">Retirada</option><option value="DELIVERY">Entrega</option></select></label><button class="ops-secondary" type="submit">Adicionar item</button></form><div data-wholesale-cart>${cartHtml()}</div><div class="ops-actions"><button type="button" class="ops-primary" id="wholesale-create-order" disabled>Criar cotação</button></div></section>
        <section class="ops-card"><h2>Preço por quantidade</h2><form id="wholesale-tier-form" class="ops-form-grid">${select('productId','Produto',refs.products)}${field('minQuantity','A partir de','number','min="0.001" step="0.001" value="1" required')}${field('unitPrice','Preço unitário (R$)','text','inputmode="decimal" required')}<button class="ops-primary" type="submit">Salvar faixa</button></form><div data-wholesale-tiers><p class="ops-muted">Selecione um produto para consultar as faixas.</p></div></section>
      </div>
      <section class="ops-card"><div class="ops-card-head"><div><h2>Pedidos de atacado</h2><p class="ops-muted">O preço cotado fica preservado mesmo que a tabela mude depois.</p></div><label class="field"><span>Pagamento no atendimento</span><select id="wholesale-payment-method"><option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="DEBIT_CARD">Cartão de débito</option><option value="CREDIT_CARD">Cartão de crédito</option></select></label></div><div data-wholesale-orders></div></section>
    </section>`;
    root.querySelector('#wholesale-home')?.addEventListener('click',()=>document.querySelector('#sidebar-nav [data-route="home"]')?.click());

    const itemForm=root.querySelector('#wholesale-item-form');
    itemForm?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(itemForm);try{const productId=String(data.get('productId'));const quantityValue=Number(data.get('quantity'));const priced=await api.wholesalePrice(productId,quantityValue);cart=cart.filter(item=>item.productId!==productId);cart.push(priced);root.querySelector('[data-wholesale-cart]').innerHTML=cartHtml();root.querySelector('#wholesale-create-order').disabled=!cart.length;root.querySelectorAll('[data-remove-cart]').forEach(button=>button.addEventListener('click',()=>{cart=cart.filter(item=>item.productId!==button.dataset.removeCart);root.querySelector('[data-wholesale-cart]').innerHTML=cartHtml();root.querySelector('#wholesale-create-order').disabled=!cart.length;}));}catch(error){toast(error.message,true);}});
    root.querySelector('#wholesale-create-order')?.addEventListener('click',async()=>{const data=new FormData(itemForm);try{if(!cart.length)throw new Error('Adicione ao menos um item.');await api.createWholesaleQuote({customerId:data.get('customerId'),locationId:data.get('locationId')||'MAIN',fulfillmentType:data.get('fulfillmentType')||'PICKUP',items:cart.map(item=>({productId:item.productId,quantity:item.quantity}))});cart=[];toast('Cotação de atacado criada.');await show();}catch(error){toast(error.message,true);}});

    const tierForm=root.querySelector('#wholesale-tier-form');const tierProduct=tierForm?.elements.namedItem('productId');
    tierProduct?.addEventListener('change',()=>void renderTiers(tierProduct.value));
    tierForm?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(tierForm);const unitPriceCents=Math.round(Number(String(data.get('unitPrice')||'0').replace(',','.'))*100);try{await api.saveWholesaleTier({productId:data.get('productId'),minQuantity:Number(data.get('minQuantity')),unitPriceCents});toast('Faixa salva.');await renderTiers(data.get('productId'));}catch(error){toast(error.message,true);}});
    await loadOrders();
  }

  window.PdvWholesaleUi=Object.freeze({show});
})();
