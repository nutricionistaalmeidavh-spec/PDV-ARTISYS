'use strict';

(() => {
  const root=window;
  const ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  const lifecycle=root.PdvUiLifecycle;
  const MODULE_REQUEST_TIMEOUT_MS=5000;
  const ROUTE_RENDERERS={
    FOOD:renderFoodWorkspace,
    WHOLESALE:()=>root.PdvWholesaleUi?.show?.(),
    SERVICES:()=>root.PdvFinalModules?.render?.('SERVICES')
  };
  let modules=[];
  const loadingSettingsCards=new WeakSet();
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
    const impactCopy={
      FOOD:'Adiciona Alimentação ao menu com pedidos, Produção/KDS e canais de atendimento. Cardápio, estoque e caixa continuam compartilhados.',
      WHOLESALE:'Adiciona Atacado ao menu para políticas B2B e pedidos. O Balcão continua sendo o caixa e também aplica preço por quantidade em vendas avulsas.',
      SERVICES:'Adiciona Serviços ao menu com agenda, profissionais e comissões, reutilizando clientes, catálogo e caixa.'
    };
    const coreItems=[
      ['Balcão e Caixa','Venda, pagamento e faturamento de comandas e pedidos.'],
      ['Cardápio e Estoque','Produtos, variantes, peso, ficha técnica, insumos e movimentações.'],
      ['Clientes','Cadastro, histórico e limite de crédito.'],
      ['Financeiro e Relatórios','Contas, DRE, indicadores e histórico operacional.']
    ];
    const moduleCard=module=>{
      const canManage=Array.isArray(module.manageRoles)&&module.manageRoles.includes(role);
      const status=module.enabled?'Ativa':'Desativada';
      const included=module.id==='FOOD'?'<div class="module-included" aria-label="Recursos incluídos com Alimentação"><strong>Incluído ao ativar</strong><span>✓ Pedidos</span><span>✓ Produção / KDS</span><span>✓ Mesas, balcão, retirada, entrega e autoatendimento como canais</span></div>':'';
      return `<article class="module-family" data-module-config="${escapeHtml(module.id)}"><div class="module-family-head"><div><h4>${escapeHtml(labelFor(module))}</h4><p>${escapeHtml(module.description||'')}</p></div><span class="ops-badge" data-module-status="${escapeHtml(module.id)}">${status}</span></div><p class="vertical-rule">${escapeHtml(impactCopy[module.id]||'Esta área aparece na navegação quando está ativa.')}</p><label class="vertical-toggle"><span><strong>${module.enabled?'Área ativa':'Ativar área'}</strong><small>${canManage?'A alteração vale para este estabelecimento.':'Somente administrador pode alterar esta área.'}</small></span><input type="checkbox" role="switch" aria-label="Ativar ${escapeHtml(labelFor(module))}" aria-checked="${module.enabled?'true':'false'}" data-module-toggle="${escapeHtml(module.id)}" ${module.enabled?'checked':''} ${canManage?'':'disabled'}></label>${included}</article>`;
    };
    body.innerHTML=`<div class="module-config-summary"><section class="module-family" data-core-area="true"><div class="module-family-head"><div><h3>Núcleo ArtiSys</h3><p>Estes recursos são sempre compartilhados. Não precisam ser ativados como módulos.</p></div><span class="ops-badge">Sempre ativo</span></div><div class="vertical-card-grid">${coreItems.map(([title,detail])=>`<div class="vertical-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`).join('')}</div></section><section class="vertical-settings"><div class="module-section-intro"><h3>Áreas opcionais</h3><p>Ative somente os fluxos que realmente mudam a operação. O menu lateral se atualiza imediatamente.</p></div>${modules.map(moduleCard).join('')||'<p class="vertical-empty">Nenhuma área configurável disponível.</p>'}</section></div>`;
    body.querySelectorAll('[data-module-toggle]').forEach(input=>input.addEventListener('change',async()=>{
      const id=input.dataset.moduleToggle;
      const target=input.checked;
      input.setAttribute('aria-checked',String(target));
      input.disabled=true;
      try{
        await withTimeout(api.saveSetting(`modules.${id}.enabled`,target,'global'),MODULE_REQUEST_TIMEOUT_MS,'A alteração da área demorou demais. Nada foi travado; tente novamente.');
        modules=modules.map(module=>module.id===id?{...module,enabled:target}:module);
        renderModuleNavigation();
        renderSettingsModules(card);
        notify(`${labelFor(modules.find(module=>module.id===id))||id} ${target?'ativada':'desativada'}.`);
      }catch(error){
        input.checked=!target;
        input.setAttribute('aria-checked',String(!target));
        input.disabled=false;
        notify(error.message,true);
      }
    }));
  }

  async function loadAndRenderSettingsModules(card=settingsModulesCard()){
    if(!card||loadingSettingsCards.has(card))return;
    const body=card.querySelector('[data-establishment-modules-body]');
    if(!body)return;
    loadingSettingsCards.add(card);
    body.innerHTML='<div class="ops-loader"></div><p class="ops-muted">Carregando áreas do estabelecimento…</p>';
    try{
      await loadModules();
      if(card.isConnected)renderSettingsModules(card);
    }catch(error){
      if(card.isConnected){
        body.innerHTML=`<div class="ops-error">${escapeHtml(error.message)}</div><div class="ops-actions"><button type="button" class="ops-secondary" data-modules-retry>Tentar novamente</button></div>`;
        body.querySelector('[data-modules-retry]')?.addEventListener('click',()=>{void loadAndRenderSettingsModules(card);});
      }
      notify(error.message,true);
    }finally{loadingSettingsCards.delete(card);}
  }

  function mountSettingsModules(){
    const page=settingsPage();
    if(!page||page.querySelector('#ops-establishment-modules-card'))return;
    const card=document.createElement('section');
    card.className='ops-card';
    card.id='ops-establishment-modules-card';
    card.dataset.settingsCategory='modules';
    card.innerHTML=`<div class="ops-card-head"><div><h2>Áreas do estabelecimento</h2><p class="ops-muted">O núcleo de venda, caixa, catálogo, estoque, clientes, financeiro e relatórios é único. Aqui você ativa somente fluxos adicionais.</p></div><span class="vertical-rule">Uma operação · um caixa · áreas opcionais</span></div><div data-establishment-modules-body><div class="ops-loader"></div><p class="ops-muted">Carregando áreas do estabelecimento…</p></div>`;
    const firstGrid=page.querySelector('.ops-grid');
    if(firstGrid)page.insertBefore(card,firstGrid);else page.appendChild(card);
    root.PdvRouteRegistry?.updated('settings',{surface:'settings-extension',extension:'vertical-modules'});
    void loadAndRenderSettingsModules(card);
  }

  function backButton(){return `<button class="secondary-button" type="button" id="vertical-back">← ${document.body.dataset.activeModuleWorkspace==='FOOD'?'Alimentação':'Início'}</button>`;}
  function bindBack(){document.getElementById('vertical-back')?.addEventListener('click',()=>{if(document.body.dataset.activeModuleWorkspace==='FOOD'){renderFoodWorkspace();return;}document.querySelector('#sidebar-nav [data-route="home"]')?.click();});}
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
      document.body.dataset.activeRoute=`module-${String(area.routeId).toLowerCase().replaceAll('_','-')}`;delete document.body.dataset.activeModuleWorkspace;renderModuleNavigation();document.querySelector(`[data-module-nav="${area.routeId}"]`)?.classList.add('active');renderAreaHub(area,available);lifecycle?.emit('surface:mounted',{surface:'module-area',areaId:area.id,routeId:area.routeId});return;
    }
    const module=moduleForRoute(id);
    if(!module?.enabled||!moduleAllowed(module)){document.querySelector('#sidebar-nav [data-route="home"]')?.click();return;}
    document.body.dataset.activeRoute=`module-${String(module.routeId).toLowerCase().replaceAll('_','-')}`;document.body.dataset.activeModuleWorkspace=module.routeId;renderModuleNavigation();const areaRoute=areaFor(module)?.navigation==='group'?areaFor(module).routeId:module.routeId;document.querySelector(`[data-module-nav="${areaRoute}"]`)?.classList.add('active');
    try {
      const result=await ROUTE_RENDERERS[module.routeId]();
      lifecycle?.emit('surface:mounted',{surface:'module-workspace',moduleId:module.id,routeId:module.routeId});
      return result;
    } catch(error) {
      const content=document.getElementById('route-content');
      if(content)content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Não foi possível abrir esta área</h1><p>O restante do sistema continua disponível.</p></div>${backButton()}</header><div class="data-card ops-error" role="alert">${escapeHtml(error?.message||'Falha inesperada ao carregar a tela.')}</div><button class="secondary-button" type="button" id="module-retry">Tentar novamente</button></section>`;
      bindBack();document.getElementById('module-retry')?.addEventListener('click',()=>void renderWorkspace(module.routeId));
      notify('A tela não abriu. O sistema continua disponível; tente novamente.',true);
    }
  }

  function renderFoodWorkspace(){
    const content=document.getElementById('route-content');if(!content)return;
    document.body.dataset.activeModuleWorkspace='FOOD';
    content.innerHTML=`<section class="page vertical-page" data-module-area="FOOD"><header class="page-head"><div><h1>Alimentação</h1><p>Pedidos e produção usam o mesmo Cardápio, Estoque e Caixa do ArtiSys. Produção/KDS faz parte do módulo e não precisa ser ativada separadamente.</p></div><button class="secondary-button" type="button" id="food-home">← Início</button></header><div class="data-card"><h2>Incluído no módulo</h2><div class="vertical-card-grid"><div class="vertical-card"><strong>Pedidos</strong><span>Fluxo comum para os canais de atendimento.</span></div><div class="vertical-card"><strong>Produção / KDS</strong><span>Fila e setores de produção disponíveis automaticamente.</span></div><div class="vertical-card"><strong>Integração operacional</strong><span>Cardápio, ficha técnica, estoque, venda e caixa permanecem canônicos.</span></div></div></div><div class="data-card"><h2>Como o estabelecimento atende</h2><p class="vertical-rule">Abra somente o fluxo necessário agora. Estes são modos de operação da mesma Alimentação, não módulos independentes.</p><div class="food-module-grid"><button type="button" class="data-card food-module-card" data-food-capability="RESTAURANT"><span>${root.PdvIcon?.('store',28)||''}</span><strong>Mesas e comandas</strong><small>Salão, comandas, pedidos e acompanhamento da produção.</small><span class="secondary-button">Abrir</span></button><button type="button" class="data-card food-module-card" data-food-capability="FAST_FOOD"><span>${root.PdvIcon?.('cash',28)||''}</span><strong>Balcão e senhas</strong><small>Atendimento rápido com senha e fila de retirada.</small><span class="secondary-button">Abrir</span></button><button type="button" class="data-card food-module-card" data-food-capability="DELIVERY"><span>${root.PdvIcon?.('document',28)||''}</span><strong>Entrega e retirada</strong><small>Pedidos para entrega ou retirada no estabelecimento.</small><span class="secondary-button">Abrir</span></button><button type="button" class="data-card food-module-card" data-food-capability="SELF_SERVICE"><span>${root.PdvIcon?.('document',28)||''}</span><strong>Autoatendimento</strong><small>Pedidos iniciados pelo cliente em dispositivo pareado.</small><span class="secondary-button">Abrir</span></button><button type="button" class="data-card food-module-card" data-food-capability="PIZZERIA"><span>${root.PdvIcon?.('document',28)||''}</span><strong>Personalização de pizza</strong><small>Tamanhos, sabores, bordas e política de preço como capacidade do produto.</small><span class="secondary-button">Abrir</span></button></div></div></section>`;
    content.querySelector('#food-home')?.addEventListener('click',()=>document.querySelector('#sidebar-nav [data-route="home"]')?.click());
    content.querySelectorAll('[data-food-capability]').forEach(button=>button.addEventListener('click',()=>void renderFoodCapability(button.dataset.foodCapability)));
  }

  async function renderFoodCapability(id){
    document.body.dataset.activeModuleWorkspace='FOOD';
    if(id==='RESTAURANT')return root.PdvRestaurantUi?.show?.();
    if(id==='FAST_FOOD')return renderFastFood();
    if(id==='DELIVERY')return renderDelivery();
    if(id==='SELF_SERVICE')return root.PdvFinalModules?.render?.('SELF_SERVICE');
    if(id==='PIZZERIA')return renderPizzeria();
  }

  function renderAreaHub(area,available){
    const content=document.getElementById('route-content');
    content.innerHTML=`<section class="page vertical-page" data-module-area="${escapeHtml(area.id)}"><header class="page-head"><div><h1>${escapeHtml(area.label)}</h1><p>${escapeHtml(area.description||'Operações disponíveis para este estabelecimento.')}. Os recursos abaixo usam o mesmo catálogo, estoque e caixa do ArtiSys.</p></div>${backButton()}</header><div class="food-module-grid">${available.map(module=>`<button type="button" class="data-card food-module-card" data-food-open="${escapeHtml(module.routeId)}"><span>${root.PdvIcon?.(module.icon,28)||''}</span><strong>${escapeHtml(labelFor(module))}</strong><small>${escapeHtml(module.description||'Recurso desta área de trabalho')}</small><span class="secondary-button">Abrir</span></button>`).join('')}</div></section>`;
    bindBack();content.querySelectorAll('[data-food-open]').forEach(button=>button.addEventListener('click',()=>void renderWorkspace(button.dataset.foodOpen)));
  }

  function renderPizzeria(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Personalização de pizza</h1><p>Tamanhos, sabores, bordas e política de preço dentro do módulo Alimentação.</p></div>${backButton()}</header><div class="data-card"><form id="pizza-profile-form" class="vertical-form">${input('productId','Produto base')}<label class="field"><span>Política para vários sabores</span><select name="pricingPolicy"><option value="HIGHEST_FLAVOR">Maior preço</option><option value="PROPORTIONAL_AVERAGE">Média proporcional</option></select></label><button class="primary-button" type="submit">Salvar perfil</button></form></div><div class="data-card"><h2>Prévia de preço</h2><form id="pizza-price-form" class="vertical-form">${input('productId','Produto')}${input('sizeId','Tamanho')}${input('flavors','Sabores (separados por vírgula)')}${input('crustId','Borda')}<button class="primary-button" type="submit">Calcular</button></form><pre id="pizza-price-output" class="vertical-output"></pre></div></section>`;bindBack();
    document.getElementById('pizza-profile-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{await withTimeout(api.savePizzeriaProfile({productId:data.get('productId'),pricingPolicy:data.get('pricingPolicy')}));notify('Personalização de pizza salva.');}catch(error){notify(error.message,true);}});
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
