'use strict';

(()=>{
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  let financeMounting=false;
  let reportsMounting=false;
  let lastSaleDetailId='';

  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const when=value=>{if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleDateString('pt-BR');};
  const title=()=>document.querySelector('.ops-page .ops-head h1')?.textContent?.trim()||'';

  function toast(message,type='success'){
    const root=document.getElementById('toast-root');if(!root)return;
    const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;root.appendChild(node);setTimeout(()=>node.remove(),3500);
  }

  function routeButton(route){return [...document.querySelectorAll('[data-route]')].find(node=>node.dataset.route===route);}
  function toIsoStart(value){return value?new Date(`${value}T00:00:00`).toISOString():'';}
  function toIsoEnd(value){return value?new Date(`${value}T23:59:59.999`).toISOString():'';}

  function navigateToSale(saleId){
    if(!saleId)return;
    sessionStorage.setItem('artisys.finance.openSale',String(saleId));
    routeButton('sales')?.click();
  }

  function navigateToFinance(saleId){
    if(!saleId)return;
    sessionStorage.setItem('artisys.finance.saleId',String(saleId));
    routeButton('finance')?.click();
  }

  function rowOrigin(row){
    if(row.sourceType==='SALE')return `Venda ${row.saleNumber||row.saleId||row.sourceId}`;
    if(row.sourceType==='RETURN')return `Devolução ${row.returnId||row.sourceId}`;
    return 'Manual';
  }

  function filterClient(rows,filters){
    return rows.filter(row=>{
      if(filters.sourceType){const origin=row.sourceType||'MANUAL';if(origin!==filters.sourceType)return false;}
      if(filters.paymentMethod&&row.paymentMethod!==filters.paymentMethod)return false;
      if(filters.sellerId&&row.sellerId!==filters.sellerId)return false;
      if(filters.customerId&&row.customerId!==filters.customerId)return false;
      if(filters.saleId&&row.saleId!==filters.saleId)return false;
      return true;
    });
  }

  async function renderFinanceResults(card,filters){
    const serverFilters={};
    if(filters.status)serverFilters.status=filters.status;
    if(filters.from)serverFilters.from=toIsoStart(filters.from);
    if(filters.to)serverFilters.to=toIsoEnd(filters.to);
    const rows=filterClient(await api.financeEntries(serverFilters),filters);
    card.innerHTML=`<div class="ops-card-head"><div><h2>Lançamentos</h2><p class="ops-muted">${rows.length} resultado(s). Origem comercial e financeira permanecem rastreáveis separadamente.</p></div></div>
      <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vencimento</th><th>Origem</th><th>Descrição</th><th>Forma</th><th>Vendedor / Cliente</th><th>Valor</th><th>Em aberto</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(row=>`<tr>
        <td>${when(row.dueAt)}</td>
        <td><strong>${esc(rowOrigin(row))}</strong>${row.saleId?`<button class="ops-link" data-finance-view-sale="${esc(row.saleId)}">Ver venda</button>`:''}</td>
        <td><strong>${esc(row.description)}</strong><small>${esc(row.category||'')}</small></td>
        <td>${esc(row.paymentMethod||'—')}${row.installmentCount?` <small>${row.installmentNumber}/${row.installmentCount}</small>`:''}</td>
        <td>${esc(row.sellerName||'—')}<small>${esc(row.customerName||'')}</small></td>
        <td>${money(row.amountCents)}</td><td>${money(row.openCents)}</td><td>${esc(row.status)}</td>
        <td><div class="ops-row-actions">${row.openCents>0&&row.status!=='CANCELLED'?`<button class="ops-link" data-p5-finance-settle="${esc(row.id)}" data-open="${row.openCents}">Baixar</button>`:''}${row.status==='OPEN'?`<button class="ops-link danger" data-p5-finance-cancel="${esc(row.id)}">Cancelar</button>`:''}</div></td>
      </tr>`).join('')||'<tr><td colspan="9"><div class="ops-empty">Nenhum lançamento para os filtros selecionados.</div></td></tr>'}</tbody></table></div>`;

    card.querySelectorAll('[data-finance-view-sale]').forEach(button=>button.addEventListener('click',()=>navigateToSale(button.dataset.financeViewSale)));
    card.querySelectorAll('[data-p5-finance-settle]').forEach(button=>button.addEventListener('click',async()=>{
      const suggested=(Number(button.dataset.open||0)/100).toFixed(2).replace('.',',');
      const value=window.prompt('Valor da baixa (R$):',suggested);if(value===null)return;
      const amountCents=Math.round(Number(String(value).replace(',','.'))*100);
      try{await api.settleFinanceEntry(button.dataset.p5FinanceSettle,{amountCents,method:'MANUAL'});toast('Baixa registrada.');await renderFinanceResults(card,filters);}catch(error){toast(error.message,'error');}
    }));
    card.querySelectorAll('[data-p5-finance-cancel]').forEach(button=>button.addEventListener('click',async()=>{
      const reason=window.prompt('Motivo do cancelamento:');if(!reason)return;
      try{await api.cancelFinanceEntry(button.dataset.p5FinanceCancel,reason);toast('Lançamento cancelado.');await renderFinanceResults(card,filters);}catch(error){toast(error.message,'error');}
    }));
  }

  async function mountFinance(){
    if(title()!=='Financeiro'||document.getElementById('ops-finance-p5-filter')||financeMounting)return;
    const layout=document.querySelector('.finance-layout');
    const results=layout?.querySelector('.ops-card.grow');
    if(!layout||!results)return;
    financeMounting=true;
    try{
      const [sellers,customers]=await Promise.all([api.sellers().catch(()=>[]),api.customers().catch(()=>[])]);
      if(title()!=='Financeiro'||document.getElementById('ops-finance-p5-filter'))return;
      const pendingSale=sessionStorage.getItem('artisys.finance.saleId')||'';
      sessionStorage.removeItem('artisys.finance.saleId');
      const card=document.createElement('section');card.className='ops-card';card.id='ops-finance-p5-filter';
      card.innerHTML=`<div class="ops-card-head"><div><h2>Filtros do Financeiro</h2><p class="ops-muted">Rastreie cada lançamento até venda, devolução, vendedor e cliente.</p></div></div>
        <form class="ops-form" style="grid-template-columns:repeat(4,minmax(150px,1fr));align-items:end">
          <label>Origem<select name="sourceType" class="ops-input"><option value="">Todas</option><option value="SALE">Venda</option><option value="RETURN">Devolução</option><option value="MANUAL">Manual</option></select></label>
          <label>Forma<select name="paymentMethod" class="ops-input"><option value="">Todas</option>${['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT','OTHER'].map(v=>`<option value="${v}">${v}</option>`).join('')}</select></label>
          <label>Status<select name="status" class="ops-input"><option value="">Todos</option>${['OPEN','PARTIAL','SETTLED','CANCELLED'].map(v=>`<option value="${v}">${v}</option>`).join('')}</select></label>
          <label>Venda<input name="saleId" class="ops-input" value="${esc(pendingSale)}" placeholder="ID da venda"></label>
          <label>Vendedor<select name="sellerId" class="ops-input"><option value="">Todos</option>${sellers.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('')}</select></label>
          <label>Cliente<select name="customerId" class="ops-input"><option value="">Todos</option>${customers.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('')}</select></label>
          <label>Vencimento inicial<input name="from" type="date" class="ops-input"></label>
          <label>Vencimento final<input name="to" type="date" class="ops-input"></label>
          <div class="ops-actions"><button class="ops-primary" type="submit">Aplicar filtros</button><button class="ops-secondary" type="reset">Limpar</button></div>
        </form>`;
      layout.insertAdjacentElement('beforebegin',card);
      const values=()=>Object.fromEntries(new FormData(card.querySelector('form')).entries());
      card.querySelector('form').addEventListener('submit',event=>{event.preventDefault();void renderFinanceResults(results,values());});
      card.querySelector('form').addEventListener('reset',()=>setTimeout(()=>void renderFinanceResults(results,{}),0));
      await renderFinanceResults(results,values());
    }finally{financeMounting=false;}
  }

  function mountSaleBacklink(){
    if(title()!=='Últimas vendas'||!lastSaleDetailId)return;
    const detail=document.getElementById('ops-sale-detail');
    const head=detail?.querySelector('.ops-card-head');
    if(!head||head.querySelector('[data-sale-view-finance]'))return;
    const button=document.createElement('button');button.className='ops-secondary';button.dataset.saleViewFinance=lastSaleDetailId;button.textContent='Ver financeiro';
    button.addEventListener('click',()=>navigateToFinance(lastSaleDetailId));head.appendChild(button);
  }

  function openPendingSale(){
    if(title()!=='Últimas vendas')return;
    const saleId=sessionStorage.getItem('artisys.finance.openSale');if(!saleId)return;
    const button=[...document.querySelectorAll('[data-sale-details]')].find(node=>node.dataset.saleDetails===saleId);
    if(button){sessionStorage.removeItem('artisys.finance.openSale');lastSaleDetailId=saleId;button.click();}
  }

  async function mountReports(){
    if(title()!=='Relatórios'||document.getElementById('ops-p6-view')||reportsMounting)return;
    const form=document.getElementById('ops-report-filter');if(!form)return;
    reportsMounting=true;
    try{
      const data=new FormData(form);const from=String(data.get('fromDate')||'');const to=String(data.get('toDate')||'');const sellerId=String(data.get('sellerId')||'');
      const filters={from:toIsoStart(from),to:toIsoEnd(to)};
      const [sales,allFinance]=await Promise.all([api.reportSales({...filters,sellerId}),api.financeEntries(filters)]);
      let finance=allFinance;if(sellerId)finance=finance.filter(row=>row.sellerId===sellerId);
      const received=finance.filter(row=>row.kind==='RECEIVABLE'&&row.status!=='CANCELLED').reduce((sum,row)=>sum+Number(row.settledCents||0),0);
      const paid=finance.filter(row=>row.kind==='PAYABLE'&&row.status!=='CANCELLED').reduce((sum,row)=>sum+Number(row.settledCents||0),0);
      const open=finance.filter(row=>row.kind==='RECEIVABLE'&&row.status!=='CANCELLED').reduce((sum,row)=>sum+Number(row.openCents||0),0);
      if(title()!=='Relatórios'||document.getElementById('ops-p6-view'))return;
      const card=document.createElement('section');card.className='ops-card';card.id='ops-p6-view';
      card.innerHTML=`<div class="ops-card-head"><div><h2>Visões separadas</h2><p class="ops-muted">Vendas, Caixa e Financeiro representam perspectivas diferentes do mesmo negócio e não devem ser somadas como receitas independentes.</p></div></div>
        <div class="ops-metrics"><article class="ops-metric"><span>Comercial · vendas líquidas</span><strong>${money(sales.netSalesCents||0)}</strong><small>desempenho de vendas</small></article><article class="ops-metric"><span>Financeiro · fluxo liquidado</span><strong>${money(received-paid)}</strong><small>recebido menos reembolsos/pagamentos</small></article><article class="ops-metric"><span>Financeiro · a receber</span><strong>${money(open)}</strong><small>recebíveis ainda abertos</small></article></div>`;
      form.closest('.ops-card')?.insertAdjacentElement('afterend',card);
    }finally{reportsMounting=false;}
  }

  document.addEventListener('click',event=>{
    const saleButton=event.target.closest?.('[data-sale-details]');if(saleButton)lastSaleDetailId=saleButton.dataset.saleDetails||'';
  },true);

  const observer=new MutationObserver(()=>{
    void mountFinance();
    mountSaleBacklink();
    openPendingSale();
    void mountReports();
  });
  observer.observe(document.body,{subtree:true,childList:true});
  void mountFinance();mountSaleBacklink();openPendingSale();void mountReports();
})();
