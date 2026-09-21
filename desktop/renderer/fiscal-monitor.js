'use strict';

(() => {
  const root=window;const {ApiClient}=root.PdvApiClient;const api=new ApiClient();const content=document.getElementById('route-content');let rendering=false;
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const when=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const badge=value=>`<span class="ops-badge status-${esc(String(value||'').toLowerCase())}">${esc(value||'—')}</span>`;
  const toast=(message,type='')=>{const host=document.getElementById('toast-root');if(!host)return;const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;host.appendChild(el);setTimeout(()=>el.remove(),3500);};
  const request=(path,options)=>api.request(path,options);

  function actions(doc){const id=encodeURIComponent(doc.id);const buttons=[`<button class="ops-link" data-fiscal-detail="${esc(doc.id)}">Detalhes</button>`];
    if(doc.lifecycleStatus==='UNKNOWN')buttons.push(`<button class="ops-link" data-fiscal-reconcile="${esc(doc.id)}">Reconciliar</button>`);
    if(doc.lifecycleStatus==='FAILED'||(doc.lifecycleStatus==='UNKNOWN'&&!doc.reconcileRequired&&doc.lastReconcileStatus==='NOT_FOUND'))buttons.push(`<button class="ops-link" data-fiscal-retry="${esc(doc.id)}">Tentar novamente</button>`);
    if(['AUTHORIZED','CANCELLED'].includes(doc.lifecycleStatus)){buttons.push(`<button class="ops-link" data-fiscal-xml="${esc(doc.id)}" data-kind="authorized">XML</button>`);buttons.push(`<button class="ops-link" data-fiscal-danfe="${esc(doc.id)}">DANFE</button>`);}
    if(doc.lifecycleStatus==='AUTHORIZED')buttons.push(`<button class="ops-link danger" data-fiscal-cancel="${esc(doc.id)}">Cancelar</button>`);
    if(doc.lifecycleStatus==='CANCELLED'&&doc.cancellationXmlPath)buttons.push(`<button class="ops-link" data-fiscal-xml="${esc(doc.id)}" data-kind="cancellation">XML cancelamento</button>`);
    return `<div class="ops-row-actions">${buttons.join('')}</div>`;
  }

  async function load(status=''){await api.initialize();return api.fiscalDocuments(status?{status}:{})}
  async function mount(){
    if(rendering||!content||content.querySelector('#fiscal-monitor-panel'))return;
    const page=content.querySelector('.ops-page');const heading=content.querySelector('.ops-head h1');if(!page||!heading||heading.textContent.trim()!=='Configurações')return;
    rendering=true;
    try{
      const docs=await load();if(!content.querySelector('.ops-page')||content.querySelector('#fiscal-monitor-panel'))return;
      const panel=document.createElement('section');panel.id='fiscal-monitor-panel';panel.className='ops-card';panel.innerHTML=`
        <div class="ops-card-head"><div><h2>Fiscal · Documentos</h2><p class="ops-muted">Monitor local de NFC-e/NF-e. Estados incertos exigem reconciliação antes de reenvio.</p></div><div class="ops-row-actions"><select id="fiscal-status-filter" class="ops-input compact"><option value="">Todos</option>${['PENDING','PROCESSING','AUTHORIZED','REJECTED','UNKNOWN','FAILED','CANCELLED'].map(s=>`<option>${s}</option>`).join('')}</select><button id="fiscal-refresh" class="ops-secondary">Atualizar</button></div></div>
        <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Venda</th><th>Documento</th><th>Estado</th><th>Chave</th><th>Tentativas</th><th>Atualização</th><th>Ações</th></tr></thead><tbody id="fiscal-monitor-body">${rows(docs)}</tbody></table></div>
        <div id="fiscal-monitor-detail"></div>`;
      page.appendChild(panel);wire(panel);
    }catch(error){console.warn('Fiscal monitor unavailable:',error?.message||error);}finally{rendering=false;}
  }
  function rows(docs){return docs.map(doc=>`<tr><td>${esc(doc.saleId)}</td><td><strong>${esc((doc.documentType||'').toUpperCase())}</strong><small>${esc(doc.number||'—')} · série ${esc(doc.series||'—')}</small></td><td>${badge(doc.lifecycleStatus)}</td><td>${esc(doc.accessKey?`${doc.accessKey.slice(0,8)}…${doc.accessKey.slice(-6)}`:'—')}</td><td>${esc(doc.attemptCount)}</td><td>${when(doc.updatedAt)}</td><td>${actions(doc)}</td></tr>`).join('')||'<tr><td colspan="7">Nenhum documento fiscal registrado.</td></tr>';}
  async function refresh(panel){const status=panel.querySelector('#fiscal-status-filter')?.value||'';panel.querySelector('#fiscal-monitor-body').innerHTML=rows(await load(status));wireRows(panel);}
  async function detail(panel,id){const result=await request(`/api/v1/fiscal/documents/${encodeURIComponent(id)}/monitor`);const doc=result.document;panel.querySelector('#fiscal-monitor-detail').innerHTML=`<section class="ops-card"><div class="ops-card-head"><h3>${esc(doc.reference)}</h3>${badge(doc.lifecycleStatus)}</div><dl class="ops-details"><div><dt>Venda</dt><dd>${esc(result.sale?.saleNumber||doc.saleId)}</dd></div><div><dt>Total</dt><dd>${money(result.sale?.totalCents)}</dd></div><div><dt>Chave</dt><dd>${esc(doc.accessKey||'—')}</dd></div><div><dt>Protocolo</dt><dd>${esc(doc.authorizationProtocol||'—')}</dd></div><div><dt>SEFAZ</dt><dd>${esc(`${doc.sefazCode||'—'} ${doc.sefazMessage||''}`)}</dd></div><div><dt>Reconciliação</dt><dd>${esc(doc.reconcileRequired?'Obrigatória':doc.lastReconcileStatus||'—')}</dd></div></dl><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Evento</th><th>Estado</th><th>Retorno</th></tr></thead><tbody>${result.events.map(event=>`<tr><td>${when(event.createdAt)}</td><td>${esc(event.eventType)}</td><td>${badge(event.status)}</td><td>${esc(`${event.sefazCode||''} ${event.sefazMessage||''}`||'—')}</td></tr>`).join('')}</tbody></table></div></section>`;}
  function wireRows(panel){
    panel.querySelectorAll('[data-fiscal-detail]').forEach(button=>button.onclick=()=>detail(panel,button.dataset.fiscalDetail).catch(error=>toast(error.message,'error')));
    panel.querySelectorAll('[data-fiscal-reconcile]').forEach(button=>button.onclick=async()=>{try{await request(`/api/v1/fiscal/documents/${encodeURIComponent(button.dataset.fiscalReconcile)}/reconcile`,{method:'POST',body:{},mutationId:api.mutationId()});toast('Reconciliação executada.','success');await refresh(panel);}catch(error){toast(error.message,'error');}});
    panel.querySelectorAll('[data-fiscal-retry]').forEach(button=>button.onclick=async()=>{try{await api.retryFiscalIssue(button.dataset.fiscalRetry);toast('Retry fiscal solicitado.','success');await refresh(panel);}catch(error){toast(error.message,'error');}});
    panel.querySelectorAll('[data-fiscal-cancel]').forEach(button=>button.onclick=async()=>{const reason=prompt('Justificativa do cancelamento (mínimo 15 caracteres):','');if(!reason)return;try{await request(`/api/v1/fiscal/documents/${encodeURIComponent(button.dataset.fiscalCancel)}/cancel`,{method:'POST',body:{reason},mutationId:api.mutationId()});toast('Cancelamento processado.','success');await refresh(panel);}catch(error){toast(error.message,'error');}});
    panel.querySelectorAll('[data-fiscal-danfe]').forEach(button=>button.onclick=async()=>{try{await request(`/api/v1/fiscal/documents/${encodeURIComponent(button.dataset.fiscalDanfe)}/danfe`,{method:'POST',body:{width:42},mutationId:api.mutationId()});toast('DANFE enviado para a fila de impressão.','success');await refresh(panel);}catch(error){toast(error.message,'error');}});
    panel.querySelectorAll('[data-fiscal-xml]').forEach(button=>button.onclick=async()=>{try{const result=await request(`/api/v1/fiscal/documents/${encodeURIComponent(button.dataset.fiscalXml)}/xml?kind=${encodeURIComponent(button.dataset.kind||'authorized')}`);const host=panel.querySelector('#fiscal-monitor-detail');host.innerHTML=`<section class="ops-card"><div class="ops-card-head"><h3>XML fiscal · ${esc(result.kind)}</h3><button class="ops-secondary" id="fiscal-close-xml">Fechar</button></div><pre style="white-space:pre-wrap;max-height:320px;overflow:auto">${esc(result.xml)}</pre></section>`;host.querySelector('#fiscal-close-xml').onclick=()=>{host.innerHTML='';};}catch(error){toast(error.message,'error');}});
  }
  function wire(panel){panel.querySelector('#fiscal-refresh')?.addEventListener('click',()=>refresh(panel).catch(error=>toast(error.message,'error')));panel.querySelector('#fiscal-status-filter')?.addEventListener('change',()=>refresh(panel).catch(error=>toast(error.message,'error')));wireRows(panel);}

  const observer=new MutationObserver(()=>{if(!content||content.querySelector('#fiscal-monitor-panel'))return;void mount();});observer.observe(content,{childList:true,subtree:false});void mount();
})();
