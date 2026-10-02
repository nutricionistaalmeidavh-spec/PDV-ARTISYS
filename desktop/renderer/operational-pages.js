'use strict';

(() => {
  const root = window;
  const { ApiClient } = root.PdvApiClient;
  const api = new ApiClient();
  const ui = root.PdvUiModel;
  const ux = root.ArtisysUxComponents;
  const modal = root.PdvModal;
  const content = document.getElementById('route-content');
  const toastRoot = document.getElementById('toast-root');
  const OPERATIONAL_ROUTES = new Set(['inventory','cash','sales','returns','finance','reports','settings']);
  const SHORTCUTS = Object.freeze({ F6:'inventory',F7:'cash',F8:'finance',F9:'reports',F10:'sales',F11:'returns' });
  let config = null;

  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);}
  function money(value){return ui?.formatCents ? ui.formatCents(value) : (Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function qty(value){return Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});}
  function countLabel(value,singular,plural=`${singular}s`){const count=Number(value||0);return `${qty(count)} ${count===1?singular:plural}`;}
  function when(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?escapeHtml(value):date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
  function centsInput(value){const text=String(value??'').trim().replace(/\./g,'').replace(',','.');const n=Number(text);return Number.isFinite(n)?Math.round(n*100):0;}
  function showToast(message,type=''){if(!toastRoot)return;const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;toastRoot.appendChild(node);setTimeout(()=>node.remove(),3500);}
  function empty(message){return `<div class="ops-empty">${escapeHtml(message)}</div>`;}
  function badge(value){const normalized=String(value||'').toLowerCase();return `<span class="ops-badge status-${escapeHtml(normalized)}">${escapeHtml(value||'—')}</span>`;}
  const FINANCE_KIND_LABELS=Object.freeze({PAYABLE:'Conta a pagar',RECEIVABLE:'Conta a receber'});
  const FINANCE_STATUS_LABELS=Object.freeze({OPEN:'Em aberto',PARTIAL:'Parcial',SETTLED:'Liquidado',CANCELLED:'Cancelado',OVERDUE:'Vencido'});
  const FINANCE_METHOD_LABELS=Object.freeze({CASH:'Dinheiro',DINHEIRO:'Dinheiro',PIX:'PIX',DEBIT_CARD:'Cartão de débito',CREDIT_CARD:'Cartão de crédito',CARTAO:'Cartão',TRANSFERENCIA:'Transferência',BOLETO:'Boleto',MANUAL:'Manual',BANK_RECONCILIATION:'Conciliação bancária'});
  function financeKindLabel(value){return FINANCE_KIND_LABELS[String(value||'').toUpperCase()]||String(value||'—');}
  function financeStatusCode(row){return row?.isOverdue&&row?.status!=='SETTLED'&&row?.status!=='CANCELLED'?'OVERDUE':String(row?.status||'OPEN').toUpperCase();}
  function financeStatusBadge(row){const code=financeStatusCode(row);return `<span class="ops-badge status-${escapeHtml(code.toLowerCase())}">${escapeHtml(FINANCE_STATUS_LABELS[code]||code)}</span>`;}
  function financeMethodLabel(value){const code=String(value||'').toUpperCase();return FINANCE_METHOD_LABELS[code]||value||'Não informado';}
  function dateOnly(value){if(!value)return '—';const text=String(value).slice(0,10);const date=new Date(`${text}T00:00:00.000Z`);return Number.isNaN(date.getTime())?escapeHtml(text):date.toLocaleDateString('pt-BR',{timeZone:'UTC'});}
  function metric(label,value,hint=''){return `<article class="ops-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${hint?`<small>${escapeHtml(hint)}</small>`:''}</article>`;}
  function page(title,subtitle,body,actions=''){return `<section class="ops-page"><header class="ops-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="ops-head-actions">${actions}</div></header>${body}</section>`;}
  async function ready(){if(!config)config=await api.initialize();return config;}
  function routeActive(route){return document.body.dataset.activeRoute===route;}
  function canAccess(route){return root.PdvHomeRoleModel?.canAccessRoute(document.body.dataset.userRole,route)===true;}
  function markActive(route){document.body.dataset.activeRoute=route;document.body.classList.remove('theme-home');document.querySelectorAll('[data-route]').forEach(node=>node.classList.toggle('active',node.dataset.route===route));}

  async function renderInventory(){
    await ready();
    const [balances,low,movements,products]=await Promise.all([api.inventoryBalances(),api.inventoryLowStock(),api.inventoryMovements(),api.products(true)]);
    const totalCost=balances.reduce((sum,item)=>sum+Math.round(Number(item.costCents||0)*Number(item.quantity||0)),0);
    const stockSkuCount=products.filter(product=>product.active!==false&&product.trackStock).length;
    const body=`<div class="ops-metrics">${metric('SKUs de estoque',String(stockSkuCount),'Itens com saldo próprio')}${metric('Estoque baixo',String(low.length),low.length?'Requer atenção':'Dentro do mínimo')}${metric('Valor em custo',money(totalCost))}</div>
      <section class="ops-card" id="inventory-master-actions"><div class="ops-card-head"><div><h2>Cadastro mestre</h2><p>Cadastre produtos como insumo, venda direta ou ambos; as fichas técnicas definem os itens preparados.</p></div><div class="ops-actions"><button class="ops-secondary" type="button" id="inventory-new-product">+ Produto / insumo</button><button class="ops-primary" type="button" id="inventory-new-recipe">+ Ficha Técnica</button></div></div><p class="ops-muted">Nada é colocado no Cardápio automaticamente. Depois, em Cardápio → Novo item, escolha um produto do Estoque ou uma Ficha Técnica.</p></section>
      <section class="ops-card" id="inventory-recipes-card"><div class="ops-card-head"><div><h2>Fichas técnicas</h2><p>Produtos preparados compostos por insumos reais do Estoque. A ficha técnica é interna e nunca é exibida ao cliente.</p></div><button class="ops-secondary" type="button" data-route="products">Abrir Cardápio</button></div><div class="ops-empty">Carregando fichas técnicas…</div></section>
      <div class="ops-grid two"><section class="ops-card"><div class="ops-card-head"><h2>Posição de estoque</h2><input id="ops-inventory-search" class="ops-input compact" placeholder="Filtrar produto"></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>SKU</th><th>Saldo</th><th>Mínimo</th><th>Situação</th></tr></thead><tbody id="ops-inventory-body">${balances.map(item=>`<tr data-search="${escapeHtml(`${item.name} ${item.sku||''} ${item.barcode||''}`.toLowerCase())}"><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.sku||'—')}</td><td>${qty(item.quantity)} ${escapeHtml(item.unit||'')}</td><td>${qty(item.minimumStock)}</td><td>${item.lowStock?badge('BAIXO'):badge('OK')}</td></tr>`).join('')||`<tr><td colspan="5">${empty('Nenhum produto controlado.')}</td></tr>`}</tbody></table></div></section>
      <section class="ops-card"><h2>Nova movimentação</h2><form id="ops-inventory-form" class="ops-form"><label>Produto<select name="productId" class="ops-input" required>${balances.map(item=>`<option value="${escapeHtml(item.productId)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><label>Tipo<select name="type" class="ops-input"><option value="purchase">Entrada/compra</option><option value="adjustment-in">Ajuste de entrada</option><option value="adjustment-out">Ajuste de saída</option><option value="inventory-count">Inventário</option></select></label><label>Quantidade<input name="quantity" class="ops-input" type="number" min="0.001" step="0.001" required></label><label>Motivo<input name="reason" class="ops-input" required placeholder="Motivo da movimentação"></label><button class="ops-primary" type="submit">Registrar movimentação</button></form></section></div>
      <section class="ops-card"><h2>Movimentações recentes</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Antes</th><th>Movimento</th><th>Depois</th><th>Motivo</th></tr></thead><tbody>${movements.slice(0,100).map(item=>`<tr><td>${when(item.createdAt)}</td><td>${escapeHtml(balances.find(p=>p.productId===item.productId)?.name||item.productId)}</td><td>${escapeHtml(item.type)}</td><td>${qty(item.quantityBefore)}</td><td>${qty(item.quantityDelta)}</td><td>${qty(item.quantityAfter)}</td><td>${escapeHtml(item.reason||'—')}</td></tr>`).join('')||`<tr><td colspan="7">${empty('Sem movimentações.')}</td></tr>`}</tbody></table></div></section>`;
    if(!routeActive('inventory'))return;
    content.innerHTML=page('Estoque','Saldos, mínimos, cadastros e movimentações imutáveis.',body);
    content.querySelector('[data-route="products"]')?.addEventListener('click',()=>document.querySelector('#sidebar-nav [data-route="products"]')?.click());
    document.getElementById('inventory-new-product')?.addEventListener('click',()=>root.PdvCatalogAdmin?.openStockProductForm?.());
    document.getElementById('inventory-new-recipe')?.addEventListener('click',()=>root.PdvCatalogAdmin?.openRecipeForm?.());
    void (async()=>{try{
      const rows=await Promise.all(products.map(async product=>({product,recipe:await api.recipe(product.id).catch(()=>null)})));
      const card=document.getElementById('inventory-recipes-card');
      if(card){
        card.querySelector('.ops-empty').outerHTML=rows.filter(row=>row.recipe).map(row=>{const status=row.product.recipeStockStatus==='OUT'?'indisponível por insumo':row.product.recipeStockStatus==='LOW'?'insumo baixo':'insumos OK';return `<div class="ops-detail-row"><span class="ops-detail-copy"><strong>${escapeHtml(row.product.name)}</strong><small>${countLabel(row.recipe.components.length,'insumo','insumos')} · rendimento ${qty(row.recipe.yieldQuantity)} ${escapeHtml(row.recipe.yieldUnit||'UN')} · custo/porção ${money(row.recipe.costPerPortionCents||0)}</small><small>${escapeHtml(status)} · capacidade ${countLabel(row.product.recipeCapacity||0,'porção','porções')} · ${row.product.menuEnabled?'no Cardápio':'fora do Cardápio'}</small></span><button class="ops-secondary" type="button" data-edit-recipe="${escapeHtml(row.product.id)}">Editar ficha</button></div>`;}).join('')||'<div class="ops-empty">Nenhuma ficha técnica cadastrada.</div>';
        card.querySelectorAll('[data-edit-recipe]').forEach(button=>button.addEventListener('click',()=>{const product=products.find(item=>item.id===button.dataset.editRecipe);if(product)root.PdvCatalogAdmin?.openRecipeForm?.(product);}));
      }
    }catch{}})();
    document.getElementById('ops-inventory-search')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();document.querySelectorAll('#ops-inventory-body tr[data-search]').forEach(row=>row.hidden=!row.dataset.search.includes(q));});
    document.getElementById('ops-inventory-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const type=String(form.get('type'));const quantity=Number(form.get('quantity'));const quantityDelta=type==='adjustment-out'?-Math.abs(quantity):type==='inventory-count'?undefined:Math.abs(quantity);try{const body={productId:form.get('productId'),type,reason:form.get('reason')};if(type==='inventory-count')body.countedQuantity=quantity;else body.quantityDelta=quantityDelta;await api.saveInventoryMovement(body);showToast('Movimentação registrada.','success');await renderInventory();}catch(error){showToast(error.message,'error');}});
  }

  async function renderCash(){
    const cfg=await ready();let open=null;try{open=await api.openCash(cfg.terminalId);}catch{}
    const sessions=await api.cashSessions({terminalId:cfg.terminalId});
    const movements=open?await api.cashMovements(open.id):[];
    const body=`<div class="ops-metrics">${metric('Situação',open?'Caixa aberto':'Caixa fechado')}${metric('Saldo esperado',open?money(open.expectedCashCents??open.initialCashCents):'—')}${metric('Sessões anteriores',String(sessions.filter(s=>s.status==='CLOSED').length))}</div>
      <div class="ops-grid two"><section class="ops-card"><h2>Operação atual</h2>${open?`<dl class="ops-details"><div><dt>Sessão</dt><dd>${escapeHtml(open.id)}</dd></div><div><dt>Operador</dt><dd>${escapeHtml(open.operatorId)}</dd></div><div><dt>Abertura</dt><dd>${when(open.openedAt)}</dd></div></dl><div class="ops-actions"><button class="ops-secondary" data-cash-action="supply">Suprimento</button><button class="ops-secondary" data-cash-action="withdraw">Sangria</button><button class="ops-danger" data-cash-action="close">Fechar caixa</button></div>`:`<form id="ops-open-cash" class="ops-form"><label>Fundo inicial (R$)<input class="ops-input" name="amount" value="0,00" required></label><button class="ops-primary" type="submit">Abrir caixa</button></form>`}</section>
      <section class="ops-card"><h2>Movimentos da sessão</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Hora</th><th>Tipo</th><th>Valor</th><th>Forma</th></tr></thead><tbody>${movements.map(row=>`<tr><td>${when(row.createdAt)}</td><td>${escapeHtml(row.type)}</td><td>${money(row.amountCents)}</td><td>${escapeHtml(row.paymentMethod||'—')}</td></tr>`).join('')||`<tr><td colspan="4">${empty('Nenhum movimento na sessão atual.')}</td></tr>`}</tbody></table></div></section></div>
      <section class="ops-card"><h2>Histórico de fechamentos</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Abertura</th><th>Fechamento</th><th>Esperado</th><th>Contado</th><th>Divergência</th><th>Status</th></tr></thead><tbody>${sessions.map(row=>`<tr><td>${when(row.openedAt)}</td><td>${when(row.closedAt)}</td><td>${row.expectedCashCents==null?'—':money(row.expectedCashCents)}</td><td>${row.countedCashCents==null?'—':money(row.countedCashCents)}</td><td>${row.divergenceCents==null?'—':money(row.divergenceCents)}</td><td>${badge(row.status)}</td></tr>`).join('')||`<tr><td colspan="6">${empty('Sem sessões registradas.')}</td></tr>`}</tbody></table></div></section>`;
    if(!routeActive('cash'))return;
    content.innerHTML=page('Caixa','Abertura, suprimentos, sangrias e fechamento por terminal.',body);
    document.getElementById('ops-open-cash')?.addEventListener('submit',async event=>{event.preventDefault();const amount=centsInput(new FormData(event.currentTarget).get('amount'));try{await api.createCash({terminalId:cfg.terminalId,initialCashCents:amount});showToast('Caixa aberto.','success');await renderCash();}catch(error){showToast(error.message,'error');}});
    content.querySelectorAll('[data-cash-action]').forEach(button=>button.addEventListener('click',async()=>{const action=button.dataset.cashAction;try{if(action==='close'){const value=root.prompt('Valor contado em dinheiro (R$):','0,00');if(value===null)return;await api.cashAction(open.id,'close',{countedByMethod:{CASH:centsInput(value)}});}else{const value=root.prompt(action==='supply'?'Valor do suprimento (R$):':'Valor da sangria (R$):');if(value===null)return;const note=root.prompt('Observação:','')||'';await api.cashAction(open.id,action,{amountCents:centsInput(value),note});}showToast('Operação de caixa registrada.','success');await renderCash();}catch(error){showToast(error.message,'error');}}));
  }

  async function renderSalesHistory(){
    await ready();const sales=await api.salesHistory({limit:200});
    const body=`<section class="ops-card"><div class="ops-card-head"><h2>Vendas concluídas</h2><input id="ops-sales-search" class="ops-input compact" placeholder="Venda, cliente, vendedor ou operador"></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Venda</th><th>Data</th><th>Vendedor</th><th>Operador</th><th>Cliente</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody id="ops-sales-body">${sales.map(row=>`<tr data-search="${escapeHtml(`${row.saleNumber||''} ${row.customerName||''} ${row.sellerName||''} ${row.operatorName||''}`.toLowerCase())}"><td><strong>${escapeHtml(row.saleNumber||row.id)}</strong></td><td>${when(row.completedAt||row.openedAt)}</td><td>${escapeHtml(row.sellerName||row.sellerId||'—')}</td><td>${escapeHtml(row.operatorName||row.operatorId||'—')}</td><td>${escapeHtml(row.customerName||'Consumidor')}</td><td>${money(row.totalCents)}</td><td>${badge(row.status)}</td><td><button class="ops-link" data-sale-details="${escapeHtml(row.id)}">Detalhes</button></td></tr>`).join('')||`<tr><td colspan="8">${empty('Nenhuma venda concluída.')}</td></tr>`}</tbody></table></div></section><section id="ops-sale-detail"></section>`;
    if(!routeActive('sales'))return;
    content.innerHTML=page('Últimas vendas','Histórico imutável, pagamentos, itens e devoluções.',body);
    document.getElementById('ops-sales-search')?.addEventListener('input',event=>{const q=event.target.value.toLowerCase();document.querySelectorAll('#ops-sales-body tr[data-search]').forEach(row=>row.hidden=!row.dataset.search.includes(q));});
    content.querySelectorAll('[data-sale-details]').forEach(button=>button.addEventListener('click',async()=>{try{const sale=await api.saleDetails(button.dataset.saleDetails);const jobs=await api.printJobs({entityType:'sale',entityId:sale.id});if(!routeActive('sales'))return;const detail=document.getElementById('ops-sale-detail');if(!detail)return;detail.innerHTML=`<section class="ops-card"><div class="ops-card-head"><div><h2>Venda ${escapeHtml(sale.saleNumber||sale.id)}</h2><p>${when(sale.completedAt||sale.cancelledAt)} · Vendedor: ${escapeHtml(sale.sellerName||sale.sellerId||'—')} · Operador: ${escapeHtml(sale.operatorName||sale.operatorId||'—')}${sale.cancelReason?` · Cancelamento: ${escapeHtml(sale.cancelReason)}`:''}</p></div>${jobs[0]?`<button class="ops-secondary" data-reprint="${escapeHtml(jobs[0].id)}">Reimprimir comprovante</button>`:''}</div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Item</th><th>Qtd.</th><th>Preço original</th><th>Preço aplicado</th><th>Justificativa</th><th>Total</th></tr></thead><tbody>${(sale.items||[]).map(item=>`<tr><td>${escapeHtml(item.productName)}</td><td>${qty(item.quantity)}</td><td>${money(item.catalogUnitPriceCents??item.unitPriceCents)}</td><td>${money(item.unitPriceCents)}</td><td>${escapeHtml(item.priceOverrideReason||'—')}</td><td>${money(item.totalCents)}</td></tr>`).join('')}</tbody></table></div><div class="ops-summary-line"><span>Desconto ${money(sale.discountCents||0)}</span><strong>Total ${money(sale.totalCents)}</strong></div></section>`;document.querySelector('[data-reprint]')?.addEventListener('click',async event=>{try{await api.reprint(event.currentTarget.dataset.reprint);showToast('Reimpressão adicionada à fila.','success');}catch(error){showToast(error.message,'error');}});}catch(error){showToast(error.message,'error');}}));
  }

  async function renderReturns(){
    await ready();const rows=await api.returns();
    const body=`<div class="ops-grid two"><section class="ops-card"><h2>Nova devolução</h2><form id="ops-return-form" class="ops-form"><label>Venda<input id="ops-return-sale" name="saleId" class="ops-input" required placeholder="ID da venda"></label><button id="ops-load-return-sale" class="ops-secondary" type="button">Carregar itens</button><div id="ops-return-items">${empty('Informe a venda para selecionar os itens.')}</div><label>Forma de reembolso<select name="method" class="ops-input"><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="DEBIT_CARD">Cartão débito</option><option value="CREDIT_CARD">Cartão crédito</option><option value="STORE_CREDIT">Crédito loja</option></select></label><label>Motivo<input name="reason" class="ops-input" required></label><button class="ops-primary" type="submit">Concluir devolução</button></form></section><section class="ops-card"><h2>Devoluções realizadas</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Venda</th><th>Total</th><th>Status</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${when(row.createdAt)}</td><td>${escapeHtml(row.saleId)}</td><td>${money(row.totalCents)}</td><td>${badge(row.status)}</td></tr>`).join('')||`<tr><td colspan="4">${empty('Nenhuma devolução registrada.')}</td></tr>`}</tbody></table></div></section></div>`;
    if(!routeActive('returns'))return;
    content.innerHTML=page('Devolução','Devoluções parciais ou totais sem alterar a venda original.',body);let loadedSale=null;
    document.getElementById('ops-load-return-sale')?.addEventListener('click',async()=>{const saleId=document.getElementById('ops-return-sale').value.trim();if(!saleId)return;try{loadedSale=await api.saleDetails(saleId);if(!routeActive('returns'))return;const itemsRoot=document.getElementById('ops-return-items');if(!itemsRoot)return;itemsRoot.innerHTML=(loadedSale.items||[]).map(item=>`<label class="ops-return-item"><input type="checkbox" data-return-item="${escapeHtml(item.id)}" data-price="${Number(item.unitPriceCents||0)}"><span>${escapeHtml(item.productName)}</span><small>vendido ${qty(item.quantity)}</small><input class="ops-input compact" data-return-qty="${escapeHtml(item.id)}" type="number" min="0.001" max="${Number(item.quantity)}" step="0.001" value="1"></label>`).join('')||empty('Venda sem itens devolvíveis.');}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-return-form')?.addEventListener('submit',async event=>{event.preventDefault();if(!loadedSale){showToast('Carregue a venda antes de concluir.','error');return;}const form=new FormData(event.currentTarget);const items=[];let total=0;content.querySelectorAll('[data-return-item]:checked').forEach(check=>{const id=check.dataset.returnItem;const quantity=Number(content.querySelector(`[data-return-qty="${CSS.escape(id)}"]`)?.value||0);if(quantity>0){items.push({saleItemId:id,quantity});total+=Math.round(Number(check.dataset.price||0)*quantity);}});if(!items.length){showToast('Selecione ao menos um item.','error');return;}try{await api.createReturn({saleId:loadedSale.id,items,refunds:[{method:form.get('method'),amountCents:total}],reason:form.get('reason')});showToast('Devolução concluída.','success');await renderReturns();}catch(error){showToast(error.message,'error');}});
  }

  async function renderFinance(filters={}){
    await ready();
    const state={
      query:String(filters.query||''),
      kind:String(filters.kind||''),
      status:String(filters.status||''),
      fromDate:String(filters.fromDate||''),
      toDate:String(filters.toDate||''),
      categoryId:String(filters.categoryId||''),
      costCenterId:String(filters.costCenterId||'')
    };
    const entryFilters={};
    if(state.query)entryFilters.query=state.query;
    if(state.kind)entryFilters.kind=state.kind;
    if(state.status==='OVERDUE')entryFilters.overdue='true';
    else if(state.status)entryFilters.status=state.status;
    if(state.fromDate)entryFilters.from=new Date(`${state.fromDate}T00:00:00`).toISOString();
    if(state.toDate)entryFilters.to=new Date(`${state.toDate}T23:59:59.999`).toISOString();
    if(state.categoryId)entryFilters.categoryId=state.categoryId;
    if(state.costCenterId)entryFilters.costCenterId=state.costCenterId;

    const [summary,entries,accounts,categories,centers]=await Promise.all([
      api.financeSummary(),api.financeEntries(entryFilters),api.financeAccounts(),api.financeCategories(),api.costCenters()
    ]);
    const categoryById=new Map(categories.map(row=>[String(row.id),row]));
    const centerById=new Map(centers.map(row=>[String(row.id),row]));
    const received=Number(summary.receivableSettledCents||0),paid=Number(summary.payableSettledCents||0);
    const todayDate=new Date().toISOString().slice(0,10);
    const filterOptions=(rows,selected)=>rows.map(row=>`<option value="${escapeHtml(row.id)}" ${String(row.id)===selected?'selected':''}>${escapeHtml(row.name)}</option>`).join('');
    const body=`<div class="ops-metrics">${metric('A pagar',money(summary.payableOpenCents||0),`Vencido ${money(summary.overduePayableCents||0)}`)}${metric('A receber',money(summary.receivableOpenCents||0),`Vencido ${money(summary.overdueReceivableCents||0)}`)}${metric('Recebido',money(received))}${metric('Pago',money(paid))}${metric('Fluxo realizado',money(received-paid),'Recebido menos pago')}</div>
      <section class="ops-card ops-finance-filter-card"><form id="ops-finance-filter" class="ops-finance-filter" novalidate>
        <label>Buscar<input name="query" class="ops-input" type="search" value="${escapeHtml(state.query)}" placeholder="Descrição do lançamento"></label>
        <label>Tipo<select name="kind" class="ops-input"><option value="">Todos</option><option value="PAYABLE" ${state.kind==='PAYABLE'?'selected':''}>Conta a pagar</option><option value="RECEIVABLE" ${state.kind==='RECEIVABLE'?'selected':''}>Conta a receber</option></select></label>
        <label>Situação<select name="status" class="ops-input"><option value="">Todas</option><option value="OPEN" ${state.status==='OPEN'?'selected':''}>Em aberto</option><option value="PARTIAL" ${state.status==='PARTIAL'?'selected':''}>Parcial</option><option value="SETTLED" ${state.status==='SETTLED'?'selected':''}>Liquidado</option><option value="OVERDUE" ${state.status==='OVERDUE'?'selected':''}>Vencido</option><option value="CANCELLED" ${state.status==='CANCELLED'?'selected':''}>Cancelado</option></select></label>
        <label>Vencimento de<input name="fromDate" type="date" class="ops-input" value="${escapeHtml(state.fromDate)}"></label>
        <label>Vencimento até<input name="toDate" type="date" class="ops-input" value="${escapeHtml(state.toDate)}"></label>
        <label>Categoria<select name="categoryId" class="ops-input"><option value="">Todas</option>${filterOptions(categories,state.categoryId)}</select></label>
        <label>Centro de custo<select name="costCenterId" class="ops-input"><option value="">Todos</option>${filterOptions(centers,state.costCenterId)}</select></label>
        <div class="ops-actions ops-finance-filter-actions"><button class="ops-primary" type="submit">Aplicar filtros</button><button class="ops-secondary" id="ops-finance-filter-clear" type="button">Limpar</button></div>
      </form></section>
      <div class="ops-grid finance-layout"><section class="ops-card"><h2>Novo lançamento</h2><form id="ops-finance-form" class="ops-form" novalidate>
        <label>Tipo<select name="kind" class="ops-input"><option value="PAYABLE">Conta a pagar</option><option value="RECEIVABLE">Conta a receber</option></select></label>
        <label>Descrição<input name="description" class="ops-input" required></label>
        <label>Categoria gerencial<select name="categoryId" class="ops-input"><option value="">Sem categoria</option>${filterOptions(categories,'')}</select></label>
        <label>Centro de custo<select name="costCenterId" class="ops-input"><option value="">Sem centro</option>${filterOptions(centers,'')}</select></label>
        <label>Competência<input name="competencyDate" type="date" class="ops-input" value="${escapeHtml(todayDate)}"></label>
        <label>Conta<select name="accountId" class="ops-input"><option value="">Sem conta</option>${accounts.map(account=>`<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('')}</select></label>
        <label>Valor (R$)<input name="amount" class="ops-input" inputmode="decimal" required></label>
        <label>Vencimento<input name="dueAt" type="date" class="ops-input" required></label>
        <button class="ops-primary" type="submit">Criar lançamento</button>
      </form></section>
      <section class="ops-card grow"><div class="ops-card-head"><div><h2>Lançamentos</h2><p>${entries.length} registro${entries.length===1?'':'s'} no recorte atual</p></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Em aberto</th><th>Status</th><th></th></tr></thead><tbody>${entries.map(row=>`<tr><td>${dateOnly(row.dueAt)}</td><td><strong>${escapeHtml(row.description)}</strong><small>${escapeHtml(categoryById.get(String(row.categoryId))?.name||row.category||'Sem categoria')}</small></td><td>${escapeHtml(financeKindLabel(row.kind))}</td><td>${money(row.amountCents)}</td><td>${money(row.openCents)}</td><td>${financeStatusBadge(row)}</td><td><div class="ops-row-actions"><button class="ops-link" data-finance-detail="${escapeHtml(row.id)}">Detalhes</button>${row.openCents>0&&row.status!=='CANCELLED'?`<button class="ops-link" data-finance-settle="${escapeHtml(row.id)}" data-open="${row.openCents}">Baixar</button>`:''}${row.status==='OPEN'?`<button class="ops-link danger" data-finance-cancel="${escapeHtml(row.id)}">Cancelar</button>`:''}</div></td></tr>`).join('')||`<tr><td colspan="7">${empty('Nenhum lançamento financeiro neste recorte.')}</td></tr>`}</tbody></table></div></section></div>`;
    if(!routeActive('finance'))return;
    content.innerHTML=page('Financeiro','Contas a pagar e receber com baixas parciais, histórico e rastreabilidade.',body);

    const renderWithState=next=>renderFinance({...state,...next});
    document.getElementById('ops-finance-filter')?.addEventListener('submit',event=>{
      event.preventDefault();const form=new FormData(event.currentTarget);
      const fromDate=String(form.get('fromDate')||''),toDate=String(form.get('toDate')||'');
      if(fromDate&&toDate&&fromDate>toDate){showToast('A data inicial não pode ser posterior à data final.','error');return;}
      void renderFinance({query:form.get('query'),kind:form.get('kind'),status:form.get('status'),fromDate,toDate,categoryId:form.get('categoryId'),costCenterId:form.get('costCenterId')});
    });
    document.getElementById('ops-finance-filter-clear')?.addEventListener('click',()=>void renderFinance({}));

    document.getElementById('ops-finance-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=new FormData(event.currentTarget);
      const description=String(form.get('description')||'').trim(),amountCents=centsInput(form.get('amount')),dueAt=String(form.get('dueAt')||'');
      if(!description){showToast('Informe a descrição do lançamento.','error');event.currentTarget.elements.description?.focus();return;}
      if(amountCents<=0){showToast('Informe um valor maior que zero.','error');event.currentTarget.elements.amount?.focus();return;}
      if(!dueAt){showToast('Informe o vencimento.','error');event.currentTarget.elements.dueAt?.focus();return;}
      try{
        await api.createFinanceEntry({kind:form.get('kind'),description,categoryId:form.get('categoryId')||null,costCenterId:form.get('costCenterId')||null,competencyDate:form.get('competencyDate')||null,accountId:form.get('accountId')||null,amountCents,dueAt:new Date(`${dueAt}T12:00:00`).toISOString()});
        showToast('Lançamento criado.','success');await renderWithState({});
      }catch(error){showToast(error.message,'error');}
    });

    async function reverseSettlement(entry,settlement){
      if(!ux?.openFormDialog){showToast('Diálogo financeiro indisponível.','error');return;}
      modal?.close?.();
      const result=await ux.openFormDialog({
        title:'Estornar baixa',
        description:`${entry.description} · ${money(settlement.amountCents)} · ${financeMethodLabel(settlement.method)}`,
        confirmLabel:'Estornar baixa',tone:'danger',initialFocus:'cancel',
        body:`<div class="ux-dialog__summary"><strong>${escapeHtml(entry.description)}</strong><span>A baixa continuará no histórico marcada como estornada.</span></div><label>Motivo<textarea name="reason" class="ops-input" rows="3"></textarea></label>`,
        validate:data=>String(data.reason||'').trim()?null:{message:'Informe o motivo do estorno.',field:'reason'},
        onConfirm:data=>api.reverseFinanceSettlement(settlement.id,String(data.reason||'').trim())
      });
      if(result.confirmed){showToast('Baixa estornada.','success');await renderWithState({});}
    }

    async function openFinanceDetail(entryId){
      if(!modal?.open){showToast('Detalhes indisponíveis.','error');return;}
      try{
        const entry=await api.financeEntry(entryId);
        const category=categoryById.get(String(entry.categoryId)),center=centerById.get(String(entry.costCenterId));
        const history=entry.settlementHistory||entry.settlements||[];
        const historyHtml=history.length?history.slice().reverse().map(item=>`<div class="ops-detail-row"><div class="ops-detail-copy"><strong>${money(item.amountCents)} · ${escapeHtml(financeMethodLabel(item.method))}</strong><small>${when(item.createdAt)}${item.note?` · ${escapeHtml(item.note)}`:''}${item.reversedAt?` · Estornada em ${when(item.reversedAt)}`:''}</small></div>${!item.reversedAt?`<button class="ops-secondary" type="button" data-finance-reverse="${escapeHtml(item.id)}">Estornar</button>`:`<span class="ops-badge status-cancelled">Estornada</span>`}</div>`).join(''):'<div class="ops-empty">Nenhuma baixa registrada.</div>';
        const body=`<div class="ops-details"><div><dt>Tipo</dt><dd>${escapeHtml(financeKindLabel(entry.kind))}</dd></div><div><dt>Situação</dt><dd>${escapeHtml(FINANCE_STATUS_LABELS[financeStatusCode(entry)]||financeStatusCode(entry))}</dd></div><div><dt>Valor</dt><dd>${money(entry.amountCents)}</dd></div><div><dt>Em aberto</dt><dd>${money(entry.openCents)}</dd></div><div><dt>Vencimento</dt><dd>${dateOnly(entry.dueAt)}</dd></div><div><dt>Competência</dt><dd>${dateOnly(entry.competencyDate)}</dd></div><div><dt>Categoria</dt><dd>${escapeHtml(category?.name||entry.category||'Sem categoria')}</dd></div><div><dt>Centro de custo</dt><dd>${escapeHtml(center?.name||'Sem centro')}</dd></div><div><dt>Origem</dt><dd>${escapeHtml([entry.sourceType,entry.sourceId].filter(Boolean).join(' · ')||'Lançamento manual')}</dd></div></div><h3>Histórico de baixas</h3><div id="ops-finance-settlement-history">${historyHtml}</div>`;
        modal.open(entry.description,body,{wide:true,onMount(modalRoot){
          modalRoot.querySelectorAll('[data-finance-reverse]').forEach(button=>button.addEventListener('click',()=>{
            const settlement=history.find(item=>String(item.id)===String(button.dataset.financeReverse));
            if(settlement)void reverseSettlement(entry,settlement);
          }));
        }});
      }catch(error){showToast(error.message,'error');}
    }

    content.querySelectorAll('[data-finance-detail]').forEach(button=>button.addEventListener('click',()=>void openFinanceDetail(button.dataset.financeDetail)));
    content.querySelectorAll('[data-finance-settle]').forEach(button=>button.addEventListener('click',async()=>{
      const row=entries.find(item=>String(item.id)===String(button.dataset.financeSettle));if(!row)return;
      if(!ux?.openFormDialog){showToast('Diálogo financeiro indisponível.','error');return;}
      const suggested=(Number(row.openCents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      const result=await ux.openFormDialog({
        title:row.kind==='RECEIVABLE'?'Registrar recebimento':'Registrar pagamento',
        description:`${row.description} · saldo em aberto ${money(row.openCents)}`,
        confirmLabel:'Registrar baixa',
        body:`<div class="ux-dialog__summary"><strong>${escapeHtml(row.description)}</strong><span>Valor original ${money(row.amountCents)} · em aberto ${money(row.openCents)}</span></div><label>Valor da baixa (R$)<input name="amount" class="ops-input" inputmode="decimal" value="${escapeHtml(suggested)}"></label><label>Forma<select name="method" class="ops-input"><option value="MANUAL">Manual</option><option value="PIX">PIX</option><option value="DINHEIRO">Dinheiro</option><option value="TRANSFERENCIA">Transferência</option><option value="CARTAO">Cartão</option><option value="BOLETO">Boleto</option></select></label><label>Observação<textarea name="note" class="ops-input" rows="3"></textarea></label>`,
        validate:data=>{const amount=centsInput(data.amount);if(amount<=0)return{message:'Informe um valor de baixa maior que zero.',field:'amount'};if(amount>Number(row.openCents||0))return{message:'O valor da baixa não pode exceder o saldo em aberto.',field:'amount'};return null;},
        onConfirm:data=>api.settleFinanceEntry(row.id,{amountCents:centsInput(data.amount),method:data.method||'MANUAL',note:String(data.note||'').trim()||null})
      });
      if(result.confirmed){showToast('Baixa registrada.','success');await renderWithState({});}
    }));
    content.querySelectorAll('[data-finance-cancel]').forEach(button=>button.addEventListener('click',async()=>{
      const row=entries.find(item=>String(item.id)===String(button.dataset.financeCancel));if(!row)return;
      if(!ux?.openFormDialog){showToast('Diálogo financeiro indisponível.','error');return;}
      const result=await ux.openFormDialog({
        title:'Cancelar lançamento',
        description:`${row.description} · ${money(row.openCents)} em aberto`,
        confirmLabel:'Cancelar lançamento',tone:'danger',initialFocus:'cancel',
        body:`<div class="ux-dialog__summary"><strong>${escapeHtml(row.description)}</strong><span>O lançamento será cancelado e deixará de compor os saldos financeiros.</span></div><label>Motivo<textarea name="reason" class="ops-input" rows="3"></textarea></label>`,
        validate:data=>String(data.reason||'').trim()?null:{message:'Informe o motivo do cancelamento.',field:'reason'},
        onConfirm:data=>api.cancelFinanceEntry(row.id,String(data.reason||'').trim())
      });
      if(result.confirmed){showToast('Lançamento cancelado.','success');await renderWithState({});}
    }));
  }

  async function renderReports(selected={}){
    await ready();
    const now=new Date();const firstDay=new Date(now.getFullYear(),now.getMonth(),1);
    const dateValue=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    const fromDate=selected.fromDate||dateValue(firstDay);const toDate=selected.toDate||dateValue(now);const sellerId=selected.sellerId||'';
    const filters={from:new Date(`${fromDate}T00:00:00`).toISOString(),to:new Date(`${toDate}T23:59:59.999`).toISOString(),sellerId};
    const [sales,inventory,cash,finance,sellers,commissions,products,rules]=await Promise.all([api.reportSales(filters),api.reportInventory(),api.reportCash(filters),api.reportFinance(filters),api.sellers(),api.commissions(filters),api.products(),api.commissionRules({includeInactive:true})]);
    const filterForm=`<section class="ops-card"><form id="ops-report-filter" class="ops-form" style="grid-template-columns:repeat(4,minmax(150px,1fr));align-items:end"><label>Data inicial<input name="fromDate" type="date" class="ops-input" value="${escapeHtml(fromDate)}" required></label><label>Data final<input name="toDate" type="date" class="ops-input" value="${escapeHtml(toDate)}" required></label><label>Vendedor / Garçom<select name="sellerId" class="ops-input"><option value="">Todos</option>${sellers.map(seller=>`<option value="${escapeHtml(seller.id)}" ${seller.id===sellerId?'selected':''}>${escapeHtml(seller.name)}</option>`).join('')}</select></label><button class="ops-primary" type="submit">Aplicar filtros</button></form></section>`;
    const commissionSection=`<div class="ops-grid two"><section class="ops-card"><h2>Comissões por vendedor / garçom</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vendedor</th><th>Gerada</th><th>Estornada</th><th>Paga</th><th>Em aberto</th><th></th></tr></thead><tbody>${(commissions.sellers||[]).map(row=>`<tr><td>${escapeHtml(row.sellerName)}</td><td>${money(row.earnedCents)}</td><td>${money(row.reversedCents)}</td><td>${money(row.paidCents)}</td><td><strong>${money(row.outstandingCents)}</strong></td><td><button class="ops-link" data-pay-commission="${escapeHtml(row.sellerId)}" data-outstanding="${row.outstandingCents}" ${row.outstandingCents<=0?'disabled':''}>Registrar pagamento</button></td></tr>`).join('')||`<tr><td colspan="6">${empty('Sem comissões no período.')}</td></tr>`}</tbody></table></div></section><section class="ops-card"><h2>Regra de comissão</h2><form id="ops-commission-rule" class="ops-form"><label>Vendedor / Garçom<select name="sellerId" class="ops-input" required>${sellers.map(seller=>`<option value="${escapeHtml(seller.id)}">${escapeHtml(seller.name)}</option>`).join('')}</select></label><label>Produto específico<select name="productId" class="ops-input"><option value="">Regra padrão para todos os produtos</option>${products.map(product=>`<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join('')}</select></label><label>Comissão (%)<input name="percent" class="ops-input" type="number" min="0" max="100" step="0.01" required></label><button class="ops-primary" type="submit">Salvar regra</button></form><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vendedor</th><th>Aplicação</th><th>%</th><th>Status</th></tr></thead><tbody>${rules.map(rule=>`<tr><td>${escapeHtml(rule.sellerName)}</td><td>${escapeHtml(rule.productName||'Todos os produtos')}</td><td>${(rule.commissionBps/100).toLocaleString('pt-BR')}%</td><td>${rule.active?'Ativa':'Inativa'}</td></tr>`).join('')||`<tr><td colspan="4">${empty('Nenhuma regra cadastrada.')}</td></tr>`}</tbody></table></div></section></div>`;
    const body=`${filterForm}<div class="ops-metrics">${metric('Vendas líquidas',money(sales.netSalesCents||0),`${sales.salesCount||0} vendas`)}${metric('Devoluções',money(sales.returnedCents||0))}${metric('Cancelamentos',money(sales.cancelledSalesCents||0),`${sales.cancelledSalesCount||0} vendas canceladas`)}${metric('Comissões geradas',money(commissions.totalEarnedCents||0))}</div><div class="ops-grid two"><section class="ops-card"><h2>Vendas por vendedor / garçom</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vendedor</th><th>Vendas</th><th>Devoluções</th><th>Líquido</th><th>Canceladas</th></tr></thead><tbody>${(sales.sellers||[]).map(row=>`<tr><td>${escapeHtml(row.sellerName||row.sellerId||'—')}</td><td>${row.salesCount||0}</td><td>${money(row.returnedCents||0)}</td><td>${money(row.salesCents||0)}</td><td>${row.cancelledSalesCount||0} · ${money(row.cancelledSalesCents||0)}</td></tr>`).join('')||`<tr><td colspan="5">${empty('Sem vendas no período.')}</td></tr>`}</tbody></table></div></section><section class="ops-card"><h2>Formas de pagamento</h2><div class="ops-bars">${Object.entries(sales.paymentsByMethod||{}).map(([method,value])=>`<div><span>${escapeHtml(method)}</span><strong>${money(value)}</strong></div>`).join('')||empty('Sem vendas no período.')}</div></section></div>${commissionSection}<section class="ops-card"><div class="ops-card-head"><h2>Produtos mais vendidos</h2><button id="ops-export-sales" class="ops-secondary">Exportar vendas CSV</button></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>Quantidade</th><th>Faturamento bruto</th></tr></thead><tbody>${(sales.topProducts||[]).slice(0,30).map(row=>`<tr><td>${escapeHtml(row.productName)}</td><td>${qty(row.quantity)}</td><td>${money(row.grossCents)}</td></tr>`).join('')||`<tr><td colspan="3">${empty('Sem dados de vendas.')}</td></tr>`}</tbody></table></div></section>`;
    if(!routeActive('reports'))return;
    content.innerHTML=page('Relatórios','Indicadores do período selecionado, calculados sobre o histórico completo.',body);
    document.getElementById('ops-report-filter')?.addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);void renderReports({fromDate:String(form.get('fromDate')),toDate:String(form.get('toDate')),sellerId:String(form.get('sellerId')||'')});});
    document.getElementById('ops-commission-rule')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await api.saveCommissionRule({sellerId:String(form.get('sellerId')),productId:String(form.get('productId')||'')||null,commissionBps:Math.round(Number(form.get('percent'))*100)});showToast('Regra de comissão salva. As vendas já concluídas não serão alteradas.','success');await renderReports({fromDate,toDate,sellerId});}catch(error){showToast(error.message,'error');}});
    content.querySelectorAll('[data-pay-commission]').forEach(button=>button.addEventListener('click',async()=>{const suggested=(Number(button.dataset.outstanding||0)/100).toFixed(2).replace('.',',');const value=root.prompt('Valor da comissão paga (R$):',suggested);if(value===null)return;const note=root.prompt('Observação do pagamento:','')||'';try{await api.payCommission({sellerId:button.dataset.payCommission,amountCents:centsInput(value),periodFrom:filters.from,periodTo:filters.to,note});showToast('Pagamento de comissão registrado.','success');await renderReports({fromDate,toDate,sellerId});}catch(error){showToast(error.message,'error');}}));
    document.getElementById('ops-export-sales')?.addEventListener('click',async()=>{try{const result=await api.exportSalesCsv(filters);const blob=new Blob([result.csv||''],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`vendas-${fromDate}-a-${toDate}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){showToast(error.message,'error');}});
  }

  async function renderSettings(){
    await ready();const [hardware,fiscal,jobs]=await Promise.all([root.artisysDesktop.hardware.status().catch(()=>({})),root.artisysDesktop.fiscal.status(api.sessionToken).catch(()=>({configured:false})),api.printJobs().catch(()=>[])]);
    const device=(name)=>hardware?.[name]||{available:false};
    const canConfigureFiscal=document.body.dataset.userRole==='admin';
    const body=`<div class="ops-grid two"><section id="settings-devices" class="ops-card"><h2>Hardware do terminal</h2><dl class="ops-details"><div><dt>Leitor</dt><dd>${badge(device('barcodeScanner').available?'Disponível':'Indisponível')}</dd></div><div><dt>Balança</dt><dd>${badge(device('scale').available?'Disponível':'Indisponível')}</dd></div><div><dt>Impressora</dt><dd>${badge(device('printer').available?'Disponível':'Indisponível')}</dd></div><div><dt>Gaveta</dt><dd>${badge(device('cashDrawer').available?'Disponível':'Indisponível')}</dd></div></dl><div class="ops-actions"><button id="ops-test-scale" class="ops-secondary">Ler balança</button><button id="ops-open-drawer" class="ops-secondary">Abrir gaveta</button></div></section><section id="settings-fiscal" class="ops-card"><h2>Fiscal Focus</h2><p class="ops-muted">O token é criptografado pelo sistema operacional e nunca é devolvido ao renderer.</p><div class="ops-status-line">${badge(fiscal.configured?'CONFIGURADO':'NÃO CONFIGURADO')}<span>${escapeHtml(fiscal.environment||'')}</span></div><form id="ops-fiscal-form" class="ops-form"><label>Ambiente<select name="environment" class="ops-input"><option value="homologation">Homologação</option><option value="production">Produção</option></select></label><label>Documento<select name="documentType" class="ops-input"><option value="nfce">NFC-e</option><option value="nfe">NF-e</option></select></label><label>Token<input name="token" type="password" class="ops-input" autocomplete="new-password" required></label><div class="ops-actions"><button class="ops-primary" type="submit">Salvar conexão</button><button id="ops-fiscal-test" class="ops-secondary" type="button">Testar</button><button id="ops-fiscal-remove" class="ops-danger" type="button">Remover</button></div></form></section></div><section class="ops-card"><h2>Fila de impressão</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Criado</th><th>Tipo</th><th>Entidade</th><th>Status</th><th>Tentativas</th><th>Erro</th><th></th></tr></thead><tbody>${jobs.slice(0,100).map(job=>`<tr><td>${when(job.createdAt)}</td><td>${escapeHtml(job.type)}</td><td>${escapeHtml(job.entityId||'—')}</td><td>${badge(job.status)}</td><td>${job.attempts}</td><td>${escapeHtml(job.lastError||'—')}</td><td>${job.status==='FAILED'?`<button class="ops-link" data-print-retry="${escapeHtml(job.id)}">Tentar novamente</button>`:''}</td></tr>`).join('')||`<tr><td colspan="7">${empty('Fila de impressão vazia.')}</td></tr>`}</tbody></table></div></section>`;
    if(!routeActive('settings'))return;
    content.innerHTML=page('Configurações','Administre a empresa por área. Os módulos ativados ficam disponíveis na navegação de quem tem acesso.',body);
    if(!canConfigureFiscal){const form=document.getElementById('ops-fiscal-form');form?.querySelector('[name="token"]')?.closest('label')?.remove();form?.querySelectorAll('select').forEach(field=>{field.disabled=true;});form?.querySelector('button[type="submit"]')?.remove();document.getElementById('ops-fiscal-remove')?.remove();form?.insertAdjacentHTML('afterbegin','<p class="ops-muted">Somente administradores podem alterar a conexão fiscal. Gerentes podem consultar o status e executar testes.</p>');}
    document.getElementById('ops-test-scale')?.addEventListener('click',async()=>{try{const value=await root.artisysDesktop.hardware.readWeight();showToast(`Peso: ${qty(value.weight)} kg`,'success');}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-open-drawer')?.addEventListener('click',async()=>{try{await root.artisysDesktop.hardware.openDrawer();showToast('Comando enviado à gaveta.','success');}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-fiscal-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await root.artisysDesktop.fiscal.save({provider:'focus',environment:form.get('environment'),documentType:form.get('documentType'),token:form.get('token')},api.sessionToken);event.currentTarget.elements.token.value='';showToast('Conexão fiscal salva com criptografia do sistema.','success');await renderSettings();}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-fiscal-test')?.addEventListener('click',async()=>{try{const result=await root.artisysDesktop.fiscal.test(api.sessionToken);showToast(result.reachable?'Conexão fiscal validada.':(result.error||'Falha na conexão fiscal.'),result.reachable?'success':'error');}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-fiscal-remove')?.addEventListener('click',async()=>{if(!confirm('Remover a conexão fiscal deste terminal?'))return;try{await root.artisysDesktop.fiscal.remove(api.sessionToken);showToast('Conexão fiscal removida.','success');await renderSettings();}catch(error){showToast(error.message,'error');}});
    content.querySelectorAll('[data-print-retry]').forEach(button=>button.addEventListener('click',async()=>{try{await api.retryPrint(button.dataset.printRetry);showToast('Impressão devolvida à fila.','success');await renderSettings();}catch(error){showToast(error.message,'error');}}));
  }

  const renderers={inventory:renderInventory,cash:renderCash,sales:renderSalesHistory,returns:renderReturns,finance:renderFinance,reports:renderReports,settings:renderSettings};
  async function showRoute(route){if(!renderers[route])return;if(!canAccess(route)){markActive('home');root.document.querySelector('#sidebar-nav [data-route="home"]')?.click();return;}markActive(route);content.innerHTML=page('Carregando','Consultando o servidor local…','<div class="ops-loader"></div>');try{await renderers[route]();if(routeActive(route))content.focus({preventScroll:true});}catch(error){if(!routeActive(route))return;content.innerHTML=page('Não foi possível carregar','O servidor local recusou ou não concluiu a operação.',`<div class="ops-error">${escapeHtml(error.message)}</div>`);showToast(error.message,'error');}}

  root.addEventListener('click',event=>{const target=event.target.closest?.('[data-route],[data-home-route]');if(!target)return;const route=target.dataset.route||target.dataset.homeRoute;if(!OPERATIONAL_ROUTES.has(route))return;event.preventDefault();event.stopImmediatePropagation();void showRoute(route);},true);
  root.addEventListener('keydown',event=>{if(!SHORTCUTS[event.key]||document.querySelector('.checkout-layout'))return;event.preventDefault();event.stopImmediatePropagation();void showRoute(SHORTCUTS[event.key]);},true);
  root.PdvOperationalUi=Object.freeze({showRoute,renderInventory,renderCash,renderSalesHistory,renderReturns,renderFinance,renderReports,renderSettings});
})();
