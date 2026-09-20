'use strict';

(() => {
  const root=window;
  const {ApiClient}=root.PdvApiClient;
  const api=new ApiClient();
  const ui=root.PdvUiModel;
  const content=document.getElementById('route-content');
  const toastRoot=document.getElementById('toast-root');

  const PAYMENT_LABELS=Object.freeze({
    CASH:'Dinheiro',PIX:'PIX',CREDIT:'Crédito',CREDIT_CARD:'Crédito',DEBIT:'Débito',DEBIT_CARD:'Débito',CARD:'Cartão',VOUCHER:'Vale',STORE_CREDIT:'Crédito da loja',OTHER:'Outro'
  });

  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);}
  function money(value){return ui?.formatCents?ui.formatCents(value):(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function qty(value){return Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});}
  function when(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?escapeHtml(value):date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
  function labelPaymentMethod(method){return PAYMENT_LABELS[String(method||'').toUpperCase()]||String(method||'Outro').replaceAll('_',' ').toLowerCase().replace(/^./,char=>char.toUpperCase());}
  function empty(message){return `<div class="ops-empty">${escapeHtml(message)}</div>`;}
  function metric(label,value,hint=''){return `<article class="ops-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${hint?`<small>${escapeHtml(hint)}</small>`:''}</article>`;}
  function showToast(message,type=''){if(!toastRoot)return;const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;toastRoot.appendChild(node);setTimeout(()=>node.remove(),3500);}
  function page(title,subtitle,body,actions=''){return `<section class="ops-page reports-page"><header class="ops-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="ops-head-actions reports-no-print">${actions}</div></header>${body}</section>`;}
  function dateValue(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function table(headers,rows,emptyMessage){return `<div class="ops-table-wrap"><table class="ops-table"><thead><tr>${headers.map(h=>`<th>${escapeHtml(h)}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}">${empty(emptyMessage)}</td></tr>`}</tbody></table></div>`;}
  function paymentBadges(methods){return (methods||[]).map(method=>`<span class="reports-chip">${escapeHtml(labelPaymentMethod(method))}</span>`).join(' ')||'—';}

  async function renderReports(selected={}){
    const now=new Date();const firstDay=new Date(now.getFullYear(),now.getMonth(),1);
    const fromDate=selected.fromDate||dateValue(firstDay);const toDate=selected.toDate||dateValue(now);
    const sellerId=selected.sellerId||'';const paymentMethod=selected.paymentMethod||'';
    const filters={from:new Date(`${fromDate}T00:00:00`).toISOString(),to:new Date(`${toDate}T23:59:59.999`).toISOString(),sellerId};
    document.body.classList.remove('theme-home');
    document.querySelectorAll('[data-route]').forEach(node=>node.classList.toggle('active',node.dataset.route==='reports'));
    content.innerHTML=page('Relatórios','Carregando indicadores gerenciais…','<div class="ops-loader"></div>');

    try{
      const [sales,inventory,cash,finance,sellers,commissions,products,rules]=await Promise.all([
        api.reportSales(filters),api.reportInventory(),api.reportCash(filters),api.reportFinance(filters),api.sellers(),api.commissions(filters),api.products(),api.commissionRules({includeInactive:true})
      ]);
      const paymentMethods=Object.keys(sales.paymentsByMethod||{}).sort();
      const filteredTransactions=(sales.sales||[]).filter(row=>!paymentMethod||(row.paymentMethods||[]).includes(paymentMethod));
      const filteredTotal=filteredTransactions.reduce((sum,row)=>sum+Number(row.totalCents||0),0);
      const purchaseItems=(inventory.items||[]).filter(item=>Number(item.suggestedPurchaseQuantity||0)>0);

      const actions=`<button id="reports-print" class="ops-secondary" type="button">Imprimir / Salvar PDF</button><button id="reports-export" class="ops-secondary" type="button">Exportar vendas CSV</button>`;
      const filterForm=`<section class="ops-card reports-no-print"><form id="reports-filter" class="ops-form reports-filter"><label>Data inicial<input name="fromDate" type="date" class="ops-input" value="${escapeHtml(fromDate)}" required></label><label>Data final<input name="toDate" type="date" class="ops-input" value="${escapeHtml(toDate)}" required></label><label>Vendedor / Garçom<select name="sellerId" class="ops-input"><option value="">Todos</option>${sellers.map(seller=>`<option value="${escapeHtml(seller.id)}" ${seller.id===sellerId?'selected':''}>${escapeHtml(seller.name)}</option>`).join('')}</select></label><label>Meio de pagamento<select name="paymentMethod" class="ops-input"><option value="">Todos</option>${paymentMethods.map(method=>`<option value="${escapeHtml(method)}" ${method===paymentMethod?'selected':''}>${escapeHtml(labelPaymentMethod(method))}</option>`).join('')}</select></label><button class="ops-primary" type="submit">Aplicar filtros</button></form></section>`;

      const overview=`<section class="reports-section"><div class="reports-section-title"><h2>Visão geral gerencial</h2><p>Resultados do período selecionado.</p></div><div class="ops-metrics reports-metrics">${metric('Vendas brutas',money(sales.grossSalesCents||0))}${metric('Vendas líquidas',money(sales.netSalesCents||0),`${sales.salesCount||0} vendas`)}${metric('Ticket médio',money(sales.averageTicketCents||0))}${metric('Descontos',money(sales.discountCents||0))}${metric('Devoluções',money(sales.returnedCents||0))}${metric('Cancelamentos',money(sales.cancelledSalesCents||0),`${sales.cancelledSalesCount||0} vendas`)}${metric('Custo estimado',money(sales.estimatedCostCents||0))}${metric('Margem estimada',money(sales.estimatedMarginCents||0))}</div></section>`;

      const customers=table(['Cliente','Vendas','Total'],(sales.customers||[]).map(row=>`<tr><td>${escapeHtml(row.customerName)}</td><td>${row.salesCount||0}</td><td><strong>${money(row.salesCents||0)}</strong></td></tr>`).join(''),'Sem vendas por cliente no período.');
      const productRows=(sales.topProducts||[]).map(row=>`<tr><td>${escapeHtml(row.productName)}</td><td>${qty(row.quantity)}</td><td><strong>${money(row.grossCents)}</strong></td></tr>`).join('');
      const categoryRows=(sales.categories||[]).map(row=>`<tr><td>${escapeHtml(row.categoryName)}</td><td>${qty(row.quantity)}</td><td><strong>${money(row.grossCents)}</strong></td></tr>`).join('');
      const sellerRows=(sales.sellers||[]).map(row=>`<tr><td>${escapeHtml(row.sellerName||'—')}</td><td>${row.salesCount||0}</td><td>${money(row.returnedCents||0)}</td><td><strong>${money(row.salesCents||0)}</strong></td><td>${row.cancelledSalesCount||0}</td></tr>`).join('');
      const operatorRows=(sales.operators||[]).map(row=>`<tr><td>${escapeHtml(row.operatorName||'—')}</td><td>${row.salesCount||0}</td><td><strong>${money(row.salesCents||0)}</strong></td></tr>`).join('');
      const paymentRows=paymentMethods.map(method=>`<tr><td>${escapeHtml(labelPaymentMethod(method))}</td><td><strong>${money(sales.paymentsByMethod[method]||0)}</strong></td></tr>`).join('');
      const salesSection=`<section class="reports-section"><div class="reports-section-title"><h2>Vendas</h2><p>Cliente, produto, categoria, equipe e formas de pagamento.</p></div><div class="ops-grid two"><section class="ops-card"><h3>Vendas por cliente</h3>${customers}</section><section class="ops-card"><h3>Vendas por produto</h3>${table(['Produto','Quantidade','Faturamento'],productRows,'Sem produtos vendidos no período.')}</section><section class="ops-card"><h3>Vendas por categoria</h3>${table(['Categoria','Quantidade','Faturamento'],categoryRows,'Sem categorias vendidas no período.')}</section><section class="ops-card"><h3>Formas de pagamento</h3>${table(['Forma','Total'],paymentRows,'Sem pagamentos no período.')}</section><section class="ops-card"><h3>Vendas por vendedor / garçom</h3>${table(['Vendedor','Vendas','Devoluções','Líquido','Canceladas'],sellerRows,'Sem vendas por vendedor no período.')}</section><section class="ops-card"><h3>Vendas por operador</h3>${table(['Operador','Vendas','Total'],operatorRows,'Sem vendas por operador no período.')}</section></div></section>`;

      const detailRows=filteredTransactions.map(row=>`<tr><td><strong>${escapeHtml(row.saleNumber||row.saleId)}</strong></td><td>${when(row.completedAt)}</td><td>${escapeHtml(row.customerName)}</td><td>${escapeHtml(row.sellerName)}</td><td>${paymentBadges(row.paymentMethods)}</td><td>${money(row.discountCents||0)}</td><td><strong>${money(row.totalCents||0)}</strong></td></tr>`).join('');
      const paymentHint=paymentMethod?`Filtro: ${labelPaymentMethod(paymentMethod)} · ${filteredTransactions.length} vendas · ${money(filteredTotal)}`:`${filteredTransactions.length} vendas detalhadas`;
      const detailSection=`<section class="ops-card reports-section"><div class="ops-card-head"><div><h2>Vendas detalhadas</h2><p>${escapeHtml(paymentHint)}</p></div></div>${table(['Venda','Data','Cliente','Vendedor','Pagamento','Desconto','Total'],detailRows,'Nenhuma venda encontrada para o filtro.')}</section>`;

      const restockRows=purchaseItems.map(item=>`<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.sku||'—')}</td><td>${qty(item.quantity)}</td><td>${qty(item.minimumStock)}</td><td><strong>${qty(item.suggestedPurchaseQuantity)}</strong></td></tr>`).join('');
      const inventorySection=`<section class="reports-section"><div class="reports-section-title"><h2>Estoque e reposição</h2><p>Posição atual e itens abaixo do mínimo para compra.</p></div><div class="ops-metrics">${metric('SKUs controlados',String(inventory.skuCount||0))}${metric('Estoque baixo',String(inventory.lowStockCount||0))}${metric('Sugestões de compra',String(inventory.purchaseSuggestionCount||0))}${metric('Valor em custo',money(inventory.costValueCents||0))}</div><section class="ops-card"><h3>Lista de reposição</h3>${table(['Produto','SKU','Atual','Mínimo','Comprar'],restockRows,'Nenhum item precisa de reposição até o mínimo cadastrado.')}</section></section>`;

      const cashRows=(cash.sessions||[]).map(row=>`<tr><td>${escapeHtml(row.terminalId||'—')}</td><td>${when(row.closedAt)}</td><td>${money(row.expectedCashCents||0)}</td><td>${money(row.countedCashCents||0)}</td><td><strong>${money(row.divergenceCents||0)}</strong></td></tr>`).join('');
      const cashSection=`<section class="reports-section"><div class="reports-section-title"><h2>Caixa</h2><p>Fechamentos e divergências do período.</p></div><div class="ops-metrics">${metric('Sessões fechadas',String(cash.closedSessions||0))}${metric('Esperado',money(cash.expectedCashCents||0))}${metric('Contado',money(cash.countedCashCents||0))}${metric('Divergência',money(cash.divergenceCents||0),`${cash.divergentSessions||0} sessões divergentes`)}</div><section class="ops-card">${table(['Terminal','Fechamento','Esperado','Contado','Divergência'],cashRows,'Nenhum fechamento no período.')}</section></section>`;

      const financeSection=`<section class="reports-section"><div class="reports-section-title"><h2>Financeiro</h2><p>Contas a pagar e receber dentro do período.</p></div><div class="ops-metrics reports-metrics">${metric('A pagar',money(finance.payableTotalCents||0))}${metric('A pagar em aberto',money(finance.payableOpenCents||0))}${metric('A pagar vencido',money(finance.overduePayableCents||0))}${metric('A receber',money(finance.receivableTotalCents||0))}${metric('A receber em aberto',money(finance.receivableOpenCents||0))}${metric('A receber vencido',money(finance.overdueReceivableCents||0))}</div></section>`;

      const commissionRows=(commissions.sellers||[]).map(row=>`<tr><td>${escapeHtml(row.sellerName)}</td><td>${money(row.earnedCents)}</td><td>${money(row.reversedCents)}</td><td>${money(row.paidCents)}</td><td><strong>${money(row.outstandingCents)}</strong></td><td class="reports-no-print"><button class="ops-link" data-pay-commission="${escapeHtml(row.sellerId)}" data-outstanding="${Number(row.outstandingCents||0)}" ${Number(row.outstandingCents||0)<=0?'disabled':''}>Registrar pagamento</button></td></tr>`).join('');
      const ruleRows=rules.map(rule=>`<tr><td>${escapeHtml(rule.sellerName)}</td><td>${escapeHtml(rule.productName||'Todos os produtos')}</td><td>${(Number(rule.commissionBps||0)/100).toLocaleString('pt-BR')}%</td><td>${rule.active?'Ativa':'Inativa'}</td></tr>`).join('');
      const commissionSection=`<section class="reports-section"><div class="reports-section-title"><h2>Comissões</h2><p>Valores gerados, pagos e em aberto por vendedor ou garçom.</p></div><div class="ops-grid two"><section class="ops-card"><h3>Comissões por vendedor / garçom</h3>${table(['Vendedor','Gerada','Estornada','Paga','Em aberto',''],commissionRows,'Sem comissões no período.')}</section><section class="ops-card"><h3>Regras de comissão</h3><form id="reports-commission-rule" class="ops-form reports-no-print"><label>Vendedor / Garçom<select name="sellerId" class="ops-input" required>${sellers.map(seller=>`<option value="${escapeHtml(seller.id)}">${escapeHtml(seller.name)}</option>`).join('')}</select></label><label>Produto específico<select name="productId" class="ops-input"><option value="">Todos os produtos</option>${products.map(product=>`<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join('')}</select></label><label>Comissão (%)<input name="percent" class="ops-input" type="number" min="0" max="100" step="0.01" required></label><button class="ops-primary" type="submit">Salvar regra</button></form>${table(['Vendedor','Aplicação','%','Status'],ruleRows,'Nenhuma regra cadastrada.')}</section></div></section>`;

      content.innerHTML=page('Relatórios','Indicadores gerenciais do período, com dados de vendas, clientes, estoque, caixa e financeiro.',`${filterForm}${overview}${salesSection}${detailSection}${inventorySection}${cashSection}${financeSection}${commissionSection}`,actions);

      document.getElementById('reports-filter')?.addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);void renderReports({fromDate:String(form.get('fromDate')),toDate:String(form.get('toDate')),sellerId:String(form.get('sellerId')||''),paymentMethod:String(form.get('paymentMethod')||'')});});
      document.getElementById('reports-export')?.addEventListener('click',async()=>{try{const result=await api.exportSalesCsv(filters);const blob=new Blob([result.csv||''],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=`vendas-${fromDate}-a-${toDate}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){showToast(error.message,'error');}});
      document.getElementById('reports-print')?.addEventListener('click',()=>root.print());
      document.getElementById('reports-commission-rule')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await api.saveCommissionRule({sellerId:String(form.get('sellerId')),productId:String(form.get('productId')||'')||null,commissionBps:Math.round(Number(form.get('percent'))*100)});showToast('Regra de comissão salva. Vendas anteriores permanecem inalteradas.','success');await renderReports({fromDate,toDate,sellerId,paymentMethod});}catch(error){showToast(error.message,'error');}});
      content.querySelectorAll('[data-pay-commission]').forEach(button=>button.addEventListener('click',async()=>{const suggested=(Number(button.dataset.outstanding||0)/100).toFixed(2).replace('.',',');const value=root.prompt('Valor da comissão paga (R$):',suggested);if(value===null)return;const normalized=String(value).trim().replace(/\./g,'').replace(',','.');const amountCents=Math.round(Number(normalized)*100);if(!Number.isFinite(amountCents)||amountCents<=0){showToast('Informe um valor válido.','error');return;}const note=root.prompt('Observação do pagamento:','')||'';try{await api.payCommission({sellerId:button.dataset.payCommission,amountCents,periodFrom:filters.from,periodTo:filters.to,note});showToast('Pagamento de comissão registrado.','success');await renderReports({fromDate,toDate,sellerId,paymentMethod});}catch(error){showToast(error.message,'error');}}));
      content.focus({preventScroll:true});
    }catch(error){
      content.innerHTML=page('Não foi possível carregar os relatórios','O servidor local recusou ou não concluiu a operação.',`<div class="ops-error">${escapeHtml(error.message)}</div>`);
      showToast(error.message,'error');
    }
  }

  root.addEventListener('click',event=>{const target=event.target.closest?.('[data-route],[data-home-route]');if(!target)return;const route=target.dataset.route||target.dataset.homeRoute;if(route!=='reports')return;event.preventDefault();event.stopImmediatePropagation();void renderReports();},true);
  root.addEventListener('keydown',event=>{if(event.key!=='F9'||document.querySelector('.checkout-layout'))return;event.preventDefault();event.stopImmediatePropagation();void renderReports();},true);

  root.PdvReportsUi=Object.freeze({renderReports,labelPaymentMethod});
})();
