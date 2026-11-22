'use strict';

(()=>{
  const root=window;const {ApiClient}=root.PdvApiClient||{};const composer=root.PdvOrderComposer;if(!ApiClient||!composer)return;
  const api=new ApiClient();const ui=root.PdvUiModel;const content=document.getElementById('route-content');const modalRoot=document.getElementById('modal-root');
  let config=null;let selectedSessionId=null;let latestCredential=null;let latestPairing=null;let activeView='operation';let draftSessionId=null;const draftCart=composer.createCart();
  let data={tables:[],requests:[],stations:[],tickets:[],devices:[],users:[],customers:[],products:[],routes:[],report:{}};
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
  const money=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const qty=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const stamp=value=>{if(!value)return '—';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});};
  function toast(message,type=''){root.PdvToast?.show?.(message,type);}
  function status(value){const fallback={CLOSED:'Encerrado',DIRECT:'Atendimento direto'}[String(value||'').toUpperCase()]||String(value||'');const label=ui?.statusLabel?.(value,fallback)||fallback;return `<span class="restaurant-status ${esc(value)}">${esc(label)}</span>`;}
  const deviceTypeLabel=value=>ui?.deviceTypeLabel?.(value,String(value||'Dispositivo'))||String(value||'Dispositivo');
  const sourceLabel=value=>({WAITER:'Garçom',TABLE:'Mesa',PUBLIC_QR:'Cardápio QR',POS:'Balcão',COUNTER:'Balcão',DELIVERY:'Delivery',PICKUP:'Retirada'})[String(value||'').toUpperCase()]||String(value||'Pedido');
  function orderStatus(order){const production=(order?.items||[]).filter(item=>item.productionMode==='PRODUCTION');return (order?.items||[]).length&&!production.length?status('DIRECT'):status(order?.status||'NEW');}
  function canManageRestaurant(){return Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,'restaurant.access')&&root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,'settings.manage'));}
  function canManageTables(){return Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,'restaurant.tables.manage'));}
  const hasPermission=capability=>Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,capability));
  function canTransfer(){return hasPermission('restaurant.orders.transfer');}
  function canUpdateKitchen(){return hasPermission('kitchen.update_status');}
  function canManageRequests(){return hasPermission('restaurant.service.manage');}
  function canEditItems(){return hasPermission('restaurant.orders.edit');}
  function canCancelSession(){return hasPermission('restaurant.sessions.cancel');}
  function userName(id){return data.users.find(user=>user.id===id)?.name||'Sem responsável';}
  function elapsed(value){if(!value)return'';const ms=Date.now()-Date.parse(value);if(!Number.isFinite(ms)||ms<0)return'';const minutes=Math.floor(ms/60000);return minutes<60?`${minutes} min`:`${Math.floor(minutes/60)}h ${minutes%60}min`;}
  function operatorId(){const saved=localStorage.getItem('artisys.restaurant.operatorId');const valid=data.users.find(user=>user.id===saved&&user.active!==false);const currentId=String(root.PdvCurrentAccess?.id||'');const current=data.users.find(user=>user.id===currentId&&user.active!==false);const chosen=canManageTables()?(valid||current||data.users.find(user=>user.active!==false)):current;if(chosen&&saved!==chosen.id)localStorage.setItem('artisys.restaurant.operatorId',chosen.id);return chosen?.id||currentId;}
  function userOptions(selected='',allowEmpty=false){return `${allowEmpty?'<option value="">Sem responsável</option>':''}${data.users.filter(user=>user.active!==false).map(user=>`<option value="${esc(user.id)}" ${String(user.id)===String(selected)?'selected':''}>${esc(user.name)}</option>`).join('')}`;}
  function customerOptions(selected=''){return `<option value="">Cliente não informado</option>${data.customers.filter(customer=>customer.active!==false).map(customer=>`<option value="${esc(customer.id)}" ${String(customer.id)===String(selected)?'selected':''}>${esc(customer.name)}</option>`).join('')}`;}
  function draftRows(){const lines=draftCart.lines();if(!lines.length)return '<div class="restaurant-empty">Adicione um ou mais itens antes de enviar.</div>';return lines.map(line=>`<div class="restaurant-row restaurant-draft-line" data-draft-line="${esc(line.id)}"><div><strong>${Number(line.quantity).toLocaleString('pt-BR',{maximumFractionDigits:3})}× ${esc(line.name)}</strong><small>${line.note?esc(line.note):'Sem observação'} · ${money(line.unitPriceCents)} un.</small></div><div class="restaurant-actions"><button class="restaurant-btn secondary" type="button" data-draft-minus="${esc(line.id)}">−</button><button class="restaurant-btn secondary" type="button" data-draft-plus="${esc(line.id)}">+</button><strong>${money(Math.round(line.unitPriceCents*line.quantity))}</strong></div></div>`).join('');}
  async function request(path,options={}){return api.request(path,options);}
  async function load(){config=config||await api.initialize();const results=await Promise.all([
    request('/api/v1/restaurant/tables'),request('/api/v1/restaurant/requests'),request('/api/v1/restaurant/kitchen/stations'),request('/api/v1/restaurant/kitchen/tickets?limit=250'),(hasPermission('devices.view')?request('/api/v1/restaurant/devices'):Promise.resolve([])),request('/api/v1/restaurant/reports/summary'),api.users(true).catch(()=>[]),api.customers(false).catch(()=>[]),api.products(false).then(items=>items.filter(product=>product.menuEnabled)).catch(()=>[]),request('/api/v1/restaurant/kitchen/routing')
  ]);[data.tables,data.requests,data.stations,data.tickets,data.devices,data.report,data.users,data.customers,data.products,data.routes]=results;
    const logged=root.PdvCurrentAccess;
    if(logged?.id&&!data.users.some(user=>user.id===logged.id))data.users.push({id:String(logged.id),name:logged.name||'Operador atual',active:true});
  }
  async function show(sessionId=null){if(sessionId)selectedSessionId=String(sessionId);document.body.classList.remove('theme-home');activeView='operation';content.innerHTML='<section class="restaurant-page"><div class="restaurant-card">Carregando mesas e comandas…</div></section>';try{await load();await render();if(sessionId)document.getElementById('restaurant-detail')?.scrollIntoView({behavior:'smooth',block:'start'});}catch(error){content.innerHTML=`<section class="restaurant-page"><div class="restaurant-card"><h2>Não foi possível carregar</h2><p>${esc(error.message)}</p></div></section>`;toast(error.message,'error');}}
  function kpi(label,value){return `<div class="restaurant-kpi"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;}
  function tableCard(table){const production=table.productionStatus?`<span class="restaurant-production-state">${status(table.productionStatus)}${table.readyItems?`<small class="restaurant-ready-count">${table.readyItems} pronto(s)</small>`:''}</span>`:'';const context=[table.partySize?`${table.partySize} pessoa(s)`:'',table.customerName||'',table.waiterId?data.users.find(user=>user.id===table.waiterId)?.name||'Responsável definido':''].filter(Boolean).join(' · ');return `<div class="restaurant-table-shell"><button type="button" class="restaurant-table" data-table-id="${esc(table.id)}"><strong>${esc(table.label)}</strong><div>${status(table.status)}${production}</div><small>${table.seats?`${table.seats} lugares · `:''}${money(table.totalCents||0)}</small><small>${context?esc(context):table.openedAt?`Aberta ${stamp(table.openedAt)}`:'Disponível'}</small></button>${canManageTables()?`<button type="button" class="restaurant-btn secondary restaurant-table-qr" data-open-table-qr="${esc(table.id)}" aria-label="Ver QR da ${esc(table.label)}">Ver QR desta mesa</button>`:''}</div>`;}
  function requestRows(){return data.requests.filter(row=>row.status!=='CLOSED').map(row=>`<div class="restaurant-row"><div><strong>${esc(row.tableLabel)} · ${esc(row.requestType)}</strong><small>${stamp(row.createdAt)}</small></div><div>${status(row.status)} ${canManageRequests()&&row.status==='OPEN'?`<button class="restaurant-btn secondary" data-request-ack="${esc(row.id)}">Atender</button>`:''}</div></div>`).join('')||'<div class="restaurant-empty">Sem chamados pendentes.</div>';}
  function ticketRows(){return data.tickets.filter(t=>t.status!=='CANCELLED').slice(0,40).map(ticket=>`<div class="restaurant-row"><div><strong>${esc(ticket.tableLabel)} · ${esc(ticket.stationName)}</strong><div class="restaurant-order-items">${ticket.items.map(i=>`${i.quantity}× ${esc(i.productName)}${i.note?` (${esc(i.note)})`:''}`).join(' · ')}</div></div><div>${status(ticket.status)} ${canUpdateKitchen()&&ticket.status==='NEW'?`<button class="restaurant-btn secondary" data-ticket-status="${esc(ticket.id)}" data-next="PREPARING">Iniciar</button>`:''}${canUpdateKitchen()&&!['READY','CANCELLED'].includes(ticket.status)?`<button class="restaurant-btn secondary" data-ticket-status="${esc(ticket.id)}" data-next="READY">Pronto</button>`:''}</div></div>`).join('')||'<div class="restaurant-empty">Sem pedidos na cozinha.</div>';}
  function render(){
    const op=operatorId();const back=document.body.dataset.activeModuleWorkspace==='FOOD'?'<button class="restaurant-btn secondary" type="button" data-food-back>← Alimentação</button>':'';
    if(!canManageRestaurant()&&activeView==='management')activeView='operation';
    const viewSwitch=`<div class="restaurant-view-switch" role="tablist" aria-label="Visão de Mesas e comandas"><button class="restaurant-btn ${activeView==='operation'?'':'secondary'}" type="button" role="tab" aria-selected="${activeView==='operation'}" data-restaurant-view-target="operation">Operação</button>${canManageRestaurant()?`<button class="restaurant-btn ${activeView==='management'?'':'secondary'}" type="button" role="tab" aria-selected="${activeView==='management'}" data-restaurant-view-target="management">Configuração</button>`:''}</div>`;
    const operationActions=activeView==='operation'?`<select id="restaurant-operator" class="ops-input compact" aria-label="Operador da comanda">${data.users.filter(u=>canManageTables()||u.id===root.PdvCurrentAccess?.id).map(u=>`<option value="${esc(u.id)}" ${u.id===op?'selected':''}>${esc(u.name)}</option>`).join('')}</select>${canManageTables()?`<button class="restaurant-btn" data-new-table>Nova mesa</button>`:''}`:'';
    content.innerHTML=`<section class="restaurant-page" data-restaurant-view="${esc(activeView)}"><header class="restaurant-head"><div><h1>Mesas e comandas</h1><p>${activeView==='operation'?'Abra mesas, registre pedidos e acompanhe atendimento e produção.':'Configure produção e dispositivos. O QR de cada mesa está no mapa da operação ou em Configurações.'}</p></div><div class="restaurant-actions">${back}${viewSwitch}${operationActions}<button class="restaurant-btn secondary" data-refresh>Atualizar</button></div></header>${activeView==='management'?renderManagement():renderOperation()}</section>`;
    bind();
    root.PdvUiLifecycle?.emit?.('surface:mounted',{surface:'restaurant',view:activeView});
    if(activeView==='operation'&&selectedSessionId)return renderSession(selectedSessionId);
  }
  function renderOperation(){
    const r=data.report||{};
    return `<div class="restaurant-kpis">${kpi('Mesas ocupadas',String(r.occupiedTables||0))}${kpi('Pedidos',String(r.ordersCount||0))}${kpi('Pedidos bruto',money(r.grossCents||0))}${kpi('Chamados abertos',String(r.openServiceRequests||0))}</div><section class="restaurant-card"><h2>Mapa de mesas</h2><div class="restaurant-grid">${data.tables.map(tableCard).join('')||'<div class="restaurant-empty">Cadastre a primeira mesa.</div>'}</div></section><div id="restaurant-detail"></div><div class="restaurant-columns"><section class="restaurant-card"><h2>Chamados de atendimento</h2><div class="restaurant-list">${requestRows()}</div></section><section class="restaurant-card"><h2>Cozinha / KDS</h2><div class="restaurant-list">${ticketRows()}</div></section></div>`;
  }
  function routingConfigurationAlert(routes) {
    const pending=data.products.filter(product=>!routes.get(product.id)?.mode);
    if(!pending.length)return '';
    const count=pending.length;
    const visible=pending.slice(0,5);
    const remainder=count-visible.length;
    const names=visible.map(product=>esc(product.name)).join(' · ');
    return `<aside class="restaurant-routing-alert" data-routing-alert role="status" aria-live="polite"><div><strong>${count} ${count===1?'produto sem destino configurado':'produtos sem destino configurado'}</strong><small>${names}${remainder>0?` · e mais ${remainder}`:''}</small><p>Configure o destino no cadastro do Estoque antes de usar estes itens em pedidos.</p></div><button type="button" class="restaurant-btn warn" data-routing-review="${esc(pending[0].id)}">Revisar no Estoque</button></aside>`;
  }

  function renderManagement(){
    if(!canManageRestaurant()){activeView='operation';return renderOperation();}
    const routes=new Map((data.routes||[]).map(route=>[route.productId,route]));
    return `<section class="restaurant-management admin-surface" data-restaurant-management data-admin-surface="restaurant"><header class="restaurant-management-head admin-section-head"><div><h2>Configuração e indicadores</h2><p>Recursos de implantação e acompanhamento ficam separados da rotina de salão.</p></div></header><div class="restaurant-card"><strong>Procurando o QR Code das mesas?</strong><p>Ele continua vinculado a cada mesa e comanda. Use Ver QR desta mesa no mapa da operação ou acesse Configurações → Cardápio público e QR.</p><button type="button" class="restaurant-btn secondary" data-qr-settings-shortcut>Abrir Cardápio público e QR</button></div>${routingConfigurationAlert(routes)}${renderAdmin()}${renderReport()}</section>`;
  }
  function renderAdmin(){
    const tables=data.tables;
    const stations=data.stations;
    return `<div class="restaurant-columns admin-section-grid"><section class="restaurant-card admin-section-card"><h2>Setores de produção</h2><p class="helper">Crie os destinos disponíveis para itens preparados. O vínculo de cada produto é definido no Estoque.</p><form id="station-form" class="restaurant-form"><label>Nome do setor<input name="name" placeholder="Cozinha, bar, sobremesa" required></label><label>Impressora (opcional)<input name="printerName" placeholder="Nome do Windows"></label><button class="restaurant-btn" type="submit">Criar setor</button></form><div class="restaurant-list">${stations.map(s=>`<div class="restaurant-row"><div><strong>${esc(s.name)}</strong><small>${esc(s.printerName||'KDS sem impressora dedicada')}</small></div>${status(s.active?'ACTIVE':'INACTIVE')}</div>`).join('')||'<div class="restaurant-empty">Nenhum setor configurado.</div>'}</div></section><section class="restaurant-card admin-section-card"><h2>Dispositivos LAN</h2><form id="device-form" class="restaurant-form"><label>Nome<input name="name" placeholder="Garçom 01 / Tablet Mesa 4" required></label><label>Tipo<select name="deviceType"><option value="WAITER">Garçom / Tablet da equipe</option><option value="KITCHEN">KDS cozinha</option></select></label><p class="helper">Tablet de cliente: use o QR da mesa, sem cadastrar dispositivo. Garçom e KDS usam o pareamento abaixo.</p><label>Usuário (garçom)<select name="userId"><option value="">—</option>${data.users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label><button class="restaurant-btn" type="submit">Criar dispositivo</button></form><div class="restaurant-pairing-diagnostics"><button type="button" class="restaurant-btn secondary" data-diagnose-lan>Testar rede para celulares</button><p data-lan-diagnostics role="status">O celular precisa estar no Wi-Fi da loja, sem isolamento de clientes. Use o teste para verificar o servidor local.</p></div>${latestCredential?`<div class="restaurant-credential"><strong>Dispositivo preparado para conexão</strong>${latestPairing?`<div class="restaurant-pairing"><strong>Escaneie este QR com o celular no Wi-Fi da loja</strong><div class="restaurant-pairing-preview">${latestPairing.qrSvg}</div><p>O QR é temporário (2 minutos), de uso único e não contém a chave permanente. Após ler, o celular será conectado automaticamente.</p><small>Se expirar, escolha Conectar por QR no dispositivo desejado para gerar outro código e substituir a credencial anterior.</small></div>`:'<p>QR indisponível. Confira se o PC está configurado como principal da rede; a conexão manual continua disponível.</p>'}<details class="restaurant-credentials-advanced"><summary>Conexão manual (avançado)</summary><p>Credencial exibida uma única vez. Não compartilhe estas informações.</p><code>ID: ${esc(latestCredential.id)}</code><code>Chave: ${esc(latestCredential.credential)}</code><small>Abra http://IP-DO-SERVIDOR:4174/mobile no dispositivo e informe os dados acima.</small></details></div>`:''}<div class="restaurant-list">${data.devices.slice(0,30).map(d=>`<div class="restaurant-row"><div><strong>${esc(d.name)}</strong><small>${esc(deviceTypeLabel(d.deviceType))}${d.tableId?` · ${esc(data.tables.find(t=>t.id===d.tableId)?.label||d.tableId)}`:''}</small></div><div>${status(d.status)} <button class="restaurant-btn secondary" data-device-pair="${esc(d.id)}">Conectar por QR</button><button class="restaurant-btn secondary" data-device-rotate="${esc(d.id)}">Nova chave</button>${d.status==='ACTIVE'?`<button class="restaurant-btn danger" data-device-status="${esc(d.id)}" data-next="BLOCKED">Bloquear</button>`:`<button class="restaurant-btn secondary" data-device-status="${esc(d.id)}" data-next="ACTIVE">Ativar</button>`}</div></div>`).join('')||'<div class="restaurant-empty">Nenhum dispositivo cadastrado.</div>'}</div></section></div>`;
  }
  function renderReport(){const r=data.report||{};return `<section class="restaurant-card admin-section-card"><div class="restaurant-head"><div><h2>Indicadores do restaurante</h2><p>Calculados diretamente das comandas locais.</p></div><button id="restaurant-export" class="restaurant-btn secondary">Exportar pedidos CSV</button></div><div class="restaurant-list">${(r.topProducts||[]).slice(0,10).map(p=>`<div class="restaurant-row"><div><strong>${esc(p.productName)}</strong><small>${Number(p.quantity||0).toLocaleString('pt-BR',{maximumFractionDigits:3})} unidades</small></div><strong>${money(p.grossCents)}</strong></div>`).join('')||'<div class="restaurant-empty">Sem pedidos no período.</div>'}</div></section>`;}
  async function renderSession(sessionId){
    const host=document.getElementById('restaurant-detail');if(!host)return;
    try{
      const session=await request(`/api/v1/restaurant/sessions/${encodeURIComponent(sessionId)}`);
      selectedSessionId=session.id;if(draftSessionId!==session.id){draftSessionId=session.id;draftCart.clear();}
      const free=data.tables.filter(t=>t.status==='FREE'&&t.id!==session.tableId);
      const occupied=data.tables.filter(t=>['OCCUPIED','BILL_REQUESTED'].includes(t.status)&&t.sessionId&&t.id!==session.tableId);
      const remaining=await api.restaurantRemaining(session.id).catch(()=>({items:[],totalCents:session.totalCents}));
      const draftItems=draftCart.lines();const draftTotal=draftCart.summary().totalCents;
      const editableItems=new Set((remaining.items||[]).map(item=>String(item.orderItemId)));
      const open=session.status==='OPEN';
      host.innerHTML=`<section class="restaurant-card restaurant-session"><div class="restaurant-head"><div><h2>${esc(session.tableLabel)} · Comanda</h2><p>Aberta há ${esc(elapsed(session.openedAt)||stamp(session.openedAt))} · ${status(session.status)}</p></div><div class="restaurant-actions"><button class="restaurant-btn secondary" data-prebill="${esc(session.id)}">Pré-conta</button><button class="restaurant-btn warn" data-bill="${esc(session.tableId)}">Solicitar conta</button><button class="restaurant-btn" data-checkout="${esc(session.id)}">Levar ao caixa</button>${open&&canCancelSession()?`<button class="restaurant-btn danger" type="button" data-cancel-comanda="${esc(session.id)}">Cancelar comanda</button>`:''}</div></div>
      ${canManageTables()?`<form id="restaurant-session-details-form" class="restaurant-waiter-bar"><label>Pessoas<input name="partySize" type="number" min="1" max="50" step="1" value="${esc(session.partySize||1)}" required></label><label>Cliente (opcional)<select name="customerId">${customerOptions(session.customerId||'')}</select></label><button class="restaurant-btn secondary" type="submit">Atualizar atendimento</button></form>
      <form id="restaurant-waiter-form" class="restaurant-waiter-bar"><label>Garçom responsável<select name="waiterId">${userOptions(session.waiterId||'',true)}</select></label><button class="restaurant-btn secondary" type="submit">Atualizar responsável</button><span>Aberta por ${esc(userName(session.openedBy))}</span></form>
`:''}
      <div class="restaurant-session-layout"><div><h3>Pedidos lançados</h3><div class="restaurant-list">${session.orders.map(o=>`<div class="restaurant-row"><div><strong>${esc(sourceLabel(o.source))} · ${stamp(o.createdAt)}</strong><div class="restaurant-order-items">${o.items.map(i=>`<span>${qty(i.quantity)}× ${esc(i.productName)}${i.note?` · ${esc(i.note)}`:''} ${open&&o.status!=='CANCELLED'&&canEditItems()&&editableItems.has(String(i.id))?`<button class="restaurant-btn secondary" type="button" data-edit-comanda-item="${esc(i.id)}">Editar</button>`:''} </span>`).join(' · ')}</div></div><div>${orderStatus(o)} <strong>${money(o.totalCents)}</strong></div></div>`).join('')||'<div class="restaurant-empty">Comanda sem pedidos.</div>'}</div><div class="restaurant-session-total"><span>Total da comanda</span><strong>${money(session.totalCents)}</strong></div></div>
      <div><h3>Novo pedido</h3><form id="restaurant-add-draft-form" class="restaurant-form restaurant-composer"><label>Produto<select name="productId" required>${data.products.map(p=>`<option value="${esc(p.id)}">${esc(p.name)} · ${money(p.salePriceCents)}</option>`).join('')}</select></label><div class="restaurant-form-row"><label>Quantidade<input name="quantity" type="number" min="0.001" step="0.001" value="1" required></label><label>Observação<input name="note" placeholder="Sem cebola, ponto da carne..."></label></div><button class="restaurant-btn secondary" type="submit">Adicionar ao pedido</button></form><div class="restaurant-draft">${draftItems.map((item,index)=>`<div class="restaurant-draft-line"><div><strong>${qty(item.quantity)}× ${esc(item.name)}</strong><small>${item.note?esc(item.note):'Sem observação'} · ${money(item.unitPriceCents)}</small></div><div class="restaurant-actions"><button type="button" class="restaurant-btn secondary" data-draft-minus="${index}">−</button><button type="button" class="restaurant-btn secondary" data-draft-plus="${index}">+</button><button type="button" class="restaurant-btn secondary" data-draft-remove="${index}">Remover</button></div></div>`).join('')||'<div class="restaurant-empty compact">Adicione itens antes de enviar para a cozinha.</div>'}<div class="restaurant-draft-footer"><strong>${money(draftTotal)}</strong><button class="restaurant-btn" type="button" data-send-order ${draftItems.length?'':'disabled'}>Enviar ${draftItems.length||0} item(ns) para a cozinha</button></div></div></div></div>
      <details class="restaurant-advanced"><summary>Conta e movimentações</summary><p class="restaurant-help">As ações abaixo usam mesas e itens visíveis; nenhum ID técnico é necessário.</p><div class="restaurant-advanced-grid">
      <form id="restaurant-split-form" class="restaurant-form restaurant-action-card"><h3>Dividir e cobrar</h3><label>Item<select name="orderItemId">${remaining.items.map(i=>`<option value="${esc(i.orderItemId)}">${qty(i.quantity)}× ${esc(i.productName)} · ${money(i.totalCents)}</option>`).join('')}</select></label><label>Quantidade<input name="quantity" type="number" min="0.001" step="0.001" value="1"></label><label>Ou dividir igualmente<select name="parts"><option value="">Por item</option><option value="2">2 partes</option><option value="3">3 partes</option><option value="4">4 partes</option></select></label><label>Taxa de serviço %<input name="serviceChargePercent" type="number" min="0" max="100" step="0.01" value="0"></label><label>Pagamento<select name="method"><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option><option value="OTHER">Outro</option></select></label><button class="restaurant-btn" type="submit" ${remaining.items.length?'':'disabled'}>Criar e concluir cobrança</button><small>Na divisão igual, uma parte é cobrada por vez; o restante continua na comanda.</small></form>
      ${canTransfer()?`<form id="restaurant-transfer-item-form" class="restaurant-form restaurant-action-card"><h3>Transferir item</h3><label>Item<select name="orderItemId">${remaining.items.map(i=>`<option value="${esc(i.orderItemId)}">${qty(i.quantity)}× ${esc(i.productName)}</option>`).join('')}</select></label><label>Quantidade<input name="quantity" type="number" min="0.001" step="0.001" value="1"></label><label>Mesa destino<select name="targetSessionId">${occupied.map(t=>`<option value="${esc(t.sessionId)}">${esc(t.label)}</option>`).join('')}</select></label><button class="restaurant-btn secondary" type="submit" ${remaining.items.length&&occupied.length?'':'disabled'}>Transferir item</button></form>
`:''}
      <form id="restaurant-cancel-item-form" class="restaurant-form restaurant-action-card"><h3>Cancelar item</h3><label>Item<select name="orderItemId">${remaining.items.map(i=>`<option value="${esc(i.orderItemId)}">${qty(i.quantity)}× ${esc(i.productName)}</option>`).join('')}</select></label><label>Motivo<input name="reason" required placeholder="Ex.: pedido duplicado"></label><button class="restaurant-btn danger" type="submit" ${remaining.items.length?'':'disabled'}>Cancelar item</button><small>Requer permissão para cancelar itens e motivo obrigatório.</small></form>
      ${canTransfer()?`<form id="restaurant-merge-form" class="restaurant-form restaurant-action-card"><h3>Juntar comandas</h3><label>Mesa destino<select name="targetSessionId">${occupied.map(t=>`<option value="${esc(t.sessionId)}">${esc(t.label)}</option>`).join('')}</select></label><button class="restaurant-btn secondary" type="submit" ${occupied.length?'':'disabled'}>Juntar nesta mesa</button></form>
      ${free.length?`<form id="restaurant-transfer-form" class="restaurant-form restaurant-action-card"><h3>Transferir comanda inteira</h3><label>Mesa destino<select name="targetTableId">${free.map(t=>`<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}</select></label><button class="restaurant-btn secondary" type="submit">Transferir mesa</button></form>`:''}
`:''}
      </div></details></section>`;
      bindSession(session);
    }catch(error){host.innerHTML=`<section class="restaurant-card"><p>${esc(error.message)}</p></section>`;}
  }
  function bindSession(session){
    document.querySelectorAll('[data-edit-comanda-item]').forEach(button=>button.addEventListener('click',()=>{
      const id=String(button.dataset.editComandaItem||'');
      const item=(session.orders||[]).flatMap(order=>order.items||[]).find(value=>String(value.id)===id);
      if(item)openEditComandaItemModal(session,item);
    }));
    document.querySelector('[data-cancel-comanda]')?.addEventListener('click',()=>openCancelComandaModal(session));
    document.getElementById('restaurant-session-details-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await request(`/api/v1/restaurant/sessions/${encodeURIComponent(session.id)}/details`,{method:'PATCH',body:{partySize:Number(form.get('partySize')),customerId:form.get('customerId')||null}});toast('Atendimento atualizado.','success');await reload(session.id);}catch(error){toast(error.message,'error');}});
    document.getElementById('restaurant-waiter-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await request(`/api/v1/restaurant/sessions/${encodeURIComponent(session.id)}/waiter`,{method:'PATCH',body:{waiterId:form.get('waiterId')||null}});toast('Garçom responsável atualizado.','success');await reload(session.id);}catch(error){toast(error.message,'error');}});
    document.getElementById('restaurant-add-draft-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const product=data.products.find(p=>p.id===form.get('productId'));const quantity=Number(form.get('quantity'));if(!product||!Number.isFinite(quantity)||quantity<=0)return;try{await root.PdvRestaurantOrderComposerUi.configure({api,modalRoot,product,quantity,note:String(form.get('note')||''),onAdd:line=>{draftCart.add(line);void renderSession(session.id);}});}catch(error){toast(error.message,'error');}});
    document.querySelectorAll('[data-draft-minus]').forEach(button=>button.addEventListener('click',()=>{const item=draftCart.lines()[Number(button.dataset.draftMinus)];if(!item)return;draftCart.changeQuantity(item.id,-1);void renderSession(session.id);}));
    document.querySelectorAll('[data-draft-plus]').forEach(button=>button.addEventListener('click',()=>{const item=draftCart.lines()[Number(button.dataset.draftPlus)];if(item){draftCart.changeQuantity(item.id,1);void renderSession(session.id);}}));
    document.querySelectorAll('[data-draft-remove]').forEach(button=>button.addEventListener('click',()=>{const item=draftCart.lines()[Number(button.dataset.draftRemove)];if(item)draftCart.setQuantity(item.id,0);void renderSession(session.id);}));
    document.querySelector('[data-send-order]')?.addEventListener('click',async()=>{if(!draftCart.lines().length)return;try{await request(`/api/v1/restaurant/sessions/${encodeURIComponent(session.id)}/orders`,{method:'POST',body:{operatorId:operatorId(),items:draftCart.toOrderItems()},mutationId:api.mutationId()});draftCart.clear();toast('Pedido registrado na comanda.','success');await reload(session.id);}catch(error){toast(error.message,'error');}});
    document.querySelector('[data-prebill]')?.addEventListener('click',async()=>{try{await request(`/api/v1/restaurant/sessions/${encodeURIComponent(session.id)}/prebill`,{method:'POST',body:{}});toast('Pré-conta adicionada à fila de impressão.','success');}catch(error){toast(error.message,'error');}});
    document.querySelector('[data-bill]')?.addEventListener('click',async()=>{try{await request(`/api/v1/restaurant/tables/${encodeURIComponent(session.tableId)}/service`,{method:'POST',body:{requestType:'BILL'},mutationId:api.mutationId()});await reload(session.id);}catch(error){toast(error.message,'error');}});
    document.querySelector('[data-checkout]')?.addEventListener('click',async()=>{try{const result=await request(`/api/v1/restaurant/sessions/${encodeURIComponent(session.id)}/checkout`,{method:'POST',body:{operatorId:operatorId(),terminalId:config.terminalId},mutationId:api.mutationId()});toast(`Venda ${result.sale.saleNumber||result.sale.id} aberta no caixa.`,'success');draftCart.clear();draftSessionId=null;selectedSessionId=null;document.querySelector('[data-route="checkout"]')?.click();}catch(error){toast(error.message,'error');}});
    document.getElementById('restaurant-transfer-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const moved=await request(`/api/v1/restaurant/sessions/${encodeURIComponent(session.id)}/transfer`,{method:'POST',body:{targetTableId:form.get('targetTableId')},mutationId:api.mutationId()});toast('Comanda transferida.','success');await reload(moved.id);}catch(error){toast(error.message,'error');}});
    document.getElementById('restaurant-transfer-item-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await api.transferRestaurantItems(session.id,{targetSessionId:form.get('targetSessionId'),items:[{orderItemId:form.get('orderItemId'),quantity:Number(form.get('quantity'))}]});toast('Item transferido.','success');await reload(session.id);}catch(error){toast(error.message,'error');}});
    document.getElementById('restaurant-cancel-item-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await api.cancelRestaurantOrderItem(form.get('orderItemId'),String(form.get('reason')||''));toast('Item cancelado.','success');await reload(session.id);}catch(error){toast(error.message,'error');}});
    document.getElementById('restaurant-merge-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const result=await api.mergeRestaurantSessions(session.id,form.get('targetSessionId'));toast('Comandas unidas.','success');selectedSessionId=result.targetSessionId;await reload(result.targetSessionId);}catch(error){toast(error.message,'error');}});
    document.getElementById('restaurant-split-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const common={operatorId:operatorId(),terminalId:config.terminalId,serviceChargePercent:Number(form.get('serviceChargePercent')||0)};const parts=Number(form.get('parts')||0);const result=parts?await api.createRestaurantEqualSettlement(session.id,{...common,parts}):await api.createRestaurantSettlement(session.id,{...common,items:[{orderItemId:form.get('orderItemId'),quantity:Number(form.get('quantity'))}]});await api.completeRestaurantSettlement(result.settlement.id,{payments:[{method:form.get('method'),amountCents:result.settlement.amountCents}]});toast('Cobrança concluída.','success');await reload(session.id);}catch(error){toast(error.message,'error');}});
  }
  async function reload(sessionId=selectedSessionId){await load();selectedSessionId=sessionId;render();}

  async function showCancel(sessionId){
    if(!canCancelSession())throw new Error('Seu perfil não permite cancelar comandas.');
    const id=String(sessionId||'').trim();
    if(!id)throw new Error('Selecione uma comanda para cancelar.');
    await show(id);
    if(!document.querySelector('#restaurant-detail [data-cancel-comanda]'))throw new Error('Comanda não está aberta ou não pode ser cancelada.');
    const session=await request(`/api/v1/restaurant/sessions/${encodeURIComponent(id)}`);
    if(session.status!=='OPEN')throw new Error('A comanda não está aberta.');
    openCancelComandaModal(session);
  }

  function openComandaDialog(title,bodyHtml,onSubmit){
    if(!modalRoot)return toast('Janela de confirmação indisponível.','error');
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML=`<section class="modal-card" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header class="modal-head"><h2>${esc(title)}</h2><button type="button" class="modal-close" data-comanda-dismiss aria-label="Fechar">×</button></header><div class="modal-body"><form id="comanda-operation-form" class="restaurant-form">${bodyHtml}<div class="restaurant-actions"><button type="button" class="restaurant-btn secondary" data-comanda-dismiss>Voltar</button><button class="restaurant-btn" type="submit">Confirmar</button></div></form></div></section>`;
    const close=()=>{modalRoot.classList.add('hidden');modalRoot.innerHTML='';};
    modalRoot.querySelectorAll('[data-comanda-dismiss]').forEach(button=>button.addEventListener('click',close));
    modalRoot.querySelector('#comanda-operation-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const submit=event.currentTarget.querySelector('[type="submit"]');
      if(submit.disabled)return;submit.disabled=true;
      try{await onSubmit(new FormData(event.currentTarget));close();}catch(error){toast(error.message,'error');submit.disabled=false;}
    });
  }

  function openEditComandaItemModal(session,item){
    if(!canEditItems()||session.status!=='OPEN')return;
    openComandaDialog('Editar item já lançado',
      `<p>Corrija a quantidade ou observação de <strong>${esc(item.productName)}</strong>. Itens em preparo ou cobrados devem ser cancelados e lançados novamente.</p>
       <label>Quantidade<input name="quantity" type="number" min="0.001" step="0.001" max="10000" value="${esc(item.quantity)}" required></label>
       <label>Observação<input name="note" maxlength="500" value="${esc(item.note||'')}" placeholder="Observações para o atendimento e a cozinha"></label>`,
      async form=>{
        await request(`/api/v1/restaurant/order-items/${encodeURIComponent(item.id)}`,{
          method:'PATCH',body:{quantity:Number(form.get('quantity')),note:String(form.get('note')||'')},mutationId:api.mutationId()
        });
        toast('Item da comanda atualizado.','success');
        await reload(session.id);
      });
  }

  function openCancelComandaModal(session){
    if(!canCancelSession()||session.status!=='OPEN')return;
    const manager=hasPermission('restaurant.sessions.cancel.production');
    openComandaDialog('Cancelar comanda inteira',
      `<p>Esta ação libera a mesa e cancela os pedidos e tickets do KDS. O histórico será preservado; pagamentos registrados impedem o cancelamento.</p>
       <p><strong>${esc(session.tableLabel)} · ${money(session.totalCents)}</strong></p>
       <label>Motivo do cancelamento<textarea name="reason" rows="3" minlength="3" maxlength="500" required placeholder="Explique por que a comanda será cancelada"></textarea></label>
       ${manager?'<label><input type="checkbox" name="allowProduction" value="yes"> Autorizar cancelamento mesmo com preparo iniciado</label>':''}`,
      async form=>{
        await request(`/api/v1/restaurant/sessions/${encodeURIComponent(session.id)}/cancel`,{
          method:'POST',body:{reason:String(form.get('reason')||'').trim(),allowProduction:manager&&form.get('allowProduction')==='yes'},mutationId:api.mutationId()
        });
        toast('Comanda cancelada; mesa liberada.','success');
        draftCart.clear();draftSessionId=null;selectedSessionId=null;
        await reload(null);
      });
  }

  function openTableModal(table){
    if(!modalRoot)return;
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML=`<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="restaurant-open-table-title"><header class="modal-head"><div><h2 id="restaurant-open-table-title">Abrir ${esc(table.label)}</h2><p>Defina pessoas, cliente e responsável pelo atendimento.</p></div><button class="modal-close" type="button" data-close-open-table aria-label="Fechar">×</button></header><div class="modal-body"><form id="restaurant-open-table-form" class="restaurant-form"><div class="restaurant-form-row"><label>Pessoas<input name="partySize" type="number" min="1" max="50" step="1" value="1" required></label><label>Cliente (opcional)<select name="customerId">${customerOptions()}</select></label></div><label>Garçom responsável<select name="waiterId">${userOptions(operatorId(),true)}</select></label><div class="restaurant-actions"><button class="restaurant-btn secondary" type="button" data-close-open-table>Cancelar</button><button class="restaurant-btn" type="submit">Abrir atendimento</button></div></form></div></section>`;
    const close=()=>{modalRoot.classList.add('hidden');modalRoot.innerHTML='';};
    modalRoot.querySelectorAll('[data-close-open-table]').forEach(button=>button.addEventListener('click',close));
    modalRoot.querySelector('#restaurant-open-table-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{const session=await request(`/api/v1/restaurant/tables/${encodeURIComponent(table.id)}/open`,{method:'POST',body:{operatorId:operatorId(),waiterId:form.get('waiterId')||null,partySize:Number(form.get('partySize')),customerId:form.get('customerId')||null},mutationId:api.mutationId()});close();await reload(session.id);}catch(error){toast(error.message,'error');}});
  }

  function openNewTableModal(){
    if(!modalRoot){toast('Não foi possível abrir o cadastro de mesa.','error');return;}
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML=`<section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="restaurant-new-table-title"><header class="modal-head"><div><h2 id="restaurant-new-table-title">Nova mesa</h2><p>Cadastre a identificação e a quantidade de lugares.</p></div><button class="modal-close" type="button" data-close-new-table aria-label="Fechar">×</button></header><div class="modal-body"><form id="restaurant-new-table-form" class="restaurant-form"><label>Nome ou número da mesa<input name="label" maxlength="80" value="Mesa " autocomplete="off" required></label><label>Quantidade de lugares<input name="seats" type="number" min="0" step="1" value="4" required></label><div class="ops-error hidden" data-new-table-error role="alert"></div><div class="restaurant-actions"><button class="restaurant-btn secondary" type="button" data-close-new-table>Cancelar</button><button class="restaurant-btn" type="submit" data-create-table>Criar mesa</button></div></form></div></section>`;
    const form=modalRoot.querySelector('#restaurant-new-table-form');const labelInput=form?.elements.namedItem('label');const seatsInput=form?.elements.namedItem('seats');const errorNode=modalRoot.querySelector('[data-new-table-error]');const submitButton=modalRoot.querySelector('[data-create-table]');
    const showError=message=>{if(!errorNode)return;errorNode.textContent=message;errorNode.classList.remove('hidden');};
    const clearError=()=>{if(!errorNode)return;errorNode.textContent='';errorNode.classList.add('hidden');};
    const close=()=>{modalRoot.removeEventListener('click',backdropClose);modalRoot.classList.add('hidden');modalRoot.innerHTML='';};
    const backdropClose=event=>{if(event.target===modalRoot)close();};
    modalRoot.addEventListener('click',backdropClose);
    modalRoot.querySelectorAll('[data-close-new-table]').forEach(button=>button.addEventListener('click',close));
    form?.addEventListener('submit',async event=>{
      event.preventDefault();clearError();
      const label=String(labelInput?.value||'').trim();const seats=Number(seatsInput?.value);
      if(!label){showError('Informe o nome ou número da mesa.');labelInput?.focus();return;}
      if(!Number.isFinite(seats)||!Number.isInteger(seats)||seats<0){showError('Informe uma quantidade de lugares válida, usando um número inteiro igual ou maior que zero.');seatsInput?.focus();return;}
      if(submitButton)submitButton.disabled=true;
      try{await request('/api/v1/restaurant/tables',{method:'POST',body:{label,seats}});}catch(error){showError(error.message);toast(error.message,'error');if(submitButton)submitButton.disabled=false;return;}
      close();toast('Mesa criada.','success');
      try{await reload();}catch(error){toast(`Mesa criada, mas não foi possível atualizar o mapa: ${error.message}`,'error');}
    });
    labelInput?.focus();if(labelInput?.select)labelInput.select();
  }

  async function pairNewDevice(device){
    const network=await root.artisysDesktop.publicNetwork.state();
    if(!network.enabled)throw new Error(network.reason||'Configure este computador como PC principal da LAN antes de conectar celulares.');
    const address={host:network.stable?network.host:(network.addresses?.[0]||network.host),port:network.port,protocol:network.protocol||'http:'};
    await root.artisysDesktop.publicNetwork.test(address);
    return request('/api/v1/restaurant/devices/pairing-qr',{method:'POST',body:{
      deviceId:device.id,credential:device.credential,...address
    }});
  }
  function confirmDevicePair(deviceId){
    const device=data.devices.find(row=>row.id===deviceId);
    if(!device||!modalRoot)return;
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML=`<section class="modal-card" role="dialog" aria-modal="true" aria-label="Conectar celular por QR">
      <header class="modal-head"><h2>Conectar ${esc(device.name)} por QR</h2></header>
      <div class="modal-body"><p>Por segurança, será criada uma nova chave para este dispositivo. O acesso anterior deixará de funcionar. Aponte a câmera do celular para o novo QR.</p>
      <div class="restaurant-actions"><button type="button" class="restaurant-btn secondary" data-pair-cancel>Cancelar</button><button type="button" class="restaurant-btn" data-pair-confirm>Gerar QR e substituir chave</button></div>
      <p data-pair-error role="alert"></p></div></section>`;
    const close=()=>{modalRoot.classList.add('hidden');modalRoot.innerHTML='';};
    modalRoot.querySelector('[data-pair-cancel]')?.addEventListener('click',close);
    modalRoot.querySelector('[data-pair-confirm]')?.addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{
        // Test LAN before rotating; never revoke a working phone on failed network setup.
        const network=await root.artisysDesktop.publicNetwork.state();
        if(!network.enabled)throw new Error(network.reason||'Ative a rede do PC principal.');
        await root.artisysDesktop.publicNetwork.test({host:network.stable?network.host:(network.addresses?.[0]||network.host),port:network.port,protocol:network.protocol||'http:'});
        latestCredential=await request(`/api/v1/restaurant/devices/${encodeURIComponent(deviceId)}/rotate`,{method:'POST',body:{}});
        latestPairing=null;
        try{latestPairing=await pairNewDevice(latestCredential);}
        catch(error){toast('Chave renovada. QR indisponível: '+error.message,'error');}
        close();await reload();
      }catch(error){const area=modalRoot.querySelector('[data-pair-error]');if(area)area.textContent=error.message;button.disabled=false;}
    });
  }
  function bind(){content.querySelectorAll('[data-restaurant-view-target]').forEach(button=>button.addEventListener('click',()=>{const next=button.dataset.restaurantViewTarget;if(next==='management'&&!canManageRestaurant())return;activeView=next==='management'?'management':'operation';render();}));document.querySelector('[data-food-back]')?.addEventListener('click',()=>void root.PdvAppNavigation?.navigate?.('FOOD'));document.getElementById('restaurant-operator')?.addEventListener('change',event=>localStorage.setItem('artisys.restaurant.operatorId',event.target.value));content.querySelectorAll('[data-open-table-qr]').forEach(button=>button.addEventListener('click',()=>{const table=data.tables.find(row=>row.id===button.dataset.openTableQr);if(table)void root.PdvRestaurantPublicOrderingUi?.openTableQr?.(table.id,table.label);}));content.querySelector('[data-qr-settings-shortcut]')?.addEventListener('click',async()=>{await root.PdvAppNavigation?.navigate?.('settings');root.PdvUiLifecycle?.emit?.('settings:select',{category:'food-menu'});});content.querySelectorAll('[data-table-id]').forEach(button=>button.addEventListener('click',async()=>{const table=data.tables.find(t=>t.id===button.dataset.tableId);if(!table)return;if(table.status==='FREE'){if(!canManageTables()){toast('Seu perfil pode editar comandas abertas, mas não abrir mesas.','error');return;}openTableModal(table);}else{selectedSessionId=table.sessionId;await renderSession(table.sessionId);document.getElementById('restaurant-detail')?.scrollIntoView({behavior:'smooth',block:'start'});}}));document.querySelector('[data-refresh]')?.addEventListener('click',()=>reload());document.querySelector('[data-new-table]')?.addEventListener('click',openNewTableModal);document.querySelector('[data-routing-review]')?.addEventListener('click',async event=>{const productId=event.currentTarget.dataset.routingReview;if(!productId)return;await root.PdvAppNavigation?.navigate?.('inventory');await root.PdvCatalogAdmin?.openInventoryItem?.(productId);});content.querySelectorAll('[data-request-ack]').forEach(button=>button.addEventListener('click',async()=>{try{await request(`/api/v1/restaurant/requests/${encodeURIComponent(button.dataset.requestAck)}`,{method:'PATCH',body:{status:'ACKNOWLEDGED'}});await reload();}catch(error){toast(error.message,'error');}}));content.querySelectorAll('[data-ticket-status]').forEach(button=>button.addEventListener('click',async()=>{try{await request(`/api/v1/restaurant/kitchen/tickets/${encodeURIComponent(button.dataset.ticketStatus)}`,{method:'PATCH',body:{status:button.dataset.next}});await reload();}catch(error){toast(error.message,'error');}}));document.getElementById('station-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await request('/api/v1/restaurant/kitchen/stations',{method:'POST',body:{name:form.get('name'),printerName:form.get('printerName')}});await reload();}catch(error){toast(error.message,'error');}});document.getElementById('device-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{latestCredential=await request('/api/v1/restaurant/devices',{method:'POST',body:{name:form.get('name'),deviceType:form.get('deviceType'),tableId:form.get('tableId')||null,userId:form.get('userId')||null}});latestPairing=null;try{latestPairing=await pairNewDevice(latestCredential);}catch(error){toast('Dispositivo criado; conecte manualmente ou configure a rede: '+error.message,'error');}await reload();}catch(error){toast(error.message,'error');}});content.querySelectorAll('[data-device-status]').forEach(button=>button.addEventListener('click',async()=>{try{await request(`/api/v1/restaurant/devices/${encodeURIComponent(button.dataset.deviceStatus)}/status`,{method:'PATCH',body:{status:button.dataset.next}});await reload();}catch(error){toast(error.message,'error');}}));content.querySelector('[data-diagnose-lan]')?.addEventListener('click',async event=>{
      const button=event.currentTarget,area=content.querySelector('[data-lan-diagnostics]');
      button.disabled=true;
      try{
        const network=await root.artisysDesktop.publicNetwork.state();
        if(!network.enabled){area.textContent=(network.reason||'Acesso LAN desativado')+'. Vá a Configurações → Unidades e dispositivos e escolha PC principal.';return;}
        const address={host:network.stable?network.host:(network.addresses?.[0]||network.host),port:network.port,protocol:network.protocol||'http:'};
        await root.artisysDesktop.publicNetwork.test(address);
        area.textContent='Servidor local responde em '+address.host+':'+address.port+'. Teste confirmado somente neste PC. Se o celular não abrir: conecte-o ao mesmo Wi-Fi (não convidado), verifique isolamento do roteador e Firewall do Windows. Caso o IP tenha mudado, gere um novo endereço/QR e reserve IP no roteador.';
      }catch(error){if(area)area.textContent='Falha no acesso LAN: '+error.message+'. Confira PC principal, Wi-Fi e Firewall do Windows.';}
      finally{button.disabled=false;}
    });content.querySelectorAll('[data-device-pair]').forEach(button=>button.addEventListener('click',()=>confirmDevicePair(button.dataset.devicePair)));content.querySelectorAll('[data-device-rotate]').forEach(button=>button.addEventListener('click',async()=>{try{latestCredential=await request(`/api/v1/restaurant/devices/${encodeURIComponent(button.dataset.deviceRotate)}/rotate`,{method:'POST',body:{}});latestPairing=null;try{latestPairing=await pairNewDevice(latestCredential);}catch(error){toast('Nova chave gerada, mas QR indisponível: '+error.message,'error');}await reload();}catch(error){toast(error.message,'error');}}));document.getElementById('restaurant-export')?.addEventListener('click',async()=>{try{const result=await request('/api/v1/restaurant/reports/orders.csv');const blob=new Blob([result.csv||''],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`pedidos-restaurante-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){toast(error.message,'error');}});}
  root.PdvRestaurantUi=Object.freeze({show,reload,showCancel});
})();
