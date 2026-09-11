'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  const MODULE_LABELS={
    RESTAURANT:'Restaurante',PIZZERIA:'Pizzaria',DELIVERY:'Delivery',FAST_FOOD:'Fast-food / Lanchonete',MARKET_BAKERY:'Mercado / Conveniência / Padaria',RETAIL:'Varejo',SERVICES:'Serviços',WORKSHOP:'Oficina',SELF_SERVICE:'Autoatendimento'
  };
  const SUPPORTED_WORKSPACES=new Set(['PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY','RESTAURANT']);
  let modules=[];

  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));}
  function notify(message,error=false){const root=document.getElementById('toast-root');if(!root)return;const node=document.createElement('div');node.className=`toast ${error?'error':'success'}`;node.textContent=message;root.appendChild(node);setTimeout(()=>node.remove(),3200);}
  function sanitizeLegacyPaymentCopy(root=document){
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    for(const node of nodes)if(node.nodeValue?.includes('Cartão crédito / TEF'))node.nodeValue=node.nodeValue.replaceAll('Cartão crédito / TEF','Cartão crédito');
  }

  function ensureLauncher(){
    if(document.getElementById('vertical-modules-launcher'))return;
    const sidebar=document.getElementById('app-sidebar');if(!sidebar)return;
    const button=document.createElement('button');button.id='vertical-modules-launcher';button.type='button';button.className='nav-button vertical-launcher';button.title='Módulos do estabelecimento';button.setAttribute('aria-label','Módulos do estabelecimento');button.textContent='M';button.addEventListener('click',openManager);
    const spacer=sidebar.querySelector('.sidebar-spacer');sidebar.insertBefore(button,spacer||null);
  }

  async function loadModules(){modules=await api.modules();return modules;}
  async function openManager(){
    try{await loadModules();renderManager();}catch(error){notify(error.message,true);}
  }

  function renderManager(){
    const content=document.getElementById('route-content');if(!content)return;
    const enabled=modules.filter(module=>module.enabled);
    content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Módulos do estabelecimento</h1><p>Ative somente o que sua operação utiliza. O núcleo de caixa, estoque e vendas continua único.</p></div><span class="vertical-rule">Pagamentos manuais · Documentos NÃO FISCAL</span></header>
      <div class="vertical-layout"><section class="data-card vertical-settings"><h2>Ativação</h2>${modules.map(module=>`<label class="vertical-toggle"><span><strong>${escapeHtml(MODULE_LABELS[module.id]||module.name)}</strong><small>${escapeHtml(module.description||'')}</small></span><input type="checkbox" data-module-toggle="${module.id}" ${module.enabled?'checked':''}></label>`).join('')}</section>
      <section class="data-card vertical-enabled"><h2>Em uso</h2><div class="vertical-card-grid">${enabled.length?enabled.map(module=>`<button type="button" class="vertical-card" data-module-open="${module.id}" ${SUPPORTED_WORKSPACES.has(module.id)?'':'disabled'}><strong>${escapeHtml(MODULE_LABELS[module.id]||module.name)}</strong><span>${SUPPORTED_WORKSPACES.has(module.id)?'Abrir módulo':'Disponível em entrega posterior'}</span></button>`).join(''):'<p class="vertical-empty">Nenhum módulo opcional ativado.</p>'}</div></section></div></section>`;
    content.querySelectorAll('[data-module-toggle]').forEach(input=>input.addEventListener('change',async()=>{
      const id=input.dataset.moduleToggle;input.disabled=true;
      try{await api.saveSetting(`modules.${id}.enabled`,input.checked,'global');await loadModules();renderManager();notify(`${MODULE_LABELS[id]||id} ${input.checked?'ativado':'desativado'}.`);}catch(error){input.checked=!input.checked;input.disabled=false;notify(error.message,true);}
    }));
    content.querySelectorAll('[data-module-open]').forEach(button=>button.addEventListener('click',()=>renderWorkspace(button.dataset.moduleOpen)));
  }

  function backButton(){return '<button class="secondary-button" type="button" id="vertical-back">← Módulos</button>';}
  function bindBack(){document.getElementById('vertical-back')?.addEventListener('click',renderManager);}
  function input(name,label,type='text',extra=''){return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;}

  async function renderWorkspace(id){
    if(!modules.find(module=>module.id===id&&module.enabled))return renderManager();
    if(id==='PIZZERIA')return renderPizzeria();
    if(id==='DELIVERY')return renderDelivery();
    if(id==='FAST_FOOD')return renderFastFood();
    if(id==='MARKET_BAKERY')return renderMarket();
    if(id==='RESTAURANT')return renderRestaurantAdvanced();
  }

  function renderPizzeria(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Pizzaria</h1><p>Tamanhos, sabores, bordas e preço por política configurável.</p></div>${backButton()}</header><div class="data-card"><form id="pizza-profile-form" class="vertical-form">${input('productId','ID do produto base')}<label class="field"><span>Política para vários sabores</span><select name="pricingPolicy"><option value="HIGHEST_FLAVOR">Maior preço</option><option value="PROPORTIONAL_AVERAGE">Média proporcional</option></select></label><button class="primary-button" type="submit">Salvar perfil</button></form></div><div class="data-card"><h2>Prévia de preço</h2><form id="pizza-price-form" class="vertical-form">${input('productId','ID do produto')}${input('sizeId','ID do tamanho')}${input('flavors','IDs dos sabores (separados por vírgula)')}${input('crustId','ID da borda')}<button class="primary-button" type="submit">Calcular</button></form><pre id="pizza-price-output" class="vertical-output"></pre></div></section>`;bindBack();
    document.getElementById('pizza-profile-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{await api.savePizzeriaProfile({productId:data.get('productId'),pricingPolicy:data.get('pricingPolicy')});notify('Perfil de pizzaria salvo.');}catch(error){notify(error.message,true);}});
    document.getElementById('pizza-price-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.pricePizza({productId:data.get('productId'),sizeId:data.get('sizeId'),flavorIds:String(data.get('flavors')||'').split(',').map(v=>v.trim()).filter(Boolean),crustId:data.get('crustId')||null});document.getElementById('pizza-price-output').textContent=`Preço: R$ ${(result.unitPriceCents/100).toFixed(2).replace('.',',')}`;}catch(error){notify(error.message,true);}});
  }

  async function renderDelivery(){
    const content=document.getElementById('route-content');let orders=[];try{orders=await api.delivery();}catch(error){notify(error.message,true);}
    content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Delivery</h1><p>Entrega e retirada com cobrança registrada manualmente.</p></div>${backButton()}</header><div class="data-card"><form id="delivery-form" class="vertical-form">${input('customerName','Cliente')}${input('phone','Telefone')}<label class="field"><span>Atendimento</span><select name="fulfillmentType"><option value="DELIVERY">Entrega</option><option value="PICKUP">Retirada</option></select></label>${input('region','Bairro / região')}${input('fee','Taxa em R$','text','inputmode="decimal"')}<label class="field"><span>Pagamento manual</span><select name="paymentMethod"><option>PIX</option><option value="CASH">Dinheiro</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option><option value="OTHER">Outro</option></select></label><button class="primary-button" type="submit">Criar pedido</button></form></div><div class="data-card"><h2>Pedidos</h2>${orders.map(order=>`<div class="vertical-row"><strong>${escapeHtml(order.customerName)}</strong><span>${escapeHtml(order.fulfillmentType)} · ${escapeHtml(order.status)}</span><span>${escapeHtml(order.paymentMethod||'Sem pagamento definido')}</span></div>`).join('')||'<p class="vertical-empty">Nenhum pedido.</p>'}</div></section>`;bindBack();
    document.getElementById('delivery-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const fee=Math.round(Number(String(data.get('fee')||'0').replace(',','.'))*100)||0;try{await api.createDelivery({customerName:data.get('customerName'),phone:data.get('phone'),fulfillmentType:data.get('fulfillmentType'),region:data.get('region'),feeCents:fee,paymentMethod:data.get('paymentMethod'),address:data.get('fulfillmentType')==='DELIVERY'?{description:'Informar endereço no atendimento'}:null});notify('Pedido criado.');renderDelivery();}catch(error){notify(error.message,true);}});
  }

  async function renderFastFood(){
    const content=document.getElementById('route-content');let orders=[];try{orders=await api.fastFood();}catch(error){notify(error.message,true);}
    content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Fast-food / Lanchonete</h1><p>Senha diária e fila local de produção.</p></div>${backButton()}</header><div class="data-card"><button id="fast-new" class="primary-button" type="button">Nova senha</button></div><div class="data-card"><h2>Fila</h2>${orders.map(order=>`<div class="vertical-row"><strong>Senha ${order.dailyNumber}</strong><span>${escapeHtml(order.status)}</span><div class="vertical-actions">${order.status==='NEW'?`<button data-fast-status="${order.id}:PREPARING">Preparar</button>`:''}${order.status==='PREPARING'?`<button data-fast-status="${order.id}:READY">Pronto</button>`:''}${order.status==='READY'?`<button data-fast-status="${order.id}:DELIVERED">Entregue</button>`:''}</div></div>`).join('')||'<p class="vertical-empty">Fila vazia.</p>'}</div></section>`;bindBack();
    document.getElementById('fast-new').addEventListener('click',async()=>{try{await api.createFastFood({});renderFastFood();}catch(error){notify(error.message,true);}});content.querySelectorAll('[data-fast-status]').forEach(button=>button.addEventListener('click',async()=>{const[id,status]=button.dataset.fastStatus.split(':');try{await api.updateFastFoodStatus(id,status);renderFastFood();}catch(error){notify(error.message,true);}}));
  }

  function renderMarket(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Mercado / Conveniência / Padaria</h1><p>Itens por peso com entrada manual e balança opcional.</p></div>${backButton()}</header><div class="data-card"><h2>Preço por peso</h2><form id="weight-price-form" class="vertical-form">${input('productId','ID do produto')}${input('grams','Peso em gramas','number','min="1" step="1"')}<button class="primary-button" type="submit">Calcular</button></form><pre id="weight-output" class="vertical-output"></pre></div><div class="data-card"><h2>Ler etiqueta configurada</h2><form id="weight-barcode-form" class="vertical-form">${input('barcode','Código da etiqueta')}<button class="secondary-button" type="submit">Interpretar</button></form><pre id="barcode-output" class="vertical-output"></pre></div></section>`;bindBack();
    document.getElementById('weight-price-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.priceWeighted({productId:data.get('productId'),grams:Number(data.get('grams'))});document.getElementById('weight-output').textContent=`Total: R$ ${(result.totalCents/100).toFixed(2).replace('.',',')}`;}catch(error){notify(error.message,true);}});
    document.getElementById('weight-barcode-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.parseWeightBarcode({barcode:data.get('barcode')});document.getElementById('barcode-output').textContent=`Produto ${result.productCode} · ${result.grams} g`;}catch(error){notify(error.message,true);}});
  }

  function renderRestaurantAdvanced(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Restaurante avançado</h1><p>Divisão de conta e transferência seletiva usam as mesmas vendas canônicas do balcão.</p></div>${backButton()}</header><div class="data-card"><h2>Consultar saldo de comanda</h2><form id="restaurant-balance-form" class="vertical-form">${input('sessionId','ID da comanda')}<button class="primary-button" type="submit">Consultar</button></form><pre id="restaurant-output" class="vertical-output"></pre></div></section>`;bindBack();document.getElementById('restaurant-balance-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await api.restaurantRemaining(data.get('sessionId'));document.getElementById('restaurant-output').textContent=`Saldo: R$ ${(result.totalCents/100).toFixed(2).replace('.',',')} · ${result.items.length} item(ns)`;}catch(error){notify(error.message,true);}});
  }

  ensureLauncher();
  sanitizeLegacyPaymentCopy(document);
  const observer=new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeType===Node.ELEMENT_NODE||node.nodeType===Node.TEXT_NODE)sanitizeLegacyPaymentCopy(node.nodeType===Node.TEXT_NODE?node.parentNode:node);});
  observer.observe(document.body,{subtree:true,childList:true});
})();
