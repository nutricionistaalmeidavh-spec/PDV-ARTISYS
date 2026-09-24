'use strict';

(() => {
  const root = window;
  const { ApiClient } = root.PdvApiClient;
  const api = new ApiClient();
  const ui = root.PdvUiModel;
  const content = document.getElementById('route-content');
  const toastRoot = document.getElementById('toast-root');
  const OPERATIONAL_ROUTES = new Set(['inventory','cash','sales','returns','finance','reports','settings']);
  const SHORTCUTS = Object.freeze({ F6:'inventory',F7:'cash',F8:'finance',F9:'reports',F10:'sales',F11:'returns' });
  let config = null;

  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);}
  function money(value){return ui?.formatCents ? ui.formatCents(value) : (Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function qty(value){return Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});}
  function when(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?escapeHtml(value):date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
  function centsInput(value){const text=String(value??'').trim().replace(/\./g,'').replace(',','.');const n=Number(text);return Number.isFinite(n)?Math.round(n*100):0;}
  function showToast(message,type=''){if(!toastRoot)return;const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;toastRoot.appendChild(node);setTimeout(()=>node.remove(),3500);}
  function empty(message){return `<div class="ops-empty">${escapeHtml(message)}</div>`;}
  function badge(value){const normalized=String(value||'').toLowerCase();return `<span class="ops-badge status-${escapeHtml(normalized)}">${escapeHtml(value||'—')}</span>`;}
  function metric(label,value,hint=''){return `<article class="ops-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${hint?`<small>${escapeHtml(hint)}</small>`:''}</article>`;}
  function page(title,subtitle,body,actions=''){return `<section class="ops-page"><header class="ops-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="ops-head-actions">${actions}</div></header>${body}</section>`;}
  async function ready(){if(!config)config=await api.initialize();return config;}
  function routeActive(route){return document.body.dataset.activeRoute===route;}
  function markActive(route){document.body.dataset.activeRoute=route;document.body.classList.remove('theme-home');document.querySelectorAll('[data-route]').forEach(node=>node.classList.toggle('active',node.dataset.route===route));}

  async function renderInventory(){
    await ready();
    const [balances,low,movements]=await Promise.all([api.inventoryBalances(),api.inventoryLowStock(),api.inventoryMovements()]);
    const totalCost=balances.reduce((sum,item)=>sum+Math.round(Number(item.costCents||0)*Number(item.quantity||0)),0);
    const body=`<div class="ops-metrics">${metric('SKUs controlados',String(balances.length))}${metric('Estoque baixo',String(low.length),low.length?'Requer atenção':'Dentro do mínimo')}${metric('Valor em custo',money(totalCost))}</div>
      <div class="ops-grid two"><section class="ops-card"><div class="ops-card-head"><h2>Posição de estoque</h2><input id="ops-inventory-search" class="ops-input compact" placeholder="Filtrar produto"></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>SKU</th><th>Saldo</th><th>Mínimo</th><th>Situação</th></tr></thead><tbody id="ops-inventory-body">${balances.map(item=>`<tr data-search="${escapeHtml(`${item.name} ${item.sku||''} ${item.barcode||''}`.toLowerCase())}"><td><strong>${escapeHtml(item.name)}</strong></td><td>${escapeHtml(item.sku||'—')}</td><td>${qty(item.quantity)} ${escapeHtml(item.unit||'')}</td><td>${qty(item.minimumStock)}</td><td>${item.lowStock?badge('BAIXO'):badge('OK')}</td></tr>`).join('')||`<tr><td colspan="5">${empty('Nenhum produto controlado.')}</td></tr>`}</tbody></table></div></section>
      <section class="ops-card"><h2>Nova movimentação</h2><form id="ops-inventory-form" class="ops-form"><label>Produto<select name="productId" class="ops-input" required>${balances.map(item=>`<option value="${escapeHtml(item.productId)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><label>Tipo<select name="type" class="ops-input"><option value="purchase">Entrada/compra</option><option value="adjustment-in">Ajuste de entrada</option><option value="adjustment-out">Ajuste de saída</option><option value="inventory-count">Inventário</option></select></label><label>Quantidade<input name="quantity" class="ops-input" type="number" min="0.001" step="0.001" required></label><label>Motivo<input name="reason" class="ops-input" required placeholder="Motivo da movimentação"></label><button class="ops-primary" type="submit">Registrar movimentação</button></form></section></div>
      <section class="ops-card"><h2>Movimentações recentes</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Produto</th><th>Tipo</th><th>Antes</th><th>Movimento</th><th>Depois</th><th>Motivo</th></tr></thead><tbody>${movements.slice(0,100).map(item=>`<tr><td>${when(item.createdAt)}</td><td>${escapeHtml(balances.find(p=>p.productId===item.productId)?.name||item.productId)}</td><td>${escapeHtml(item.type)}</td><td>${qty(item.quantityBefore)}</td><td>${qty(item.quantityDelta)}</td><td>${qty(item.quantityAfter)}</td><td>${escapeHtml(item.reason||'—')}</td></tr>`).join('')||`<tr><td colspan="7">${empty('Sem movimentações.')}</td></tr>`}</tbody></table></div></section>`;
    if(!routeActive('inventory'))return;
    content.innerHTML=page('Estoque','Saldos, mínimos e movimentações imutáveis.',body);
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
    const cfg=await ready();
    const [rowsPayload,session,salesPayload]=await Promise.all([api.returns({}),api.currentSession(),api.salesHistory({status:'COMPLETED',limit:100})]);
    const rows=Array.isArray(rowsPayload)?rowsPayload:(rowsPayload?.returns||[]);
    const recentSales=Array.isArray(salesPayload)?salesPayload:(salesPayload?.sales||[]);
    const role=String(session?.user?.role||'');
    const needsDelegatedApproval=!['manager','admin'].includes(role);
    const history=rows.slice(0,8);
    const body=`<div class="ops-returns-layout"><div class="ops-return-workflow"><section class="ops-card"><div class="ops-card-head"><div><h2>Buscar venda</h2><p>Localize uma venda concluída por número, cliente, vendedor, operador ou data.</p></div></div><form id="ops-return-search-form" class="ops-return-search-form"><input id="ops-return-search" class="ops-input" autocomplete="off" placeholder="Buscar venda concluída"><button class="ops-secondary" type="submit">Buscar</button></form><div id="ops-return-results" class="ops-return-search-results">${empty('Busque ou selecione uma venda recente.')}</div></section><section id="ops-return-selected-sale" class="ops-card">${empty('Selecione uma venda para iniciar a devolução.')}</section><section class="ops-card"><h2>Reembolso e autorização</h2><form id="ops-return-form" class="ops-form"><label>Forma de reembolso<select id="ops-return-method" name="method" class="ops-input"><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="DEBIT_CARD">Cartão débito</option><option value="CREDIT_CARD">Cartão crédito</option><option value="STORE_CREDIT">Crédito loja</option><option value="OTHER">Outra / reembolso misto</option></select></label><label>Motivo<input id="ops-return-reason" name="reason" class="ops-input" required maxlength="240" placeholder="Motivo da devolução"></label><div id="ops-return-authorization" class="ops-return-authorization ops-return-auth-panel"></div><div id="ops-return-summary" class="ops-return-summary"><span>0 item selecionado</span><strong id="ops-return-total">${money(0)}</strong></div><button id="ops-return-submit" class="ops-primary" type="submit" disabled>Concluir devolução</button></form></section></div><section class="ops-card"><div class="ops-card-head"><div><h2>Devoluções realizadas</h2><p>Histórico recente com venda, total e autorização.</p></div></div><div id="ops-return-cancel-panel"></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Venda</th><th>Total</th><th>Autorizado por</th><th>Status</th><th></th></tr></thead><tbody id="ops-return-history">${history.map(row=>`<tr><td>${when(row.createdAt)}</td><td>${escapeHtml(row.saleId)}</td><td>${money(row.totalCents)}</td><td>${escapeHtml(row.authorizedById||'—')}</td><td>${badge(row.status)}</td><td>${!needsDelegatedApproval&&row.status==='COMPLETED'?`<button class="ops-link danger" type="button" data-return-cancel="${escapeHtml(row.id)}">Cancelar</button>`:''}</td></tr>`).join('')||`<tr><td colspan="6">${empty('Nenhuma devolução registrada.')}</td></tr>`}</tbody></table></div></section></div>`;
    if(!routeActive('returns'))return;
    content.innerHTML=page('Devolução','Busque a venda, selecione somente o saldo devolvível, revise o reembolso e autorize a operação.',body);

    let selectedSale=null;
    let selectedSaleReturns=[];
    let returnedByItem=new Map();
    let approval=null;

    function approvalValid(){return !needsDelegatedApproval||Boolean(approval?.approvalToken&&new Date(approval.expiresAt).getTime()>Date.now());}

    function collectReturnItems(){
      const items=[];let total=0;let totalQuantity=0;let invalid='';
      content.querySelectorAll('[data-return-item]:checked').forEach(check=>{
        const id=check.dataset.returnItem;
        const quantity=Number(content.querySelector(`[data-return-qty="${CSS.escape(id)}"]`)?.value||0);
        const available=Number(check.dataset.available||0);
        const item=(selectedSale?.items||[]).find(candidate=>String(candidate.id)===String(id));
        if(!Number.isFinite(quantity)||quantity<=0){invalid='Quantidade devolvida deve ser maior que zero.';return;}
        if(quantity>available){invalid=`Quantidade devolvida excede o saldo disponível (${qty(available)}).`;return;}
        if(!item){invalid='Item da venda não encontrado.';return;}
        items.push({saleItemId:id,quantity});
        totalQuantity+=quantity;
        total+=Math.round(Number(item.unitPriceCents) * quantity);
      });
      return{items,total,totalQuantity,invalid};
    }

    function updateReturnSummary(){
      const summary=collectReturnItems();
      const summaryRoot=document.getElementById('ops-return-summary');
      const totalRoot=document.getElementById('ops-return-total');
      const reason=String(document.getElementById('ops-return-reason')?.value||'').trim();
      if(summaryRoot){const label=summary.invalid?summary.invalid:`${summary.items.length} ${summary.items.length===1?'item':'itens'} · ${qty(summary.totalQuantity)} unidade(s)`;summaryRoot.querySelector('span').textContent=label;summaryRoot.classList.toggle('has-error',Boolean(summary.invalid));}
      if(totalRoot)totalRoot.textContent=money(summary.total);
      const submit=document.getElementById('ops-return-submit');
      if(submit)submit.disabled=!selectedSale||!summary.items.length||!reason||Boolean(summary.invalid)||!approvalValid();
      return summary;
    }

    function bindReturnItemInputs(){
      content.querySelectorAll('[data-return-item],[data-return-qty]').forEach(node=>node.addEventListener('input',updateReturnSummary));
      content.querySelectorAll('[data-return-item]').forEach(node=>node.addEventListener('change',updateReturnSummary));
    }

    function renderAuthorization(){
      const authRoot=document.getElementById('ops-return-authorization');
      if(!authRoot)return;
      if(!selectedSale){authRoot.innerHTML='<p class="ops-muted">Selecione uma venda antes da autorização.</p>';updateReturnSummary();return;}
      if(!needsDelegatedApproval){authRoot.innerHTML=`<div class="ops-return-auth-status"><strong>Autorização pela sessão atual</strong><span>${escapeHtml(session?.user?.name||session?.user?.id||'Gerente')}</span></div>`;updateReturnSummary();return;}
      if(approval&&!approvalValid())approval=null;
      if(approval){authRoot.innerHTML=`<div class="ops-return-auth-status"><div><strong>Autorizado por ${escapeHtml(approval.authorizedBy?.name||approval.authorizedBy?.id||'Gerente')}</strong><small>Válida até ${when(approval.expiresAt)}</small></div><button id="ops-return-authorize" class="ops-secondary" type="button">Refazer autorização</button></div>`;}else{authRoot.innerHTML='<div class="ops-return-auth-status"><div><strong>Autorização gerencial necessária</strong><small>Use as credenciais locais de um gerente ou administrador.</small></div><button id="ops-return-authorize" class="ops-secondary" type="button">Autorizar devolução</button></div>';}
      document.getElementById('ops-return-authorize')?.addEventListener('click',()=>{
        authRoot.innerHTML=`<form id="ops-return-auth-form" class="ops-form ops-return-auth-form"><label>Usuário gerente/admin<input name="username" class="ops-input" autocomplete="username" required></label><label>Senha<input name="password" type="password" class="ops-input" autocomplete="current-password" required></label><button class="ops-primary" type="submit">Validar autorização</button></form>`;
        document.getElementById('ops-return-auth-form')?.addEventListener('submit',async event=>{
          event.preventDefault();const form=new FormData(event.currentTarget);const passwordInput=event.currentTarget.elements.password;
          try{approval=await api.authorizeReturn({username:String(form.get('username')||''),password:String(form.get('password')||''),saleId:selectedSale.id,terminalId:session?.terminalId||cfg?.terminalId||null});if(passwordInput)passwordInput.value='';showToast(`Autorizado por ${approval.authorizedBy?.name||approval.authorizedBy?.id||'gerente'}.`,'success');renderAuthorization();}catch(error){if(passwordInput)passwordInput.value='';approval=null;showToast(error.message,'error');renderAuthorization();}
        });
      });
      updateReturnSummary();
    }

    function inferRefundMethod(){
      const methods=[...new Set((selectedSale?.payments||[]).map(payment=>String(payment.method||payment.paymentMethod||'').trim()).filter(Boolean))];
      return methods.length===1?methods[0]:'OTHER';
    }

    function renderSelectedSale(){
      const host=document.getElementById('ops-return-selected-sale');if(!host||!selectedSale)return;
      const itemRows=(selectedSale.items||[]).map(item=>{
        const returned=Number(returnedByItem.get(item.id)||0);
        const available=Math.max(0,Number((Number(item.quantity||0)-returned).toFixed(3)));
        const initial=Math.min(1,available);
        return `<div class="ops-return-item ${available<=0?'is-disabled':''}"><input type="checkbox" data-return-item="${escapeHtml(item.id)}" data-available="${available}" ${available<=0?'disabled':''}><div class="ops-return-item-name"><strong>${escapeHtml(item.productName)}</strong><small>${money(item.unitPriceCents)} por unidade</small></div><span class="ops-return-meta">Vendido <strong>${qty(item.quantity)}</strong></span><span class="ops-return-meta">Devolvido <strong>${qty(returned)}</strong></span><span class="ops-return-meta">Disponível <strong>${qty(available)}</strong></span><label>Qtd.<input class="ops-input compact" data-return-qty="${escapeHtml(item.id)}" type="number" min="0.001" max="${available}" step="0.001" value="${initial}" ${available<=0?'disabled':''}></label></div>`;
      }).join('');
      const refundable=(selectedSale.items||[]).some(item=>Number(item.quantity||0)>Number(returnedByItem.get(item.id)||0));
      host.innerHTML=`<div class="ops-card-head"><div><h2>Venda ${escapeHtml(selectedSale.saleNumber||selectedSale.id)}</h2><p>${when(selectedSale.completedAt||selectedSale.openedAt)} · ${escapeHtml(selectedSale.customerName||'Consumidor')} · Total ${money(selectedSale.totalCents)}</p></div>${badge(selectedSale.status)}</div><div class="ops-return-items">${itemRows||empty('Venda sem itens.')}</div>${refundable?'':`<div class="ops-error">Todos os itens desta venda já foram devolvidos.</div>`}`;
      const method=document.getElementById('ops-return-method');if(method){const inferred=inferRefundMethod();method.value=[...method.options].some(option=>option.value===inferred)?inferred:'OTHER';}
      bindReturnItemInputs();updateReturnSummary();
    }

    async function selectSale(saleId){
      approval=null;const [sale,existingPayload]=await Promise.all([api.saleDetails(saleId),api.returns({saleId})]);
      if(!routeActive('returns'))return;
      selectedSale=sale;selectedSaleReturns=Array.isArray(existingPayload)?existingPayload:(existingPayload?.returns||[]);returnedByItem=new Map();
      for(const ret of selectedSaleReturns.filter(ret=>String(ret.status||'').toUpperCase()==='COMPLETED'))for(const item of ret.items||[])returnedByItem.set(item.saleItemId,Number(returnedByItem.get(item.saleItemId)||0)+Number(item.quantity||0));
      renderSelectedSale();renderAuthorization();
    }

    function saleSearchText(sale){return `${sale.saleNumber||''} ${sale.id||''} ${sale.customerName||''} ${sale.sellerName||''} ${sale.operatorName||''} ${sale.operatorId||''} ${sale.completedAt||sale.openedAt||''} ${when(sale.completedAt||sale.openedAt)}`.toLowerCase();}
    function searchSales(value){
      const query=String(value||'').trim().toLowerCase();const resultsRoot=document.getElementById('ops-return-results');if(!resultsRoot)return;
      const sales=recentSales.filter(sale=>!query||saleSearchText(sale).includes(query)).slice(0,30);
      resultsRoot.innerHTML=sales.map(sale=>`<article class="ops-return-sale-card"><div><strong>${escapeHtml(sale.saleNumber||sale.id)}</strong><p>${when(sale.completedAt||sale.openedAt)} · ${escapeHtml(sale.customerName||'Consumidor')} · ${escapeHtml(sale.sellerName||sale.operatorName||'')}</p><small>${money(sale.totalCents)}</small></div><button class="ops-link" type="button" data-return-sale-select="${escapeHtml(sale.id)}">Selecionar</button></article>`).join('')||empty('Nenhuma venda concluída encontrada.');
      resultsRoot.querySelectorAll('[data-return-sale-select]').forEach(button=>button.addEventListener('click',()=>{void selectSale(button.dataset.returnSaleSelect).catch(error=>showToast(error.message,'error'));}));
    }

    document.getElementById('ops-return-search-form')?.addEventListener('submit',event=>{event.preventDefault();searchSales(document.getElementById('ops-return-search')?.value||'');});
    document.getElementById('ops-return-search')?.addEventListener('input',event=>searchSales(event.target.value));
    document.getElementById('ops-return-reason')?.addEventListener('input',updateReturnSummary);
    document.getElementById('ops-return-form')?.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!selectedSale){showToast('Selecione uma venda concluída.','error');return;}
      const reason=String(document.getElementById('ops-return-reason')?.value||'').trim();if(!reason){showToast('Informe o motivo da devolução.','error');return;}
      const selection=collectReturnItems();if(selection.invalid){showToast(selection.invalid,'error');return;}if(!selection.items.length){showToast('Selecione ao menos um item.','error');return;}
      if(!approvalValid()){approval=null;renderAuthorization();showToast('Autorize a devolução com um gerente ou administrador.','error');return;}
      const method=document.getElementById('ops-return-method')?.value||'OTHER';
      try{const response=await api.createReturn({saleId:selectedSale.id,items:selection.items,refunds:[{method,amountCents:selection.total}],reason,...(needsDelegatedApproval?{approvalToken:approval.approvalToken}:{})});const created=response?.return||response;showToast(`Devolução ${created?.id||''} concluída — ${money(selection.total)}.`,'success');await renderReturns();}catch(error){if(needsDelegatedApproval){approval=null;renderAuthorization();}showToast(error.message,'error');}
    });

    content.querySelectorAll('[data-return-cancel]').forEach(button=>button.addEventListener('click',()=>{
      const panel=document.getElementById('ops-return-cancel-panel');if(!panel)return;const returnId=button.dataset.returnCancel;
      panel.className='ops-return-cancel-panel';panel.innerHTML=`<form id="ops-return-cancel-form" class="ops-form"><label>Motivo do cancelamento<input name="reason" class="ops-input" maxlength="240" autocomplete="off" required></label><div class="ops-actions"><button class="ops-danger" type="submit">Confirmar cancelamento</button><button class="ops-secondary" type="button" data-return-cancel-close>Voltar</button></div></form>`;
      panel.querySelector('[data-return-cancel-close]')?.addEventListener('click',()=>{panel.className='';panel.innerHTML='';});
      panel.querySelector('#ops-return-cancel-form')?.addEventListener('submit',async event=>{event.preventDefault();const reason=String(new FormData(event.currentTarget).get('reason')||'').trim();if(!reason)return;try{await api.cancelReturn(returnId,reason);showToast('Devolução cancelada.','success');await renderReturns();}catch(error){showToast(error.message,'error');}});
    }));

    renderAuthorization();
    searchSales('');
  }

  async function renderFinance(){
    await ready();const [summary,entries,accounts]=await Promise.all([api.financeSummary(),api.financeEntries(),api.financeAccounts()]);
    const body=`<div class="ops-metrics">${metric('A pagar',money(summary.payableOpenCents||0),`Vencido ${money(summary.overduePayableCents||0)}`)}${metric('A receber',money(summary.receivableOpenCents||0),`Vencido ${money(summary.overdueReceivableCents||0)}`)}${metric('Recebido/Pago',money((summary.receivableSettledCents||0)+(summary.payableSettledCents||0)))}</div><div class="ops-grid finance-layout"><section class="ops-card"><h2>Novo lançamento</h2><form id="ops-finance-form" class="ops-form"><label>Tipo<select name="kind" class="ops-input"><option value="PAYABLE">Conta a pagar</option><option value="RECEIVABLE">Conta a receber</option></select></label><label>Descrição<input name="description" class="ops-input" required></label><label>Categoria<input name="category" class="ops-input"></label><label>Conta<select name="accountId" class="ops-input"><option value="">Sem conta</option>${accounts.map(account=>`<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}</option>`).join('')}</select></label><label>Valor (R$)<input name="amount" class="ops-input" required></label><label>Vencimento<input name="dueAt" type="date" class="ops-input" required></label><button class="ops-primary" type="submit">Criar lançamento</button></form></section><section class="ops-card grow"><h2>Lançamentos</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vencimento</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Em aberto</th><th>Status</th><th></th></tr></thead><tbody>${entries.map(row=>`<tr><td>${when(row.dueAt)}</td><td><strong>${escapeHtml(row.description)}</strong><small>${escapeHtml(row.category||'')}</small></td><td>${escapeHtml(row.kind)}</td><td>${money(row.amountCents)}</td><td>${money(row.openCents)}</td><td>${badge(row.isOverdue&&row.status!=='SETTLED'?'OVERDUE':row.status)}</td><td><div class="ops-row-actions">${row.openCents>0&&row.status!=='CANCELLED'?`<button class="ops-link" data-finance-settle="${escapeHtml(row.id)}" data-open="${row.openCents}">Baixar</button>`:''}${row.status==='OPEN'?`<button class="ops-link danger" data-finance-cancel="${escapeHtml(row.id)}">Cancelar</button>`:''}</div></td></tr>`).join('')||`<tr><td colspan="7">${empty('Nenhum lançamento financeiro.')}</td></tr>`}</tbody></table></div></section></div>`;
    if(!routeActive('finance'))return;
    content.innerHTML=page('Financeiro','Contas a pagar e receber com baixas parciais e histórico.',body);
    document.getElementById('ops-finance-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await api.createFinanceEntry({kind:form.get('kind'),description:form.get('description'),category:form.get('category')||null,accountId:form.get('accountId')||null,amountCents:centsInput(form.get('amount')),dueAt:new Date(`${form.get('dueAt')}T12:00:00`).toISOString()});showToast('Lançamento criado.','success');await renderFinance();}catch(error){showToast(error.message,'error');}});
    content.querySelectorAll('[data-finance-settle]').forEach(button=>button.addEventListener('click',async()=>{const suggested=money(Number(button.dataset.open)).replace('R$','').trim();const value=root.prompt('Valor da baixa (R$):',suggested);if(value===null)return;try{await api.settleFinanceEntry(button.dataset.financeSettle,{amountCents:centsInput(value),method:'MANUAL'});showToast('Baixa registrada.','success');await renderFinance();}catch(error){showToast(error.message,'error');}}));
    content.querySelectorAll('[data-finance-cancel]').forEach(button=>button.addEventListener('click',async()=>{const reason=root.prompt('Motivo do cancelamento:');if(!reason)return;try{await api.cancelFinanceEntry(button.dataset.financeCancel,reason);showToast('Lançamento cancelado.','success');await renderFinance();}catch(error){showToast(error.message,'error');}}));
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
    await ready();const [hardware,fiscal,jobs]=await Promise.all([root.artisysDesktop.hardware.status().catch(()=>({})),root.artisysDesktop.fiscal.status().catch(()=>({configured:false})),api.printJobs().catch(()=>[])]);
    const device=(name)=>hardware?.[name]||{available:false};
    const body=`<div class="ops-grid two"><section class="ops-card"><h2>Hardware do terminal</h2><dl class="ops-details"><div><dt>Leitor</dt><dd>${badge(device('barcodeScanner').available?'Disponível':'Indisponível')}</dd></div><div><dt>Balança</dt><dd>${badge(device('scale').available?'Disponível':'Indisponível')}</dd></div><div><dt>Impressora</dt><dd>${badge(device('printer').available?'Disponível':'Indisponível')}</dd></div><div><dt>Gaveta</dt><dd>${badge(device('cashDrawer').available?'Disponível':'Indisponível')}</dd></div></dl><div class="ops-actions"><button id="ops-test-scale" class="ops-secondary">Ler balança</button><button id="ops-open-drawer" class="ops-secondary">Abrir gaveta</button></div></section><section class="ops-card"><h2>Fiscal Focus</h2><p class="ops-muted">O token é criptografado pelo sistema operacional e nunca é devolvido ao renderer.</p><div class="ops-status-line">${badge(fiscal.configured?'CONFIGURADO':'NÃO CONFIGURADO')}<span>${escapeHtml(fiscal.environment||'')}</span></div><form id="ops-fiscal-form" class="ops-form"><label>Ambiente<select name="environment" class="ops-input"><option value="homologation">Homologação</option><option value="production">Produção</option></select></label><label>Documento<select name="documentType" class="ops-input"><option value="nfce">NFC-e</option><option value="nfe">NF-e</option></select></label><label>Token<input name="token" type="password" class="ops-input" autocomplete="new-password" required></label><div class="ops-actions"><button class="ops-primary" type="submit">Salvar conexão</button><button id="ops-fiscal-test" class="ops-secondary" type="button">Testar</button><button id="ops-fiscal-remove" class="ops-danger" type="button">Remover</button></div></form></section></div><section class="ops-card"><h2>Fila de impressão</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Criado</th><th>Tipo</th><th>Entidade</th><th>Status</th><th>Tentativas</th><th>Erro</th><th></th></tr></thead><tbody>${jobs.slice(0,100).map(job=>`<tr><td>${when(job.createdAt)}</td><td>${escapeHtml(job.type)}</td><td>${escapeHtml(job.entityId||'—')}</td><td>${badge(job.status)}</td><td>${job.attempts}</td><td>${escapeHtml(job.lastError||'—')}</td><td>${job.status==='FAILED'?`<button class="ops-link" data-print-retry="${escapeHtml(job.id)}">Tentar novamente</button>`:''}</td></tr>`).join('')||`<tr><td colspan="7">${empty('Fila de impressão vazia.')}</td></tr>`}</tbody></table></div></section>`;
    if(!routeActive('settings'))return;
    content.innerHTML=page('Configurações','Hardware, impressão e conexão fiscal deste terminal.',body);
    document.getElementById('ops-test-scale')?.addEventListener('click',async()=>{try{const value=await root.artisysDesktop.hardware.readWeight();showToast(`Peso: ${qty(value.weight)} kg`,'success');}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-open-drawer')?.addEventListener('click',async()=>{try{await root.artisysDesktop.hardware.openDrawer();showToast('Comando enviado à gaveta.','success');}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-fiscal-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await root.artisysDesktop.fiscal.save({provider:'focus',environment:form.get('environment'),documentType:form.get('documentType'),token:form.get('token')});event.currentTarget.elements.token.value='';showToast('Conexão fiscal salva com criptografia do sistema.','success');await renderSettings();}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-fiscal-test')?.addEventListener('click',async()=>{try{const result=await root.artisysDesktop.fiscal.test();showToast(result.reachable?'Conexão fiscal validada.':(result.error||'Falha na conexão fiscal.'),result.reachable?'success':'error');}catch(error){showToast(error.message,'error');}});
    document.getElementById('ops-fiscal-remove')?.addEventListener('click',async()=>{try{await root.artisysDesktop.fiscal.remove();showToast('Conexão fiscal removida.','success');await renderSettings();}catch(error){showToast(error.message,'error');}});
    content.querySelectorAll('[data-print-retry]').forEach(button=>button.addEventListener('click',async()=>{try{await api.retryPrint(button.dataset.printRetry);showToast('Impressão devolvida à fila.','success');await renderSettings();}catch(error){showToast(error.message,'error');}}));
  }

  const renderers={inventory:renderInventory,cash:renderCash,sales:renderSalesHistory,returns:renderReturns,finance:renderFinance,reports:renderReports,settings:renderSettings};
  async function showRoute(route){if(!renderers[route])return;markActive(route);content.innerHTML=page('Carregando','Consultando o servidor local…','<div class="ops-loader"></div>');try{await renderers[route]();if(routeActive(route))content.focus({preventScroll:true});}catch(error){if(!routeActive(route))return;content.innerHTML=page('Não foi possível carregar','O servidor local recusou ou não concluiu a operação.',`<div class="ops-error">${escapeHtml(error.message)}</div>`);showToast(error.message,'error');}}

  root.addEventListener('click',event=>{const target=event.target.closest?.('[data-route],[data-home-route]');if(!target)return;const route=target.dataset.route||target.dataset.homeRoute;if(!OPERATIONAL_ROUTES.has(route))return;event.preventDefault();event.stopImmediatePropagation();void showRoute(route);},true);
  root.addEventListener('keydown',event=>{if(!SHORTCUTS[event.key]||document.querySelector('.checkout-layout'))return;event.preventDefault();event.stopImmediatePropagation();void showRoute(SHORTCUTS[event.key]);},true);
  root.PdvOperationalUi=Object.freeze({showRoute,renderInventory,renderCash,renderSalesHistory,renderReturns,renderFinance,renderReports,renderSettings});
})();