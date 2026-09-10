'use strict';

(() => {
  const root=window;
  const {ApiClient}=root.PdvApiClient;
  const api=new ApiClient();
  const content=document.getElementById('route-content');
  let rendering=false;
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const badge=value=>`<span class="ops-badge status-${esc(String(value||'').toLowerCase())}">${esc(value||'—')}</span>`;
  const when=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
  const toast=(message,type='')=>{const host=document.getElementById('toast-root');if(!host)return;const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;host.appendChild(el);setTimeout(()=>el.remove(),3500);};

  async function loadAdminData(){
    const [health,backupStatus,backups,settings,pilot,readiness,logs,audit]=await Promise.all([
      api.systemHealth().catch(()=>null),api.backupStatus().catch(()=>null),api.backups().catch(()=>[]),api.settings().catch(()=>[]),
      api.pilotChecks().catch(()=>[]),api.pilotReadiness().catch(()=>null),api.systemLogs({limit:20}).catch(()=>[]),api.audit({limit:20}).catch(()=>[])
    ]);
    return{health,backupStatus,backups,settings,pilot,readiness,logs,audit};
  }

  function readinessSummary(readiness){
    if(!readiness)return '<p class="ops-muted">Prontidão indisponível para este perfil.</p>';
    return `<div class="ops-status-line">${badge(readiness.status)}<span>${readiness.readyCount}/${readiness.total} itens prontos · ${readiness.blockedCount} bloqueios internos · ${readiness.externalBlockedCount} dependências externas</span></div>`;
  }

  async function mount(){
    if(rendering||!content||!content.querySelector('.ops-page'))return;
    const heading=content.querySelector('.ops-head h1');if(!heading||heading.textContent.trim()!=='Configurações'||content.querySelector('#ops-admin-control-center'))return;
    rendering=true;
    try{
      const cfg=await api.initialize();const data=await loadAdminData();
      if(!content.querySelector('.ops-page')||content.querySelector('.ops-head h1')?.textContent.trim()!=='Configurações')return;
      const publicStore=data.settings.find(item=>item.scope==='global'&&item.key==='store.name')?.value||cfg.storeName||'Loja Matriz';
      const panel=document.createElement('section');panel.id='ops-admin-control-center';panel.className='ops-admin-center';
      panel.innerHTML=`
        <section class="ops-card"><div class="ops-card-head"><div><h2>Implantação e prontidão</h2><p class="ops-muted">Perfil ${esc(cfg.deploymentProfile||'server-terminal')} · versão ${esc(cfg.version||'—')}</p></div><button id="ops-refresh-admin" class="ops-secondary">Atualizar</button></div>${readinessSummary(data.readiness)}
          <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Verificação</th><th>Estado</th><th>Observação</th><th>Ação</th></tr></thead><tbody>${data.pilot.map(item=>`<tr><td><strong>${esc(item.title)}</strong><small>${esc(item.category)}${item.optional?' · quando aplicável':''}</small></td><td>${badge(item.status)}</td><td>${esc(item.note||'—')}</td><td><select class="ops-input compact" data-pilot-status="${esc(item.key)}"><option value="NOT_STARTED" ${item.status==='NOT_STARTED'?'selected':''}>Não iniciado</option><option value="IN_PROGRESS" ${item.status==='IN_PROGRESS'?'selected':''}>Em andamento</option><option value="READY" ${item.status==='READY'?'selected':''}>Pronto</option><option value="BLOCKED" ${item.status==='BLOCKED'?'selected':''}>Bloqueado interno</option><option value="BLOCKED_EXTERNAL" ${item.status==='BLOCKED_EXTERNAL'?'selected':''}>Dependência externa</option></select></td></tr>`).join('')}</tbody></table></div>
        </section>
        <div class="ops-grid two">
          <section class="ops-card"><h2>Loja e configuração pública</h2><form id="ops-store-setting" class="ops-form"><label>Nome da loja<input name="storeName" class="ops-input" value="${esc(publicStore)}" required></label><button class="ops-primary" type="submit">Salvar configuração</button></form><dl class="ops-details"><div><dt>Servidor</dt><dd>${esc(cfg.apiBase||'local')}</dd></div><div><dt>Terminal</dt><dd>${esc(cfg.terminalName||cfg.terminalId)}</dd></div><div><dt>Schema</dt><dd>${esc(data.health?.schemaVersion??'—')}</dd></div><div><dt>Outbox pendente</dt><dd>${esc(data.health?.outbox?.pending??'—')}</dd></div></dl></section>
          <section class="ops-card"><div class="ops-card-head"><h2>Backup e recuperação</h2><button id="ops-backup-now" class="ops-primary">Criar backup</button></div><p class="ops-muted">Restore é preparado com backup de segurança e aplicado somente no próximo início do servidor.</p><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Motivo</th><th>Validação</th><th></th></tr></thead><tbody>${data.backups.slice(0,20).map(item=>`<tr><td>${when(item.createdAt)}</td><td>${esc(item.reason)}</td><td>${badge(item.valid?'VÁLIDO':'NÃO VALIDADO')}</td><td><div class="ops-row-actions"><button class="ops-link" data-backup-validate="${esc(item.id)}">Validar</button><button class="ops-link danger" data-backup-restore="${esc(item.id)}">Preparar restore</button></div></td></tr>`).join('')||'<tr><td colspan="4">Nenhum backup registrado.</td></tr>'}</tbody></table></div><small>Retidos: ${esc(data.backupStatus?.count??0)}</small></section>
        </div>
        <section class="ops-card"><div class="ops-card-head"><div><h2>Importação assistida</h2><p class="ops-muted">CSV UTF-8 ou XLSX · preview obrigatório · commit idempotente.</p></div><button id="ops-import-pick" class="ops-secondary">Selecionar arquivo</button></div><form id="ops-import-form" class="ops-form ops-inline-form"><label>Tipo<select name="type" class="ops-input"><option value="products">Produtos</option><option value="categories">Categorias</option><option value="customers">Clientes</option><option value="suppliers">Fornecedores</option><option value="inventory">Estoque inicial</option></select></label><label>Colisão<select name="collisionPolicy" class="ops-input"><option value="CREATE">Somente novos</option><option value="UPDATE">Atualizar existentes</option><option value="SKIP">Ignorar existentes</option></select></label><div id="ops-import-file" class="ops-muted">Nenhum arquivo selecionado.</div><button id="ops-import-preview" class="ops-primary" type="submit" disabled>Gerar preview</button></form><div id="ops-import-preview-result"></div></section>
        <div class="ops-grid two"><section class="ops-card"><div class="ops-card-head"><h2>Diagnóstico e saúde</h2><button id="ops-create-diagnostics" class="ops-secondary">Gerar diagnóstico ZIP</button></div><dl class="ops-details"><div><dt>Banco</dt><dd>${badge(data.health?.database?.ok?'OK':'ATENÇÃO')}</dd></div><div><dt>Terminais</dt><dd>${esc(data.health?.terminals?.total??'—')}</dd></div><div><dt>Impressões pendentes</dt><dd>${esc(data.health?.printing?.pending??'—')}</dd></div><div><dt>Fiscal pendente/falho</dt><dd>${esc((data.health?.fiscal?.pending??0)+(data.health?.fiscal?.failed??0))}</dd></div></dl></section>
          <section class="ops-card"><h2>Eventos recentes de suporte</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Subsistema/Ação</th><th>Mensagem</th></tr></thead><tbody>${data.logs.slice(0,10).map(row=>`<tr><td>${when(row.createdAt)}</td><td>${esc(row.subsystem)}</td><td>${esc(row.message)}</td></tr>`).join('')}${data.audit.slice(0,10).map(row=>`<tr><td>${when(row.createdAt)}</td><td>${esc(row.action)}</td><td>${esc(`${row.entity}${row.entityId?` · ${row.entityId}`:''}`)}</td></tr>`).join('')||'<tr><td colspan="3">Sem eventos recentes.</td></tr>'}</tbody></table></div></section></div>`;
      content.querySelector('.ops-page')?.appendChild(panel);wire(panel);
    }catch(error){console.warn('Admin control center unavailable:',error?.message||error);}finally{rendering=false;}
  }

  function wire(panel){
    panel.querySelector('#ops-refresh-admin')?.addEventListener('click',()=>{panel.remove();void mount();});
    panel.querySelector('#ops-store-setting')?.addEventListener('submit',async event=>{event.preventDefault();try{await api.saveSetting('store.name',new FormData(event.currentTarget).get('storeName'),'global');toast('Configuração salva.','success');}catch(error){toast(error.message,'error');}});
    panel.querySelector('#ops-backup-now')?.addEventListener('click',async()=>{try{await api.createBackup('manual-ui');toast('Backup criado e validado.','success');panel.remove();await mount();}catch(error){toast(error.message,'error');}});
    panel.querySelectorAll('[data-backup-validate]').forEach(button=>button.addEventListener('click',async()=>{try{const result=await api.validateBackup(button.dataset.backupValidate);toast(result.valid?'Backup válido.':(result.errors||[]).join(' '),result.valid?'success':'error');panel.remove();await mount();}catch(error){toast(error.message,'error');}}));
    panel.querySelectorAll('[data-backup-restore]').forEach(button=>button.addEventListener('click',async()=>{if(!confirm('Preparar este restore? O sistema criará um backup de segurança e aplicará a restauração no próximo início.'))return;try{await api.prepareRestore(button.dataset.backupRestore);toast('Restore preparado. Reinicie o servidor para aplicar.','success');panel.remove();await mount();}catch(error){toast(error.message,'error');}}));
    panel.querySelectorAll('[data-pilot-status]').forEach(select=>select.addEventListener('change',async()=>{try{const note=select.value.startsWith('BLOCKED')?(prompt('Registre a causa/dependência:','')||null):null;await api.updatePilotCheck(select.dataset.pilotStatus,{status:select.value,note});toast('Checklist atualizado.','success');panel.remove();await mount();}catch(error){toast(error.message,'error');}}));
    let selected=null;panel.querySelector('#ops-import-pick')?.addEventListener('click',async()=>{try{selected=await root.artisysDesktop.imports.pickFile();if(!selected)return;panel.querySelector('#ops-import-file').textContent=`${selected.name} · ${(selected.size/1024).toFixed(1)} KB`;panel.querySelector('#ops-import-preview').disabled=false;}catch(error){toast(error.message,'error');}});
    panel.querySelector('#ops-import-form')?.addEventListener('submit',async event=>{event.preventDefault();if(!selected)return;const form=new FormData(event.currentTarget);try{const preview=await api.importPreview({type:form.get('type'),format:selected.format,content:selected.content,collisionPolicy:form.get('collisionPolicy')});const host=panel.querySelector('#ops-import-preview-result');host.innerHTML=`<div class="ops-status-line">${badge(preview.summary.invalid?'COM ERROS':'PRONTO')}<span>${preview.summary.total} linhas · ${preview.summary.valid} válidas · ${preview.summary.invalid} inválidas</span>${preview.summary.invalid?'<span>Corrija o arquivo antes do commit.</span>':`<button class="ops-primary" id="ops-import-commit">Confirmar importação</button>`}</div>`;host.querySelector('#ops-import-commit')?.addEventListener('click',async()=>{try{await api.commitImport(preview.batchId);toast('Importação concluída.','success');}catch(error){toast(error.message,'error');}});}catch(error){toast(error.message,'error');}});
    panel.querySelector('#ops-create-diagnostics')?.addEventListener('click',async()=>{try{const result=await api.createDiagnostics();toast(`Diagnóstico gerado: ${result.fileName}`,'success');}catch(error){toast(error.message,'error');}});
  }

  const observer=new MutationObserver(()=>{void mount();});if(content)observer.observe(content,{childList:true,subtree:false});void mount();
})();
