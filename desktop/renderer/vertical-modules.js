'use strict';

(() => {
  const root=window;
  const ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  const MODULE_REQUEST_TIMEOUT_MS=5000;
  const ROUTE_RENDERERS={
    RESTAURANT:()=>root.PdvRestaurantUi?.show?.(),
    PIZZERIA:renderPizzeria,
    DELIVERY:renderDelivery,
    FAST_FOOD:renderFastFood,
    MARKET_BAKERY:renderMarket,
    RETAIL:()=>root.PdvFinalModules?.render?.('RETAIL'),
    SERVICES:()=>root.PdvFinalModules?.render?.('SERVICES'),
    SELF_SERVICE:()=>root.PdvFinalModules?.render?.('SELF_SERVICE')
  };
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
  async function loadModules(){const catalog=await withTimeout(api.modules(),MODULE_REQUEST_TIMEOUT_MS,'Não foi possível carregar os módulos dentro do tempo esperado.');root.PdvModuleGate?.reconcile?.(catalog);mergeModuleCatalog(catalog);return modules;}

  function moduleAllowed(module){const role=document.body.dataset.userRole;return Boolean(module&&Array.isArray(module.accessRoles)&&module.accessRoles.includes(role)&&typeof ROUTE_RENDERERS[module.routeId]==='function');}
  const labelFor=module=>module?.name||module?.id||'';
  const areaFor=module=>module?.area&&typeof module.area==='object'?module.area:null;
  const moduleForRoute=routeId=>modules.find(module=>module.routeId===routeId)||null;
  const areaForRoute=routeId=>modules.find(module=>areaFor(module)?.routeId===routeId)?.area||null;
  const modulesInArea=areaId=>modules.filter(module=>areaFor(module)?.id===areaId);
  function mergeModuleCatalog(catalog){if(!Array.isArray(catalog))return false;modules=catalog.map(module=>({...module}));return true;}
  function renderModuleNavigation(){
    const nav=document.getElementById('sidebar-nav');if(!nav)return;
    nav.querySelectorAll('[data-module-nav]').forEach(node=>node.remove());
    document.querySelectorAll('.restaurant-sidebar-entry').forEach(node=>node.remove());
    if(!document.body.dataset.userRole)return;
    const role=document.body.dataset.userRole;const destinations=new Map();
    for(const module of modules){
      if(!module.enabled||!moduleAllowed(module))continue;
      const area=areaFor(module);if(!area)continue;
      const grouped=area.navigation==='group';const target=grouped?area.routeId:module.routeId;
      if(!target)continue;
      if(grouped){const current=destinations.get(target)||{target,label:area.label,icon:area.icon,modules:[]};current.modules.push(module);destinations.set(target,current);}
      else destinations.set(target,{target,label:labelFor(module),icon:module.icon,modules:[module]});
    }
    for(const item of destinations.values()){
      const button=document.createElement('button');button.type='button';button.className='nav-button module-nav-button';button.dataset.moduleNav=item.target;button.dataset.moduleOpen=item.target;button.title=item.label;button.setAttribute('aria-label',item.label);button.dataset.userRole=role||'';button.innerHTML=root.PdvIcon?.(item.icon||'document',23)||'';nav.appendChild(button);
    }
  }
  function refreshModuleNavigation(){renderModuleNavigation();}

  function settingsPage(){
    const content=document.getElementById('route-content');
    const page=content?.querySelector('.ops-page');
    const heading=page?.querySelector('.ops-head h1');
    return heading?.textContent?.trim()==='Configurações'?page:null;
  }

  function settingsModulesCard(){return document.getElementById('ops-establishment-modules-card');}

  function renderSettingsModules(card=settingsModulesCard()){
    if(!card||!card.isConnected)return;
    const body=card.querySelector('[data-establishment-modules-body]');
    if(!body)return;
    const role=document.body.dataset.userRole;
    const groups=new Map();
    for(const module of modules){const area=areaFor(module);if(!area)continue;const group=groups.get(area.id)||{area,modules:[]};group.modules.push(module);groups.set(area.id,group);}
    const renderToggle=module=>{const canManage=Array.isArray(module.manageRoles)&&module.manageRoles.includes(role);return `<label class="vertical-toggle"><span><strong>${escapeHtml(labelFor(module))}</strong><small>${escapeHtml(module.description||'')}${canManage?'':' · Somente administrador pode alterar'}</small></span><input type="checkbox" role="switch" aria-label="Ativar ${escapeHtml(labelFor(module))}" aria-checked="${module.enabled?'true':'false'}" data-module-toggle="${escapeHtml(module.id)}" ${module.enabled?'checked':''} ${canManage?'':'disabled'}></label>`;};
    const activationGroups=[...groups.values()].map(({area,modules:areaModules})=>`<section class="module-family"><div class="module-family-head"><div><h4>${escapeHtml(area.label)}</h4><p>${escapeHtml(area.description||'Recursos que pertencem a esta área do sistema.')}${area.navigation==='group'?' · uma única entrada no menu, com operações internas':''}</p></div><span class="ops-badge">${areaModules.filter(module=>module.enabled).length} de ${areaModules.length} ativas</span></div>${areaModules.map(renderToggle).join('')}</section>`).join('');
    const navigationCards=[...groups.values()].flatMap(({area,modules:areaModules})=>{
      const available=areaModules.filter(module=>module.enabled&&moduleAllowed(module));if(!available.length)return[];
      if(area.navigation==='group')return [`<div class="vertical-card"><strong>${escapeHtml(area.label)}</strong><span>Uma entrada no menu lateral · ${available.map(module=>escapeHtml(labelFor(module))).join(' · ')}</span></div>`];
      return available.map(module=>`<div class="vertical-card"><strong>${escapeHtml(labelFor(module))}</strong><span>Acesso liberado no menu lateral</span></div>`);
    });
    body.innerHTML=`<div class="vertical-layout"><section class="vertical-settings"><div class="module-section-intro"><h3>Ativar recursos</h3><p>A ativação define o que o estabelecimento usa; os recursos compatíveis compartilham a mesma área de trabalho.</p></div>${activationGroups||'<p class="vertical-empty">Nenhum recurso configurável disponível.</p>'}</section><section class="vertical-enabled"><div class="module-section-intro"><h3>Acesso na navegação</h3><p>O menu é montado a partir do mesmo catálogo e das permissões do perfil atual.</p></div><div class="vertical-card-grid">${navigationCards.length?navigationCards.join(''):'<p class="vertical-empty">Nenhuma área opcional está ativa para este perfil.</p>'}</div></section></div>`;
    body.querySelectorAll('[data-module-toggle]').forEach(input=>input.addEventListener('change',async()=>{
      const id=input.dataset.moduleToggle;
      const target=input.checked;
      input.setAttribute('aria-checked',String(target));
      input.disabled=true;
      try{
        await withTimeout(api.saveSetting(`modules.${id}.enabled`,target,'global'),MODULE_REQUEST_TIMEOUT_MS,'A alteração do módulo demorou demais. Nada foi travado; tente novamente.');
        modules=modules.map(module=>module.id===id?{...module,enabled:target}:module);
        renderModuleNavigation();
        renderSettingsModules(card);
        notify(`${labelFor(modules.find(module=>module.id===id))||id} ${target?'ativado':'desativado'}.`);
      }catch(error){
        input.checked=!target;
        input.setAttribute('aria-checked',String(!target));
        input.disabled=false;
        notify(error.message,true);
      }
    }));
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
    card.innerHTML=`<div class="ops-card-head"><div><h2>Módulos do estabelecimento</h2><p class="ops-muted">Configure áreas e recursos do mesmo PDV. As opções alteram a navegação; vendas, estoque e caixa continuam compartilhados.</p></div><span class="vertical-rule">Núcleo local · operação compartilhada</span></div><div data-establishment-modules-body><div class="ops-actions"><button id="ops-load-establishment-modules" class="ops-primary" type="button">Gerenciar módulos</button></div></div>`;
    const firstGrid=page.querySelector('.ops-grid');
    if(firstGrid)page.insertBefore(card,firstGrid);else page.appendChild(card);
    card.querySelector('#ops-load-establishment-modules')?.addEventListener('click',()=>{void loadAndRenderSettingsModules(card);});
  }

  function backButton(){return '<button class="secondary-button" type="button" id="vertical-back">← Início</button>';}
  function bindBack(){document.getElementById('vertical-back')?.addEventListener('click',()=>{const current=moduleForRoute(document.body.dataset.activeModuleWorkspace);const area=areaFor(current);if(area?.navigation==='group'){void renderWorkspace(area.routeId);return;}document.querySelector('#sidebar-nav [data-route="home"]')?.click();});}
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
    const area=areaForRoute(id);
    if(area?.navigation==='group'){
      const available=modulesInArea(area.id).filter(module=>module.enabled&&moduleAllowed(module));
      if(!available.length){document.querySelector('#sidebar-nav [data-route="home"]')?.click();return;}
      document.body.dataset.activeRoute=`module-${String(area.routeId).toLowerCase().replaceAll('_','-')}`;delete document.body.dataset.activeModuleWorkspace;renderModuleNavigation();document.querySelector(`[data-module-nav="${area.routeId}"]`)?.classList.add('active');renderAreaHub(area,available);return;
    }
    const module=moduleForRoute(id);
    if(!module?.enabled||!moduleAllowed(module)){document.querySelector('#sidebar-nav [data-route="home"]')?.click();return;}
    document.body.dataset.activeRoute=`module-${String(module.routeId).toLowerCase().replaceAll('_','-')}`;document.body.dataset.activeModuleWorkspace=module.routeId;renderModuleNavigation();const areaRoute=areaFor(module)?.navigation==='group'?areaFor(module).routeId:module.routeId;document.querySelector(`[data-module-nav="${areaRoute}"]`)?.classList.add('active');
    try {
      return await ROUTE_RENDERERS[module.routeId]();
    } catch(error) {
      const content=document.getElementById('route-content');
      if(content)content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Não foi possível abrir esta área</h1><p>O restante do sistema continua disponível.</p></div>${backButton()}</header><div class="data-card ops-error" role="alert">${escapeHtml(error?.message||'Falha inesperada ao carregar a tela.')}</div><button class="secondary-button" type="button" id="module-retry">Tentar novamente</button></section>`;
      bindBack();document.getElementById('module-retry')?.addEventListener('click',()=>void renderWorkspace(module.routeId));
      notify('A tela não abriu. O sistema continua disponível; tente novamente.',true);
    }
  }

  function renderAreaHub(area,available){
    const content=document.getElementById('route-content');
    content.innerHTML=`<section class="page vertical-page" data-module-area="${escapeHtml(area.id)}"><header class="page-head"><div><h1>${escapeHtml(area.label)}</h1><p>${escapeHtml(area.description||'Operações disponíveis para este estabelecimento.')}. Os recursos abaixo usam o mesmo catálogo, estoque e caixa do ArtiSys.</p></div>${backButton()}</header><div class="food-module-grid">${available.map(module=>`<button type="button" class="data-card food-module-card" data-food-open="${escapeHtml(module.routeId)}"><span>${root.PdvIcon?.(module.icon,28)||''}</span><strong>${escapeHtml(labelFor(module))}</strong><small>${escapeHtml(module.description||'Recurso desta área de trabalho')}</small><span class="secondary-button">Abrir</span></button>`).join('')}</div></section>`;
    bindBack();content.querySelectorAll('[data-food-open]').forEach(button=>button.addEventListener('click',()=>void renderWorkspace(button.dataset.foodOpen)));
  }

  function renderPizzeria(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Pizzaria</h1><p>Tamanhos, sabores, bordas e preço por política configurável.</p></div>${backButton()}</header><div class="data-card"><form id="pizza-profile-form" class="vertical-form">${input('productId','Produto base')}<label class="field"><span>Política para vários sabores</span><select name="pricingPolicy"><option value="HIGHEST_FLAVOR">Maior preço</option><option value="PROPORTIONAL_AVERAGE">Média proporcional</option></select></label><button class="primary-button" type="submit">Salvar perfil</button></form></div><div class="data-card"><h2>Prévia de preço</h2><form id="pizza-price-form" class="vertical-form">${input('productId','Produto')}${input('sizeId','Tamanho')}${input('flavors','Sabores (separados por vírgula)')}${input('crustId','Borda')}<button class="primary-button" type="submit">Calcular</button></form><pre id="pizza-price-output" class="vertical-output"></pre></div></section>`;bindBack();
    document.getElementById('pizza-profile-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{await withTimeout(api.savePizzeriaProfile({productId:data.get('productId'),pricingPolicy:data.get('pricingPolicy')}));notify('Perfil de pizzaria salvo.');}catch(error){notify(error.message,true);}});
    document.getElementById('pizza-price-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.pricePizza({productId:data.get('productId'),sizeId:data.get('sizeId'),flavorIds:String(data.get('flavors')||'').split(',').map(v=>v.trim()).filter(Boolean),crustId:data.get('crustId')||null}));document.getElementById('pizza-price-output').textContent=`Preço: R$ ${(result.unitPriceCents/100).toFixed(2).replace('.',',')}`;}catch(error){notify(error.message,true);}});
  }

  async function renderDelivery(){
    const content=document.getElementById('route-content');let orders=[];try{orders=await withTimeout(api.delivery());}catch(error){notify(error.message,true);}
    content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Delivery</h1><p>Entrega e retirada com cobrança registrada manualmente.</p></div>${backButton()}</header><div class="data-card"><form id="delivery-form" class="vertical-form">${input('customerName','Cliente')}${input('phone','Telefone','tel','inputmode="numeric" pattern="\\d{10,11}" autocomplete="tel-national"')}<label class="field"><span>Atendimento</span><select name="fulfillmentType"><option value="DELIVERY">Entrega</option><option value="PICKUP">Retirada</option></select></label>${input('region','Bairro / região')}${input('fee','Taxa em R$','text','inputmode="decimal"')}<label class="field"><span>Pagamento manual</span><select name="paymentMethod"><option>PIX</option><option value="CASH">Dinheiro</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option><option value="OTHER">Outro</option></select></label><button class="primary-button" type="submit">Criar pedido</button></form></div><div class="data-card"><h2>Pedidos</h2>${orders.map(order=>`<div class="vertical-row"><strong>${escapeHtml(order.customerName)}</strong><span>${escapeHtml(order.fulfillmentType)} · ${escapeHtml(order.status)}</span><span>${escapeHtml(order.paymentMethod||'Sem pagamento definido')}</span></div>`).join('')||'<p class="vertical-empty">Nenhum pedido.</p>'}</div></section>`;bindBack();
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
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Mercado / Conveniência / Padaria</h1><p>Itens por peso com entrada manual e balança opcional.</p></div>${backButton()}</header><div class="data-card"><h2>Preço por peso</h2><form id="weight-price-form" class="vertical-form">${input('productId','Produto')}${input('grams','Peso em gramas','number','min="1" step="1"')}<button class="primary-button" type="submit">Calcular</button></form><pre id="weight-output" class="vertical-output"></pre></div><div class="data-card"><h2>Ler etiqueta configurada</h2><form id="weight-barcode-form" class="vertical-form">${input('barcode','Código da etiqueta')}<button class="secondary-button" type="submit">Interpretar</button></form><pre id="barcode-output" class="vertical-output"></pre></div></section>`;bindBack();
    document.getElementById('weight-price-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.priceWeighted({productId:data.get('productId'),grams:Number(data.get('grams'))}));document.getElementById('weight-output').textContent=`Total: R$ ${(result.totalCents/100).toFixed(2).replace('.',',')}`;}catch(error){notify(error.message,true);}});
    document.getElementById('weight-barcode-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.parseWeightBarcode({barcode:data.get('barcode')}));document.getElementById('barcode-output').textContent=`Produto ${result.productCode} · ${result.grams} g`;}catch(error){notify(error.message,true);}});
  }

  function renderRestaurantAdvanced(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Restaurante avançado</h1><p>Divisão de conta e transferência seletiva usam as mesmas vendas canônicas do balcão.</p></div>${backButton()}</header><div class="data-card"><h2>Consultar saldo de comanda</h2><form id="restaurant-balance-form" class="vertical-form">${input('sessionId','Mesa ou comanda')}<button class="primary-button" type="submit">Consultar</button></form><pre id="restaurant-output" class="vertical-output"></pre></div></section>`;bindBack();document.getElementById('restaurant-balance-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.restaurantRemaining(data.get('sessionId')));document.getElementById('restaurant-output').textContent=`Saldo: R$ ${(result.totalCents/100).toFixed(2).replace('.',',')} · ${result.items.length} item(ns)`;}catch(error){notify(error.message,true);}});
  }

  const content=document.getElementById('route-content');
  root.addEventListener('click',event=>{const target=event.target.closest?.('[data-module-nav]');if(!target)return;const id=target.dataset.moduleNav;if(!areaForRoute(id)&&!moduleForRoute(id))return;event.preventDefault();event.stopImmediatePropagation();void renderWorkspace(id);},true);
  root.addEventListener('artisys:modules-state-changed',event=>{if(!mergeModuleCatalog(event.detail?.catalog))return;renderModuleNavigation();const card=settingsModulesCard();if(card?.querySelector('[data-module-toggle]'))renderSettingsModules(card);});
  root.addEventListener('artisys:sidebar-rendered',()=>{void refreshModuleNavigation();});
  new MutationObserver(()=>{void refreshModuleNavigation();}).observe(document.body,{attributes:true,attributeFilter:['data-user-role']});
  if(content)new MutationObserver(()=>{mountSettingsModules();scheduleSanitize();}).observe(content,{subtree:true,childList:true});
  document.addEventListener('DOMContentLoaded',()=>{mountSettingsModules();scheduleSanitize();},{once:true});
  mountSettingsModules();
  void refreshModuleNavigation();
  root.PdvVerticalModules=Object.freeze({openWorkspace:renderWorkspace,refreshNavigation:refreshModuleNavigation,renderSettingsModules});
  scheduleSanitize();
})();
