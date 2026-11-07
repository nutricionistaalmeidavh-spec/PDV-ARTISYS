'use strict';
(() => {
  const root=window;
  const api=new root.PdvApiClient.ApiClient();
  const registry=root.PdvRouteRegistry;
  const content=document.getElementById('route-content');
  const ux=root.ArtisysUxComponents;
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const money=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const businessDate=()=>root.PdvBusinessDate.localBusinessDate(new Date());
  const can=permission=>Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,permission));
  const toast=(message,type='')=>root.PdvToast?.show?.(message,type)||console[type==='error'?'error':'log'](message);
  const stageLabels={PENDING:'Pendente',IN_PROGRESS:'Em andamento',DONE:'Concluído'};
  const priorityLabels={LOW:'Baixa',NORMAL:'Normal',HIGH:'Alta'};
  const kindLabels={PAYABLE:'A pagar',RECEIVABLE:'A receber',TASK:'Tarefa'};
  const statusLabels={OPEN:'Aberto',PARTIAL:'Parcial',SETTLED:'Liquidado',CANCELLED:'Cancelado'};
  const csvColumnKeys=['tipo','descricao','valor_centavos','vencimento','categoria','conta_id','observacoes'];
  let sheetFilter={from:businessDate().slice(0,7)+'-01',to:businessDate(),kind:'',query:''};
  let biFilter={from:businessDate().slice(0,7)+'-01',to:businessDate(),basis:'cash'};
  let boardFilter={stage:''};
  async function authorized(route){
    await api.initialize();
    if(can('finance.view'))return true;
    if(document.body.dataset.activeRoute===route)void root.PdvAppNavigation?.navigate?.('home');
    return false;
  }
  function frame(route,subtitle,body,actions=''){
    return "<section class='ops-page finance-workspace-page' data-finance-surface='"+esc(route)+"'>"+
      "<header class='ops-head'><div><h1>Financeiro</h1><p>"+esc(subtitle)+"</p></div><div class='ops-head-actions'>"+actions+"</div></header>"+
      (root.PdvFinanceOperationsUi?.navigation(route)||'')+body+"</section>";
  }
  function complete(route){
    root.PdvFinanceOperationsUi?.bindNavigation(content);
    registry.updated(route,{surface:route});
  }
  async function dialog(options){
    if(!ux?.openFormDialog)throw new Error('Diálogo de confirmação indisponível.');
    return ux.openFormDialog(options);
  }
  function centsInput(value){
    const text=String(value||'').trim().replace(/\./g,'').replace(',','.');
    const number=Number(text);
    return Number.isFinite(number)?Math.round(number*100):NaN;
  }
  function amountInput(cents){return (Number(cents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function localDate(value){
    const date=String(value||'').trim();
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(date))return date.slice(6)+'-'+date.slice(3,5)+'-'+date.slice(0,2);
    return date.slice(0,10);
  }
  function downloadCsv(rows,name){
    const safeCell=value=>{
      let s=String(value??'');
      if(/^[\s]*[=+@-]/.test(s)&&!(/^-?\d+([,.]\d+)?$/.test(s)))s="'"+s;
      return '"'+s.replace(/"/g,'""')+'"';
    };
    const csv='\uFEFF'+rows.map(row=>row.map(safeCell).join(';')).join('\r\n')+'\r\n';
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function downloadXlsx(base64,name){
    const decoded=atob(base64);
    const bytes=new Uint8Array(decoded.length);
    for(let i=0;i<decoded.length;i++)bytes[i]=decoded.charCodeAt(i);
    const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);
  }
  function readAsBase64(file){
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('Não foi possível ler o arquivo Excel.'));
      reader.onload=()=>{
        const result=String(reader.result||'');
        const comma=result.indexOf(',');
        if(comma<0)return reject(new Error('Arquivo Excel inválido.'));
        resolve(result.slice(comma+1));
      };
      reader.readAsDataURL(file);
    });
  }
  function parseCsv(text){
    const input=String(text||'').replace(/^\uFEFF/,'');
    const delimiter=(input.split(/\r?\n/,1)[0]||'').includes(';')?';':',';
    const rows=[];let row=[],field='',quoted=false;
    for(let i=0;i<input.length;i++){
      const char=input[i];
      if(char==='"'){if(quoted&&input[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
      else if(!quoted&&char===delimiter){row.push(field);field='';}
      else if(!quoted&&(char==='\n'||char==='\r')){
        if(char==='\r'&&input[i+1]==='\n')i++;
        row.push(field);if(row.some(cell=>String(cell).trim()))rows.push(row);
        row=[];field='';
      }else field+=char;
    }
    if(quoted)throw new Error('CSV com aspas não fechadas.');
    row.push(field);if(row.some(cell=>String(cell).trim()))rows.push(row);
    return rows;
  }
  function csvEntries(text){
    const rows=parseCsv(text);if(rows.length<2)throw new Error('CSV sem linhas de lançamentos.');
    const normalized=value=>String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
    const headers=rows.shift().map(normalized);
    const col=(row,...names)=>{const index=headers.findIndex(h=>names.includes(h));return index<0?'':String(row[index]||'').trim();};
    if(!headers.includes('descricao')||!headers.some(h=>['tipo','kind'].includes(h))||!headers.some(h=>['valor_centavos','valor'].includes(h)))
      throw new Error('Cabeçalho CSV deve conter tipo, descricao e valor_centavos ou valor.');
    if(rows.length>500)throw new Error('Importe no máximo 500 lançamentos por arquivo.');
    return rows.map((row,index)=>{
      const type=normalized(col(row,'tipo','kind'));
      const kind=['payable','pagar','despesa','saida'].includes(type)?'PAYABLE':['receivable','receber','receita','entrada'].includes(type)?'RECEIVABLE':null;
      const centsRaw=col(row,'valor_centavos');
      const amountCents=centsRaw?Number(centsRaw):centsInput(col(row,'valor'));
      const dueAt=localDate(col(row,'vencimento','due_at','dueat'));
      if(!kind||!Number.isSafeInteger(amountCents)||amountCents<=0||!dueAt)
        throw new Error('Linha '+(index+2)+': tipo, valor ou vencimento inválido.');
      return{kind,description:col(row,'descricao','description'),amountCents,dueAt,
        category:col(row,'categoria','category')||null,accountId:col(row,'conta_id','account_id')||null,
        notes:col(row,'observacoes','notes')||null};
    });
  }
  async function createEntry(accounts){
    const options="<option value=''>Sem conta</option>"+accounts.map(a=>"<option value='"+esc(a.id)+"'>"+esc(a.name)+"</option>").join('');
    const result=await dialog({title:'Novo lançamento financeiro',description:'Registre uma conta a pagar ou receber no livro-caixa.',confirmLabel:'Criar lançamento',
      body:"<label>Tipo<select name='kind' class='ops-input'><option value='PAYABLE'>A pagar</option><option value='RECEIVABLE'>A receber</option></select></label>"+
        "<label>Descrição<input name='description' class='ops-input' maxlength='240' required></label>"+
        "<label>Valor (R$)<input name='amount' class='ops-input' inputmode='decimal' required></label>"+
        "<label>Vencimento<input name='dueAt' type='date' class='ops-input' value='"+esc(businessDate())+"' required></label>"+
        "<label>Conta<select name='accountId' class='ops-input'>"+options+"</select></label>",
      validate:data=>!String(data.description||'').trim()?{message:'Informe a descrição.',field:'description'}:
        centsInput(data.amount)<=0?{message:'Informe um valor maior que zero.',field:'amount'}:
        !data.dueAt?{message:'Informe o vencimento.',field:'dueAt'}:null,
      onConfirm:data=>api.createFinanceEntry({kind:data.kind,description:String(data.description).trim(),amountCents:centsInput(data.amount),dueAt:data.dueAt,accountId:data.accountId||null})
    });
    if(result.confirmed){toast('Lançamento criado.','success');await renderSheets();}
  }
  async function editEntry(entry,accounts){
    const options="<option value=''>Sem conta</option>"+accounts.map(a=>"<option value='"+esc(a.id)+"' "+(a.id===entry.accountId?'selected':'')+">"+esc(a.name)+"</option>").join('');
    const result=await dialog({title:'Editar linha da planilha',description:'Somente lançamentos manuais podem ser alterados. Valores já liquidados são preservados.',confirmLabel:'Salvar alterações',
      body:"<label>Descrição<input name='description' class='ops-input' value='"+esc(entry.description)+"' maxlength='240'></label>"+
        "<label>Valor (R$)<input name='amount' class='ops-input' inputmode='decimal' value='"+esc(amountInput(entry.amountCents))+"'></label>"+
        "<label>Vencimento<input name='dueAt' class='ops-input' type='date' value='"+esc(localDate(entry.dueAt))+"'></label>"+
        "<label>Categoria<input name='category' class='ops-input' value='"+esc(entry.category||'')+"'></label>"+
        "<label>Conta<select name='accountId' class='ops-input'>"+options+"</select></label>"+
        "<label>Observações<textarea name='notes' class='ops-input' rows='2'>"+esc(entry.notes||'')+"</textarea></label>",
      validate:data=>!String(data.description||'').trim()?{message:'Informe a descrição.',field:'description'}:
        !Number.isInteger(centsInput(data.amount))||centsInput(data.amount)<Number(entry.settledCents||0)||centsInput(data.amount)<=0?
          {message:'O valor não pode ser zero nem menor que o total já liquidado.',field:'amount'}:null,
      onConfirm:data=>api.financeSheetUpdateEntry(entry.id,{description:String(data.description).trim(),amountCents:centsInput(data.amount),
        dueAt:data.dueAt,category:data.category,accountId:data.accountId||null,notes:data.notes})
    });
    if(result.confirmed){toast('Planilha atualizada.','success');await renderSheets();}
  }
  async function renderSheets(){
    const route='finance-sheets';if(!await authorized(route))return;
    const [entries,accounts]=await Promise.all([api.financeEntries(sheetFilter),api.financeAccounts()]);
    if(document.body.dataset.activeRoute!==route)return;
    const filtered=entries.filter(e=>!sheetFilter.query||String(e.description||'').toLowerCase().includes(sheetFilter.query.toLowerCase()));
    const accountMap=new Map(accounts.map(a=>[a.id,a.name]));
    const tableRows=filtered.slice(0,700).map(e=>"<tr><td>"+esc(kindLabels[e.kind]||e.kind)+"</td><td>"+esc(e.description)+"</td><td>"+esc(localDate(e.dueAt))+"</td>"+
      "<td class='money-cell'>"+money(e.amountCents)+"</td><td class='money-cell'>"+money(e.openCents)+"</td>"+
      "<td>"+esc(accountMap.get(e.accountId)||'—')+"</td><td>"+esc(statusLabels[e.status]||e.status)+"</td><td>"+
      ((!e.sourceType&&e.status!=='CANCELLED'&&can('finance.manage'))?"<button type='button' class='ops-secondary' data-sheet-edit='"+esc(e.id)+"'>Editar</button>":'Automático / somente leitura')+"</td></tr>").join('');
    const actions=can('finance.manage')?"<button type='button' id='finance-sheet-new' class='ops-primary'>Novo lançamento</button>":'';
    content.innerHTML=frame(route,'Planilha integrada aos lançamentos do PDV, editável conforme o perfil do usuário.',
      "<section class='ops-card'><form id='finance-sheet-filter' class='finance-inline-filter'>"+
      "<label>De<input name='from' type='date' class='ops-input' value='"+esc(sheetFilter.from)+"'></label>"+
      "<label>Até<input name='to' type='date' class='ops-input' value='"+esc(sheetFilter.to)+"'></label>"+
      "<label>Tipo<select name='kind' class='ops-input'><option value=''>Todos</option><option value='PAYABLE' "+(sheetFilter.kind==='PAYABLE'?'selected':'')+">A pagar</option><option value='RECEIVABLE' "+(sheetFilter.kind==='RECEIVABLE'?'selected':'')+">A receber</option></select></label>"+
      "<label>Buscar<input name='query' class='ops-input' value='"+esc(sheetFilter.query||'')+"' placeholder='Descrição'></label>"+
      "<button type='submit' class='ops-primary'>Filtrar</button></form>"+
      "<div class='ops-head-actions finance-sheet-actions'><button type='button' id='finance-sheet-export' class='ops-secondary'>Exportar CSV</button>"+
      "<button type='button' id='finance-sheet-export-xlsx' class='ops-secondary'>Exportar Excel (.xlsx)</button>"+
      (can('finance.manage')?"<label class='ops-secondary finance-file-button'>Importar CSV<input id='finance-sheet-import' type='file' accept='.csv,text/csv' hidden></label>"+
      "<label class='ops-secondary finance-file-button'>Importar Excel<input id='finance-sheet-import-xlsx' type='file' accept='.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' hidden></label>":'')+"</div>"+
      "<div class='ops-table-wrap finance-sheet-scroll'><table class='ops-table'><thead><tr><th>Tipo</th><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Aberto</th><th>Conta</th><th>Situação</th><th>Ação</th></tr></thead><tbody>"+
      (tableRows||"<tr><td colspan='8'>Nenhum lançamento para o filtro.</td></tr>")+"</tbody></table></div>"+
      "<p class='ops-muted'>"+filtered.length+" lançamento(s). "+(filtered.length>700?'Exibidos os primeiros 700; refine os filtros.':'')+
      " Lançamentos originados nas vendas são protegidos contra edição manual.</p></section>",actions);
    complete(route);
    document.getElementById('finance-sheet-new')?.addEventListener('click',()=>void createEntry(accounts).catch(e=>toast(e.message,'error')));
    document.getElementById('finance-sheet-filter')?.addEventListener('submit',event=>{
      event.preventDefault();const f=new FormData(event.currentTarget);
      const from=String(f.get('from')||''),to=String(f.get('to')||'');
      if(!from||!to||from>to){toast('Informe um intervalo de datas válido.','error');return;}
      sheetFilter={from,to,kind:String(f.get('kind')||''),query:String(f.get('query')||'')};
      void renderSheets().catch(e=>toast(e.message,'error'));
    });
    content.querySelectorAll('[data-sheet-edit]').forEach(button=>button.addEventListener('click',()=>{
      const entry=filtered.find(e=>String(e.id)===button.dataset.sheetEdit);
      if(entry)void editEntry(entry,accounts).catch(e=>toast(e.message,'error'));
    }));
    document.getElementById('finance-sheet-export')?.addEventListener('click',()=>{
      const rows=filtered.map(e=>[e.kind,e.description,e.amountCents,localDate(e.dueAt),e.category||'',e.accountId||'',e.notes||'']);
      downloadCsv([csvColumnKeys,...rows],'artisys-financeiro-'+businessDate()+'.csv');
    });
    document.getElementById('finance-sheet-export-xlsx')?.addEventListener('click',async()=>{
      try{
        const workbook=await api.financeXlsxExport(sheetFilter);
        downloadXlsx(workbook.base64,'artisys-financeiro-'+businessDate()+'.xlsx');
      }catch(error){toast(error.message||String(error),'error');}
    });
    document.getElementById('finance-sheet-import-xlsx')?.addEventListener('change',async event=>{
      const file=event.target.files?.[0];if(!file)return;
      try{
        if(file.size>700*1024)throw new Error('Arquivo Excel excede 700 KB. Divida-o em lotes menores.');
        const preview=await api.financeXlsxPreview({base64:await readAsBase64(file)});
        const rows=preview.rows;
        const total=rows.reduce((sum,row)=>sum+row.amountCents,0);
        const result=await dialog({
          title:'Confirmar importação Excel',
          description:'Os dados foram verificados localmente pelo servidor. Nenhum lançamento foi gravado ainda.',
          confirmLabel:'Importar '+rows.length+' lançamentos',
          body:"<div class='ux-dialog__summary'><strong>"+rows.length+" lançamentos novos</strong><span>Total: "+money(total)+"</span></div>"+
            "<p>Confira os valores e a conta vinculada antes de confirmar.</p>",
          onConfirm:()=>api.financeSheetImport({rows,idempotencyKey:api.mutationId()})
        });
        if(result.confirmed){toast('Planilha Excel importada.','success');await renderSheets();}
      }catch(error){toast(error.message||String(error),'error');}
      event.target.value='';
    });
    document.getElementById('finance-sheet-import')?.addEventListener('change',async event=>{
      const file=event.target.files?.[0];if(!file)return;
      try{
        if(file.size>1024*1024)throw new Error('Arquivo CSV maior que 1 MB.');
        const rows=csvEntries(await file.text());
        const total=rows.reduce((sum,row)=>sum+row.amountCents,0);
        const result=await dialog({title:'Confirmar importação financeira',
          description:'Verifique os dados antes de inserir novos lançamentos. A operação é atômica.',
          confirmLabel:'Importar '+rows.length+' linhas',
          body:"<div class='ux-dialog__summary'><strong>"+rows.length+" novos lançamentos</strong><span>Total de valores: "+money(total)+"</span></div>"+
            "<p>Uma nova importação com os mesmos dados poderá criar duplicações. Confira o arquivo antes de confirmar.</p>",
          onConfirm:()=>api.financeSheetImport({rows,idempotencyKey:api.mutationId()})});
        if(result.confirmed){toast('Arquivo importado com sucesso.','success');await renderSheets();}
      }catch(error){toast(error.message||String(error),'error');}
      event.target.value='';
    });
  }
  function biColumn(item,max){
    const revenue=Math.max(0,Number(item.revenueCents||0));
    const costs=Math.max(0,Number(item.costCents||0)+Number(item.expenseCents||0));
    const h1=Math.max(2,Math.round(revenue/max*160)),h2=Math.max(2,Math.round(costs/max*160));
    const label=String(item.month||'');
    return "<div class='finance-bi-month'><div class='finance-bi-pair'>"+
      "<div class='finance-bi-bar income' style='height:"+h1+"px' title='Receita "+esc(money(revenue))+"'></div>"+
      "<div class='finance-bi-bar outflow' style='height:"+h2+"px' title='Custos + despesas "+esc(money(costs))+"'></div></div>"+
      "<small>"+esc(label.slice(5,7)+'/'+label.slice(2,4))+"</small></div>";
  }
  async function renderBi(){
    const route='finance-bi';if(!await authorized(route))return;
    const bi=await api.financeWorkspaceBi(biFilter);if(document.body.dataset.activeRoute!==route)return;
    const max=Math.max(1,...(bi.series||[]).flatMap(row=>[Number(row.revenueCents||0),Number(row.costCents||0)+Number(row.expenseCents||0)]));
    const metric=(name,value)=>"<article class='finance-bi-metric'><small>"+esc(name)+"</small><strong>"+money(value)+"</strong></article>";
    content.innerHTML=frame(route,'Indicadores de gestão gerados a partir dos dados reais, sem serviço externo.',
      "<section class='ops-card'><form id='finance-bi-filter' class='finance-inline-filter'>"+
      "<label>De<input name='from' class='ops-input' type='date' value='"+esc(bi.from)+"'></label>"+
      "<label>Até<input name='to' class='ops-input' type='date' value='"+esc(bi.to)+"'></label>"+
      "<label>Critério<select name='basis' class='ops-input'><option value='cash' "+(bi.basis==='cash'?'selected':'')+">Caixa</option><option value='accrual' "+(bi.basis==='accrual'?'selected':'')+">Competência</option></select></label>"+
      "<button type='submit' class='ops-primary'>Atualizar BI</button></form></section>"+
      "<div class='finance-bi-metrics'>"+metric('Receitas',bi.dre.revenueCents)+metric('Custos',bi.dre.costCents)+metric('Despesas',bi.dre.expenseCents)+metric('Resultado',bi.dre.resultCents)+"</div>"+
      "<div class='finance-bi-metrics'>"+metric('Ticket médio PDV',bi.sales?.averageTicketCents)+metric('Vendas PDV',bi.sales?.netSalesCents)+metric('Recebíveis vencidos',bi.dashboard.overdueReceivableCents)+metric('Pagáveis vencidos',bi.dashboard.overduePayableCents)+"</div>"+
      "<div class='ops-grid two'><section class='ops-card'><h2>Evolução financeira</h2>"+
      "<div class='finance-bi-legend'><span>Receitas</span><span>Custos e despesas</span></div>"+
      "<div class='finance-bi-chart' role='img' aria-label='Gráfico de evolução mensal de receitas, custos e despesas'>"+
      (bi.series||[]).map(item=>biColumn(item,max)).join('')+"</div>"+
      "<p class='ops-muted'>"+(bi.truncated?'Exibidos até 24 meses de dados.':'Base: '+(bi.basis==='cash'?'caixa':'competência')+'.')+"</p></section>"+
      "<section class='ops-card'><h2>Fluxo e compromissos</h2><dl class='ops-details'>"+
      "<div><dt>A receber</dt><dd>"+money(bi.dashboard.receivableOpenCents)+"</dd></div>"+
      "<div><dt>A pagar</dt><dd>"+money(bi.dashboard.payableOpenCents)+"</dd></div>"+
      "<div><dt>Entradas realizadas</dt><dd>"+money(bi.cashflow.realizedInflowCents)+"</dd></div>"+
      "<div><dt>Saídas realizadas</dt><dd>"+money(bi.cashflow.realizedOutflowCents)+"</dd></div>"+
      "<div><dt>Saldo projetado (variação)</dt><dd>"+money(bi.cashflow.projectedClosingDeltaCents)+"</dd></div></dl></section></div>"+
      "<section class='ops-card'><h2>Composição do resultado</h2><div class='finance-bi-groups'>"+
      (bi.dre.groups||[]).map(g=>"<div><span>"+esc(g.name)+"</span><strong>"+money(g.amountCents)+"</strong></div>").join('')+"</div>"+
      (!(bi.dre.groups||[]).length?"<p class='ops-muted'>Sem movimentações no período.</p>":'')+"</section>"+
      "<div class='ops-grid two'><section class='ops-card'><h2>Formas de pagamento nas vendas PDV</h2>"+
      "<p class='ops-muted'>"+Number(bi.sales?.salesCount||0)+" venda(s) concluída(s) · margem estimada "+money(bi.sales?.estimatedMarginCents)+"</p>"+
      "<div class='finance-bi-groups'>"+(bi.sales?.paymentMethods||[]).map(row=>
        "<div><span>"+esc(row.method)+" ("+Number(row.salesCount||0)+" vendas)</span><strong>"+money(row.netCents)+"</strong></div>").join('')+"</div>"+
      (!(bi.sales?.paymentMethods||[]).length?"<p class='ops-muted'>Nenhum pagamento no período.</p>":'')+"</section>"+
      "<section class='ops-card'><h2>Comparação com período anterior</h2><p class='ops-muted'>"+
      esc(bi.comparison?.previous?.from||'')+" a "+esc(bi.comparison?.previous?.to||'')+"</p>"+
      "<div class='finance-bi-groups'><div><span>Diferença receitas</span><strong>"+money(bi.comparison?.delta?.revenueCents)+"</strong></div>"+
      "<div><span>Diferença despesas</span><strong>"+money(bi.comparison?.delta?.expenseCents)+"</strong></div>"+
      "<div><span>Diferença resultado</span><strong>"+money(bi.comparison?.delta?.resultCents)+"</strong></div>"+
      "<div><span>Margem bruta estimada</span><strong>"+Number(bi.dashboard.marginPercent||0).toLocaleString('pt-BR')+"%</strong></div></div></section></div>");
    complete(route);
    document.getElementById('finance-bi-filter')?.addEventListener('submit',event=>{
      event.preventDefault();const f=new FormData(event.currentTarget);
      const from=String(f.get('from')||''),to=String(f.get('to')||'');
      if(!from||!to||from>to){toast('Período inválido.','error');return;}
      biFilter={from,to,basis:String(f.get('basis')||'cash')};void renderBi().catch(e=>toast(e.message,'error'));
    });
  }
  function kanbanCard(card){
    const locked=card.status==='SETTLED'||(card.status==='PARTIAL'&&card.stage==='IN_PROGRESS');
    const moveButton=(stage,label)=>"<button type='button' class='ops-secondary' data-move-id='"+esc(card.id)+"' data-move-stage='"+stage+"' "+
      (!can('finance.manage')||(locked&&stage!=='DONE')?'disabled':'')+">"+label+"</button>";
    return "<article class='finance-kanban-card' tabindex='0' draggable='"+(can('finance.manage')?'true':'false')+"' data-card-id='"+esc(card.id)+"'>"+
      "<div class='finance-kanban-card-top'><span>"+esc(kindLabels[card.kind]||card.kind)+"</span><span>"+esc(priorityLabels[card.priority]||'Normal')+"</span></div>"+
      "<strong>"+esc(card.title)+"</strong>"+
      (card.details?"<p>"+esc(card.details)+"</p>":'')+
      (card.kind!=='TASK'?"<div class='finance-kanban-amount'>"+money(card.openCents)+" em aberto</div>":'')+
      "<small>Vencimento: "+esc(card.dueAt||'Não definido')+"</small>"+
      "<div class='finance-kanban-buttons'>"+
      (card.stage!=='PENDING'?moveButton(card.stage==='DONE'?'IN_PROGRESS':'PENDING','Voltar'):'')+
      (card.stage!=='DONE'?moveButton(card.stage==='PENDING'?'IN_PROGRESS':'DONE',card.stage==='IN_PROGRESS'?'Concluir':'Avançar'):'')+
      (card.kind==='TASK'&&can('finance.manage')?"<button type='button' class='ops-link' data-task-edit='"+esc(card.id)+"'>Editar</button>":'')+
      "</div></article>";
  }
  async function createTask(){
    const result=await dialog({title:'Nova tarefa financeira',description:'Tarefas não geram baixa, receita nem despesa.',
      confirmLabel:'Criar tarefa',
      body:"<label>Título<input name='title' class='ops-input' maxlength='240' required></label>"+
        "<label>Detalhes<textarea name='details' class='ops-input' rows='3'></textarea></label>"+
        "<label>Vencimento<input name='dueAt' class='ops-input' type='date'></label>"+
        "<label>Prioridade<select name='priority' class='ops-input'><option value='LOW'>Baixa</option><option value='NORMAL' selected>Normal</option><option value='HIGH'>Alta</option></select></label>"+
        "<label>ID do responsável (opcional)<input name='assigneeId' class='ops-input'></label>",
      validate:data=>!String(data.title||'').trim()?{message:'Informe o título.',field:'title'}:null,
      onConfirm:data=>api.financeKanbanCreateTask({title:data.title,details:data.details,dueAt:data.dueAt||null,priority:data.priority,assigneeId:data.assigneeId||null})
    });
    if(result.confirmed){toast('Tarefa criada.','success');await renderKanban();}
  }
  async function editTask(card){
    const result=await dialog({title:'Editar tarefa financeira',confirmLabel:'Salvar tarefa',
      body:"<label>Título<input name='title' class='ops-input' maxlength='240' value='"+esc(card.title)+"' required></label>"+
        "<label>Detalhes<textarea name='details' class='ops-input' rows='3'>"+esc(card.details||'')+"</textarea></label>"+
        "<label>Vencimento<input name='dueAt' class='ops-input' type='date' value='"+esc(card.dueAt||'')+"'></label>"+
        "<label>Prioridade<select name='priority' class='ops-input'>"+['LOW','NORMAL','HIGH'].map(p=>"<option value='"+p+"' "+(p===card.priority?'selected':'')+">"+priorityLabels[p]+"</option>").join('')+"</select></label>"+
        "<label>ID do responsável<input name='assigneeId' class='ops-input' value='"+esc(card.assigneeId||'')+"'></label>",
      validate:data=>!String(data.title||'').trim()?{message:'Informe o título.',field:'title'}:null,
      onConfirm:data=>api.financeKanbanUpdateTask(card.id,{title:data.title,details:data.details,dueAt:data.dueAt||null,priority:data.priority,assigneeId:data.assigneeId||null})
    });
    if(result.confirmed){toast('Tarefa atualizada.','success');await renderKanban();}
  }
  async function moveCard(card,stage,accounts){
    if(!can('finance.manage')){toast('Seu perfil não permite movimentar cards.','error');return;}
    if(card.status==='SETTLED'&&stage!=='DONE'){toast('Estorne a baixa antes de reabrir o lançamento.','error');return;}
    if(card.status==='PARTIAL'&&stage==='PENDING'){toast('Estorne a baixa parcial antes de voltar a Pendente.','error');return;}
    if(card.entryId&&stage==='DONE'&&Number(card.openCents)>0){
      if(!can('finance.settle')){toast('Seu perfil não possui a permissão "Confirmar baixas financeiras".','error');return;}
      const available=accounts.filter(a=>a.active);
      if(!available.length){toast('Cadastre uma conta financeira antes de confirmar uma baixa.','error');return;}
      const options=available.filter(a=>!card.accountId||a.id===card.accountId)
        .map(a=>"<option value='"+esc(a.id)+"'>"+esc(a.name)+"</option>").join('');
      const result=await dialog({
        title:card.kind==='PAYABLE'?'Confirmar pagamento e concluir':'Confirmar recebimento e concluir',
        description:'Ao confirmar, a baixa será contabilizada imediatamente no Financeiro e no BI.',
        confirmLabel:'Confirmar baixa de '+money(card.openCents),
        initialFocus:'cancel',
        body:"<div class='ux-dialog__summary'><strong>"+esc(card.title)+"</strong><span>"+money(card.openCents)+" · "+esc(kindLabels[card.kind])+"</span></div>"+
          "<label>Conta financeira<select name='accountId' class='ops-input' required>"+options+"</select></label>"+
          "<label>Forma de pagamento<select name='method' class='ops-input'><option value='PIX'>Pix</option><option value='CASH'>Dinheiro</option><option value='CARD'>Cartão</option><option value='TRANSFER'>Transferência</option><option value='OTHER'>Outro</option></select></label>"+
          "<p>Esta operação registra uma baixa integral e gera histórico de auditoria.</p>",
        validate:data=>!data.accountId?{message:'Selecione a conta.',field:'accountId'}:null,
        onConfirm:data=>api.financeKanbanMove(card.id,{stage:'DONE',confirmed:true,accountId:data.accountId,method:data.method,idempotencyKey:api.mutationId()})
      });
      if(!result.confirmed)return;
      toast('Baixa financeira confirmada e card concluído.','success');
    }else{
      await api.financeKanbanMove(card.id,{stage,idempotencyKey:api.mutationId()});
      toast('Etapa atualizada.','success');
    }
    await renderKanban();
  }
  async function renderKanban(){
    const route='finance-kanban';if(!await authorized(route))return;
    const [cards,accounts]=await Promise.all([api.financeKanbanCards(),api.financeAccounts()]);
    if(document.body.dataset.activeRoute!==route)return;
    const stages=['PENDING','IN_PROGRESS','DONE'];
    const columns=stages.map(stage=>{
      const items=cards.filter(card=>card.stage===stage);
      return "<section class='finance-kanban-column' data-drop-stage='"+stage+"' aria-label='"+stageLabels[stage]+"'>"+
        "<h2>"+stageLabels[stage]+" <small>"+items.length+"</small></h2><div class='finance-kanban-stack'>"+
        (items.map(kanbanCard).join('')||"<p class='ops-muted'>Nenhum card nesta etapa.</p>")+
        "</div></section>";
    }).join('');
    const actions=can('finance.manage')?"<button id='finance-new-task' class='ops-primary' type='button'>Nova tarefa</button>":'';
    content.innerHTML=frame(route,'Organize contas e tarefas por etapa. Concluir contas em aberto exige confirmação e permissão específica.',
      "<div class='finance-kanban-board'>"+columns+"</div>"+
      "<p class='ops-muted'>Arraste os cards para outra coluna ou use os botões. Pagamentos já liquidados só podem ser reabertos após estorno autorizado.</p>",actions);
    complete(route);
    document.getElementById('finance-new-task')?.addEventListener('click',()=>void createTask().catch(e=>toast(e.message,'error')));
    content.querySelectorAll('[data-move-id]').forEach(button=>button.addEventListener('click',()=>{
      const card=cards.find(c=>c.id===button.dataset.moveId);if(card)void moveCard(card,button.dataset.moveStage,accounts).catch(e=>toast(e.message,'error'));
    }));
    content.querySelectorAll('[data-task-edit]').forEach(button=>button.addEventListener('click',()=>{
      const card=cards.find(c=>c.id===button.dataset.taskEdit);if(card)void editTask(card).catch(e=>toast(e.message,'error'));
    }));
    let draggedId=null;
    content.querySelectorAll('.finance-kanban-card').forEach(element=>element.addEventListener('dragstart',event=>{
      if(!can('finance.manage')){event.preventDefault();return;}
      draggedId=element.dataset.cardId;
      event.dataTransfer?.setData('text/plain',draggedId);
      if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
    }));
    content.querySelectorAll('[data-drop-stage]').forEach(column=>{
      column.addEventListener('dragover',event=>{if(can('finance.manage'))event.preventDefault();});
      column.addEventListener('drop',event=>{
        event.preventDefault();
        const id=draggedId||event.dataTransfer?.getData('text/plain');
        draggedId=null;
        const card=cards.find(c=>c.id===id);
        if(card&&card.stage!==column.dataset.dropStage)void moveCard(card,column.dataset.dropStage,accounts).catch(e=>toast(e.message,'error'));
      });
    });
  }
  registry.register('finance-sheets',{owner:'finance-workspace',render:renderSheets});
  registry.register('finance-bi',{owner:'finance-workspace',render:renderBi});
  registry.register('finance-kanban',{owner:'finance-workspace',render:renderKanban});
  root.PdvFinanceWorkspaceUi=Object.freeze({renderSheets,renderBi,renderKanban,parseCsv,csvEntries});
})();
