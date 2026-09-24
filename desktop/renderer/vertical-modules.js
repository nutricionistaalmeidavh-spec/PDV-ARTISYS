'use strict';

(() => {
  const root=window;
  const ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  const MODULE_REQUEST_TIMEOUT_MS=5000;
  const MODULE_LABELS={
    RESTAURANT:'Restaurante',PIZZERIA:'Pizzaria',DELIVERY:'Delivery',FAST_FOOD:'Fast-food / Lanchonete',MARKET_BAKERY:'Mercado / Conveniência / Padaria',RETAIL:'Varejo',SERVICES:'Serviços',WORKSHOP:'Oficina',SELF_SERVICE:'Autoatendimento'
  };
  const SUPPORTED_WORKSPACES=new Set(['PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY','RESTAURANT']);
  let modules=[];
  let modulesLoading=false;
  let sanitizeScheduled=false;

  function escapeHtml(value){return String(value??'').replace(/[&<>'\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[char]));}
  function notify(message,error=false){const toastRoot=document.getElementById('toast-root');if(!toastRoot)return;const node=document.createElement('div');node.className=`toast ${error?'error':'success'}`;node.textContent=message;toastRoot.appendChild(node);setTimeout(()=>node.remove(),3200);}
  function sanitizeLegacyPaymentCopy(target=document){
    if(!target)return;
    if(target.nodeType===Node.TEXT_NODE){if(target.nodeValue?.includes('Cartão crédito / TEF'))target.nodeValue=target.nodeValue.replaceAll('Cartão crédito / TEF','Cartão crédito');return;}
    const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT);while(walker.nextNode()){const node=walker.currentNode;if(node.nodeValue?.includes('Cartão crédito / TEF'))node.nodeValue=node.nodeValue.replaceAll('Cartão crédito / TEF','Cartão crédito');}
  }
  function scheduleSanitize(){
    if(sanitizeScheduled)return;
    sanitizeScheduled=true;
    queueMicrotask(()=>{sanitizeScheduled=false;sanitizeLegacyPaymentCopy(document.body);});
  }
  async function withTimeout(promise,timeoutMs=MODULE_REQUEST_TIMEOUT_MS,message='A operação de módulos demorou demais. Tente novamente.'){
    let timer=null;
    try{
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeoutMs);})
      ]);
    }finally{if(timer)clearTimeout(timer);}
  }
  async function loadModules(){modules=await withTimeout(api.modules(),MODULE_REQUEST_TIMEOUT_MS,'Não foi possível carregar os módulos dentro do tempo esperado.');return modules;}

  function settingsPage(){
    const content=document.getElementById('route-content');
    const page=content?.querySelector('.ops-page');
    const heading=page?.querySelector('.ops-head h1');
    return heading?.textContent?.trim()==='Configurações'?page:null;
  }

  function settingsModulesCard(){return document.getElementById('ops-establishment-modules-card');}

  function renderSettingsModules(card=settingsModulesCard()){
    if(!card||!card.isConnected)return;
    const enabled=modules.filter(module=>module.enabled);
    const body=card.querySelector('[data-establishment-modules-body]');
    if(!body)return;
    body.innerHTML=`<div class="vertical-layout"><section class="vertical-settings"><h3>Ativação</h3>${modules.map(module=>`<label class="vertical-toggle"><span><strong>${escapeHtml(MODULE_LABELS[module.id]||module.name)}</strong><small>${escapeHtml(module.description||'')}</small></span><input type="checkbox" data-module-toggle="${module.id}" ${module.enabled?'checked':''}></label>`).join('')}</section><section class="vertical-enabled"><h3>Em uso</h3><div class="vertical-card-grid">${enabled.length?enabled.map(module=>`<button type="button" class="vertical-card" data-module-open="${module.id}" ${SUPPORTED_WORKSPACES.has(module.id)?'':'disabled'}><strong>${escapeHtml(MODULE_LABELS[module.id]||module.name)}</strong><span>${SUPPORTED_WORKSPACES.has(module.id)?'Abrir módulo':'Sem tela operacional própria'}</span></button>`).join(''):'<p class="vertical-empty">Nenhum módulo opcional ativado.</p>'}</div></section></div>`;
    body.querySelectorAll('[data-module-toggle]').forEach(input=>input.addEventListener('change',async()=>{
      const id=input.dataset.moduleToggle;
      const target=input.checked;
      input.disabled=true;
      try{
        await withTimeout(api.saveSetting(`modules.${id}.enabled`,target,'global'),MODULE_REQUEST_TIMEOUT_MS,'A alteração do módulo demorou demais. Nada foi travado; tente novamente.');
        modules=modules.map(module=>module.id===id?{...module,enabled:target}:module);
        renderSettingsModules(card);
        notify(`${MODULE_LABELS[id]||id} ${target?'ativado':'desativado'}.`);
      }catch(error){
        input.checked=!target;
        input.disabled=false;
        notify(error.message,true);
      }
    }));
    body.querySelectorAll('[data-module-open]').forEach(button=>button.addEventListener('click',()=>renderWorkspace(button.dataset.moduleOpen)));
  }

  async function loadAndRenderSettingsModules(card=settingsModulesCard()){
    if(!card||modulesLoading)return;
    const body=card.querySelector('[data-establishment-modules-body]');
    if(!body)return;
    modulesLoading=true;
    body.innerHTML='<div class="ops-loader"></div><p class="ops-muted">Carregando módulos do estabelecimento…</p>';
    try{
      await loadModules();
      if(card.isConnected)renderSettingsModules(card);
    }catch(error){
      if(card.isConnected){
        body.innerHTML=`<div class="ops-error">${escapeHtml(error.message)}</div><div class="ops-actions"><button type="button" class="ops-secondary" data-modules-retry>Tentar novamente</button></div>`;
        body.querySelector('[data-modules-retry]')?.addEventListener('click',()=>{void loadAndRenderSettingsModules(card);});
      }
      notify(error.message,true);
    }finally{modulesLoading=false;}
  }

  function mountSettingsModules(){
    const page=settingsPage();
    if(!page||page.querySelector('#ops-establishment-modules-card'))return;
    const card=document.createElement('section');
    card.className='ops-card';
    card.id='ops-establishment-modules-card';
    card.innerHTML=`<div class="ops-card-head"><div><h2>Módulos do estabelecimento</h2><p class="ops-muted">Ative somente os módulos usados nesta operação. Esta área é carregada separadamente para não bloquear caixa, vendas ou o restante das configurações.</p></div><span class="vertical-rule">Pagamentos manuais · Documentos NÃO FISCAL</span></div><div data-establishment-modules-body><div class="ops-actions"><button id="ops-load-establishment-modules" class="ops-primary" type="button">Gerenciar módulos</button></div></div>`;
    const firstGrid=page.querySelector('.ops-grid');
    if(firstGrid)page.insertBefore(card,firstGrid);else page.appendChild(card);
    card.querySelector('#ops-load-establishment-modules')?.addEventListener('click',()=>{void loadAndRenderSettingsModules(card);});
  }

  function backButton(){return '<button class="secondary-button" type="button" id="vertical-back">← Configurações</button>';}
  function bindBack(){document.getElementById('vertical-back')?.addEventListener('click',()=>{root.PdvOperationalUi?.showRoute?.('settings');});}
  function input(name,label,type='text',extra=''){return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;}
  function normalizeNationalPhoneInput(value){
    let digits=String(value??'').replace(/\D/g,'');
    if(digits.length>11&&digits.startsWith('55'))digits=digits.slice(2);
    return digits;
  }
  function bindNationalPhoneInput(input){
    if(!input)return;
    const normalize=()=>{
      const normalized=normalizeNationalPhoneInput(input.value);
      if(input.value!==normalized)input.value=normalized;
      input.setCustomValidity(normalized&&!/^\d{10,11}$/.test(normalized)?'Telefone deve ter 10 ou 11 dígitos, com DDD e sem o 55.':'');
    };
    input.addEventListener('input',normalize);
    input.addEventListener('paste',event=>{
      const text=event.clipboardData?.getData('text');
      if(text==null)return;
      event.preventDefault();
      input.value=normalizeNationalPhoneInput(text);
      normalize();
    });
    normalize();
  }

  async function renderWorkspace(id){
    if(!modules.find(module=>module.id===id&&module.enabled)){root.PdvOperationalUi?.showRoute?.('settings');return;}
    if(id==='PIZZERIA')return renderPizzeria();
    if(id==='DELIVERY')return renderDelivery();
    if(id==='FAST_FOOD')return renderFastFood();
    if(id==='MARKET_BAKERY')return renderMarket();
    if(id==='RESTAURANT')return renderRestaurantAdvanced();
  }

  function renderPizzeria(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Pizzaria</h1><p>Tamanhos, sabores, bordas e preço por política configurável.</p></div>${backButton()}</header><div class="data-card"><form id="pizza-profile-form" class="vertical-form">${input('productId','ID do produto base')}<label class="field"><span>Política para vários sabores</span><select name="pricingPolicy"><option value="HIGHEST_FLAVOR">Maior preço</option><option value="PROPORTIONAL_AVERAGE">Média proporcional</option></select></label><button class="primary-button" type="submit">Salvar perfil</button></form></div><div class="data-card"><h2>Prévia de preço</h2><form id="pizza-price-form" class="vertical-form">${input('productId','ID do produto')}${input('sizeId','ID do tamanho')}${input('flavors','IDs dos sabores (separados por vírgula)')}${input('crustId','ID da borda')}<button class="primary-button" type="submit">Calcular</button></form><pre id="pizza-price-output" class="vertical-output"></pre></div></section>`;bindBack();
    document.getElementById('pizza-profile-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{await withTimeout(api.savePizzeriaProfile({productId:data.get('productId'),pricingPolicy:data.get('pricingPolicy')}));notify('Perfil de pizzaria salvo.');}catch(error){notify(error.message,true);}});
    document.getElementById('pizza-price-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.pricePizza({productId:data.get('productId'),sizeId:data.get('sizeId'),flavorIds:String(data.get('flavors')||'').split(',').map(v=>v.trim()).filter(Boolean),crustId:data.get('crustId')||null}));document.getElementById('pizza-price-output').textContent=`Preço: R$ ${(result.unitPriceCents/100).toFixed(2).replace('.',',')}`;}catch(error){notify(error.message,true);}});
  }

  async function renderDelivery(){
    const content=document.getElementById('route-content');let orders=[];try{orders=await withTimeout(api.delivery());}catch(error){notify(error.message,true);}
    content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Delivery</h1><p>Entrega e retirada com cobrança registrada manualmente.</p></div>${backButton()}</header><div class="data-card"><form id="delivery-form" class="vertical-form">${input('customerName','Cliente')}${input('phone','Telefone','tel','inputmode="numeric" maxlength="11" pattern="\\d{10,11}" autocomplete="tel-national"')}<label class="field"><span>Atendimento</span><select name="fulfillmentType"><option value="DELIVERY">Entrega</option><option value="PICKUP">Retirada</option></select></label>${input('region','Bairro / região')}${input('fee','Taxa em R$','text','inputmode="decimal"')}<label class="field"><span>Pagamento manual</span><select name="paymentMethod"><option>PIX</option><option value="CASH">Dinheiro</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option><option value="OTHER">Outro</option></select></label><button class="primary-button" type="submit">Criar pedido</button></form></div><div class="data-card"><h2>Pedidos</h2>${orders.map(order=>`<div class="vertical-row"><strong>${escapeHtml(order.customerName)}</strong><span>${escapeHtml(order.fulfillmentType)} · ${escapeHtml(order.status)}</span><span>${escapeHtml(order.paymentMethod||'Sem pagamento definido')}</span></div>`).join('')||'<p class="vertical-empty">Nenhum pedido.</p>'}</div></section>`;bindBack();
    const phoneInput=document.querySelector('#delivery-form [name="phone"]');
    bindNationalPhoneInput(phoneInput);
    document.getElementById('delivery-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const fee=Math.round(Number(String(data.get('fee')||'0').replace(',','.'))*100)||0;const phone=normalizeNationalPhoneInput(data.get('phone'));if(phone&&!/^\d{10,11}$/.test(phone)){notify('Telefone deve ter 10 ou 11 dígitos, com DDD e sem o 55.',true);return;}try{await withTimeout(api.createDelivery({customerName:data.get('customerName'),phone,fulfillmentType:data.get('fulfillmentType'),region:data.get('region'),feeCents:fee,paymentMethod:data.get('paymentMethod'),address:data.get('fulfillmentType')==='DELIVERY'?{description:'Informar endereço no atendimento'}:null}));notify('Pedido criado.');renderDelivery();}catch(error){notify(error.message,true);}});
  }

  async function renderFastFood(){
    const content=document.getElementById('route-content');let orders=[];try{orders=await withTimeout(api.fastFood());}catch(error){notify(error.message,true);}
    content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Fast-food / Lanchonete</h1><p>Senha diária e fila local de produção.</p></div>${backButton()}</header><div class="data-card"><button id="fast-new" class="primary-button" type="button">Nova senha</button></div><div class="data-card"><h2>Fila</h2>${orders.map(order=>`<div class="vertical-row"><strong>Senha ${order.dailyNumber}</strong><span>${escapeHtml(order.status)}</span><div class="vertical-actions">${order.status==='NEW'?`<button data-fast-status="${order.id}:PREPARING">Preparar</button>`:''}${order.status==='PREPARING'?`<button data-fast-status="${order.id}:READY">Pronto</button>`:''}${order.status==='READY'?`<button data-fast-status="${order.id}:DELIVERED">Entregue</button>`:''}</div></div>`).join('')||'<p class="vertical-empty">Fila vazia.</p>'}</div></section>`;bindBack();
    document.getElementById('fast-new').addEventListener('click',async()=>{try{await withTimeout(api.createFastFood({}));renderFastFood();}catch(error){notify(error.message,true);}});content.querySelectorAll('[data-fast-status]').forEach(button=>button.addEventListener('click',async()=>{const[id,status]=button.dataset.fastStatus.split(':');try{await withTimeout(api.updateFastFoodStatus(id,status));renderFastFood();}catch(error){notify(error.message,true);}}));
  }

  function renderMarket(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Mercado / Conveniência / Padaria</h1><p>Itens por peso com entrada manual e balança opcional.</p></div>${backButton()}</header><div class="data-card"><h2>Preço por peso</h2><form id="weight-price-form" class="vertical-form">${input('productId','ID do produto')}${input('grams','Peso em gramas','number','min="1" step="1"')}<button class="primary-button" type="submit">Calcular</button></form><pre id="weight-output" class="vertical-output"></pre></div><div class="data-card"><h2>Ler etiqueta configurada</h2><form id="weight-barcode-form" class="vertical-form">${input('barcode','Código da etiqueta')}<button class="secondary-button" type="submit">Interpretar</button></form><pre id="barcode-output" class="vertical-output"></pre></div></section>`;bindBack();
    document.getElementById('weight-price-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.priceWeighted({productId:data.get('productId'),grams:Number(data.get('grams'))}));document.getElementById('weight-output').textContent=`Total: R$ ${(result.totalCents/100).toFixed(2).replace('.',',')}`;}catch(error){notify(error.message,true);}});
    document.getElementById('weight-barcode-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.parseWeightBarcode({barcode:data.get('barcode')}));document.getElementById('barcode-output').textContent=`Produto ${result.productCode} · ${result.grams} g`;}catch(error){notify(error.message,true);}});
  }

  function renderRestaurantAdvanced(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Restaurante avançado</h1><p>Divisão de conta e transferência seletiva usam as mesmas vendas canônicas do balcão.</p></div>${backButton()}</header><div class="data-card"><h2>Consultar saldo de comanda</h2><form id="restaurant-balance-form" class="vertical-form">${input('sessionId','ID da comanda')}<button class="primary-button" type="submit">Consultar</button></form><pre id="restaurant-output" class="vertical-output"></pre></div></section>`;bindBack();document.getElementById('restaurant-balance-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.restaurantRemaining(data.get('sessionId')));document.getElementById('restaurant-output').textContent=`Saldo: R$ ${(result.totalCents/100).toFixed(2).replace('.',',')} · ${result.items.length} item(ns)`;}catch(error){notify(error.message,true);}});
  }

  const content=document.getElementById('route-content');
  if(content)new MutationObserver(()=>{mountSettingsModules();scheduleSanitize();}).observe(content,{subtree:true,childList:true});
  document.addEventListener('DOMContentLoaded',()=>{mountSettingsModules();scheduleSanitize();},{once:true});
  mountSettingsModules();
  scheduleSanitize();
})();
