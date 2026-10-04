'use strict';

(() => {
  const root=window;
  const {ApiClient}=root.PdvApiClient;
  const api=new ApiClient();
  const content=document.getElementById('route-content');
  const lifecycle=root.PdvUiLifecycle;
  const routeRegistry=root.PdvRouteRegistry;
  if(!content||!lifecycle||!routeRegistry)return;
  let rendering=false;
  let checklistOpen=false;
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const statusLabels={NOT_STARTED:'Pendente',IN_PROGRESS:'Em andamento',READY:'Pronto',BLOCKED:'Bloqueio interno',BLOCKED_EXTERNAL:'Aguardando serviço externo',NOT_APPLICABLE:'Não se aplica'};
  const categoryLabels={deployment:'Instalação',configuration:'Loja',lan:'Rede local',hardware:'Equipamentos',recovery:'Backup e recuperação',fiscal:'Fiscal',operations:'Operação',migration:'Importação de dados',support:'Suporte'};
  const badge=value=>`<span class="ops-badge status-${esc(String(value||'').toLowerCase())}">${esc(statusLabels[value]||value||'—')}</span>`;
  const when=value=>value?new Date(value).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—';
  const bytes=value=>{const size=Number(value)||0;if(size<1024)return `${size} B`;if(size<1024*1024)return `${(size/1024).toFixed(1)} KB`;return `${(size/(1024*1024)).toFixed(1)} MB`;};
  const backupReason=value=>({manual:'Manual','manual-ui':'Manual','pre-restore':'Segurança antes da restauração'}[value]||value||'—');
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
    return `<div class="ops-status-line">${badge(readiness.status)}<span>${readiness.readyCount}/${readiness.total} itens prontos${readiness.notApplicableCount?` · ${readiness.notApplicableCount} não se aplicam`:''} · ${readiness.blockedCount} bloqueios internos · ${readiness.externalBlockedCount} dependências externas</span></div>`;
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
        <details id="ops-pilot-checklist" class="ops-card ops-pilot-card" data-settings-category="diagnostics" ${checklistOpen&&!data.readiness?.ready?'open':''}><summary class="ops-pilot-summary"><div><h2>Preparar para abrir a loja</h2><p class="ops-muted">${data.readiness?.ready?'Preparação concluída. Clique para consultar as verificações.':'Clique para verificar configuração, equipamentos e recuperação.'}</p>${readinessSummary(data.readiness)}</div><span class="ops-pilot-chevron" aria-hidden="true">⌄</span></summary><div class="ops-pilot-content"><div class="ops-card-head"><p class="ops-muted">Configuração da loja, importação concluída e diagnóstico gerado são verificados automaticamente. Equipamentos, rede e recuperação precisam de confirmação após teste real.</p><button id="ops-refresh-admin" class="ops-secondary">Atualizar</button></div>
          <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Verificação</th><th>Estado</th><th>Observação</th><th>Ação</th></tr></thead><tbody>${data.pilot.map(item=>`<tr><td><strong>${esc(item.title)}</strong><small>${esc(categoryLabels[item.category]||'Configuração')}${item.optional?' · quando aplicável':''}</small></td><td>${badge(item.status)}</td><td>${esc(item.note||'—')}${['configuration','audit','deployment'].includes(item.evidence?.source)?'<small>Verificação automática</small>':''}</td><td><select class="ops-input compact" data-pilot-status="${esc(item.key)}"><option value="NOT_STARTED" ${item.status==='NOT_STARTED'?'selected':''}>Pendente</option><option value="IN_PROGRESS" ${item.status==='IN_PROGRESS'?'selected':''}>Em andamento</option><option value="READY" ${item.status==='READY'?'selected':''}>Pronto</option><option value="BLOCKED" ${item.status==='BLOCKED'?'selected':''}>Bloqueio interno</option><option value="BLOCKED_EXTERNAL" ${item.status==='BLOCKED_EXTERNAL'?'selected':''}>Aguardando serviço externo</option>${item.optional?`<option value="NOT_APPLICABLE" ${item.status==='NOT_APPLICABLE'?'selected':''}>Não se aplica</option>`:''}</select></td></tr>`).join('')}</tbody></table></div>
        </div></details>
        <div class="ops-grid two">
          <section class="ops-card"><h2>Loja e configuração pública</h2><form id="ops-store-setting" class="ops-form"><label>Nome da loja<input name="storeName" class="ops-input" value="${esc(publicStore)}" required></label><button class="ops-primary" type="submit">Salvar configuração</button></form><dl class="ops-details"><div><dt>Servidor</dt><dd>${esc(cfg.apiBase||'local')}</dd></div><div><dt>Terminal</dt><dd>${esc(cfg.terminalName||cfg.terminalId)}</dd></div><div><dt>Schema</dt><dd>${esc(data.health?.schemaVersion??'—')}</dd></div><div><dt>Outbox pendente</dt><dd>${esc(data.health?.outbox?.pending??'—')}</dd></div></dl></section>
          <section id="settings-backup" class="ops-card"><div class="ops-card-head"><div><h2>Backup e recuperação</h2><p class="ops-muted">Proteja os dados da loja e volte a um ponto anterior quando necessário.</p></div><button id="ops-backup-now" class="ops-primary">Criar backup agora</button></div>
            ${data.backupStatus?.pendingRestore?'<div id="ops-backup-pending" class="ops-backup-notice warning" role="status"><div><strong>Restauração pendente</strong><span>O backup escolhido já foi validado e uma cópia de segurança dos dados atuais foi criada. Reinicie o ArtiSys para concluir a restauração.</span></div></div>':''}
            ${data.backupStatus?.latest?`<div class="ops-backup-latest"><div><small>Último backup</small><strong>${when(data.backupStatus.latest.createdAt)}</strong><span>${data.backupStatus.latest.valid?'Integridade verificada':'Validação necessária'} · ${bytes(data.backupStatus.latest.size)}</span></div></div>`:''}
            <div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data e hora</th><th>Motivo</th><th>Tamanho</th><th>Integridade</th><th>Ações</th></tr></thead><tbody>${data.backups.slice(0,20).map(item=>`<tr><td>${when(item.createdAt)}</td><td>${esc(backupReason(item.reason))}</td><td>${esc(bytes(item.size))}</td><td>${badge(item.valid?'VÁLIDO':'NÃO VALIDADO')}</td><td><div class="ops-row-actions"><button class="ops-link" data-backup-validate="${esc(item.id)}">Validar integridade</button><button class="ops-link danger" data-backup-restore="${esc(item.id)}">Restaurar este backup</button></div></td></tr>`).join('')||'<tr><td colspan="5">Nenhum backup registrado.</td></tr>'}</tbody></table></div><small>${esc(data.backupStatus?.count??0)} de ${esc(data.backupStatus?.retention??'—')} backups retidos.</small>
            <div id="ops-backup-restore-modal" class="ops-restore-modal" hidden aria-hidden="true"></div>
          </section>
        </div>
        <section class="ops-card"><div class="ops-card-head"><div><h2>Importação assistida</h2><p class="ops-muted">CSV UTF-8 ou XLSX · preview obrigatório · commit idempotente.</p></div><button id="ops-import-pick" class="ops-secondary">Selecionar arquivo</button></div><form id="ops-import-form" class="ops-form ops-inline-form"><label>Tipo<select name="type" class="ops-input"><option value="products">Produtos</option><option value="categories">Categorias</option><option value="customers">Clientes</option><option value="suppliers">Fornecedores</option><option value="inventory">Estoque inicial</option></select></label><label>Colisão<select name="collisionPolicy" class="ops-input"><option value="CREATE">Somente novos</option><option value="UPDATE">Atualizar existentes</option><option value="SKIP">Ignorar existentes</option></select></label><div id="ops-import-file" class="ops-muted">Nenhum arquivo selecionado.</div><button id="ops-import-preview" class="ops-primary" type="submit" disabled>Gerar preview</button></form><div id="ops-import-preview-result"></div></section>
        <div class="ops-grid two"><section class="ops-card"><div class="ops-card-head"><h2>Diagnóstico e saúde</h2><button id="ops-create-diagnostics" class="ops-secondary">Gerar diagnóstico ZIP</button></div><dl class="ops-details"><div><dt>Banco</dt><dd>${badge(data.health?.database?.ok?'OK':'ATENÇÃO')}</dd></div><div><dt>Terminais</dt><dd>${esc(data.health?.terminals?.total??'—')}</dd></div><div><dt>Impressões pendentes</dt><dd>${esc(data.health?.printing?.pending??'—')}</dd></div><div><dt>Fiscal pendente/falho</dt><dd>${esc((data.health?.fiscal?.pending??0)+(data.health?.fiscal?.failed??0))}</dd></div></dl></section>
          <section class="ops-card"><h2>Eventos recentes de suporte</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Subsistema/Ação</th><th>Mensagem</th></tr></thead><tbody>${data.logs.slice(0,10).map(row=>`<tr><td>${when(row.createdAt)}</td><td>${esc(row.subsystem)}</td><td>${esc(row.message)}</td></tr>`).join('')}${data.audit.slice(0,10).map(row=>`<tr><td>${when(row.createdAt)}</td><td>${esc(row.action)}</td><td>${esc(`${row.entity}${row.entityId?` · ${row.entityId}`:''}`)}</td></tr>`).join('')||'<tr><td colspan="3">Sem eventos recentes.</td></tr>'}</tbody></table></div></section></div>`;
      content.querySelector('.ops-page')?.appendChild(panel);wire(panel);
      routeRegistry.updated('settings',{surface:'settings-extension',extension:'admin-ops'});
    }catch(error){console.warn('Admin control center unavailable:',error?.message||error);}finally{rendering=false;}
  }

  function wire(panel){
    const checklist=panel.querySelector('#ops-pilot-checklist');
    checklist?.addEventListener('toggle',()=>{checklistOpen=checklist.open;});
    panel.querySelector('#ops-refresh-admin')?.addEventListener('click',()=>{panel.remove();void mount();});
    panel.querySelector('#ops-store-setting')?.addEventListener('submit',async event=>{event.preventDefault();try{await api.saveSetting('store.name',new FormData(event.currentTarget).get('storeName'),'global');toast('Configuração salva.','success');}catch(error){toast(error.message,'error');}});
    panel.querySelector('#ops-backup-now')?.addEventListener('click',async()=>{try{await api.createBackup('manual-ui');toast('Backup criado e validado.','success');panel.remove();await mount();}catch(error){toast(error.message,'error');}});
    panel.querySelectorAll('[data-backup-validate]').forEach(button=>button.addEventListener('click',async()=>{try{const result=await api.validateBackup(button.dataset.backupValidate);toast(result.valid?'Backup válido.':(result.errors||[]).join(' '),result.valid?'success':'error');panel.remove();await mount();}catch(error){toast(error.message,'error');}}));
    panel.querySelectorAll('[data-backup-restore]').forEach(button=>button.addEventListener('click',()=>{const item=dataForRestore(panel,button.dataset.backupRestore);if(!item)return;openRestoreDialog(panel,item);}));
    function dataForRestore(scope,id){const row=scope.querySelector(`[data-backup-restore="${CSS.escape(id)}"]`)?.closest('tr');return row?{id,date:row.children[0]?.textContent||'—',reason:row.children[1]?.textContent||'—',size:row.children[2]?.textContent||'—',integrity:row.children[3]?.textContent||'—'}:null;}
    function openRestoreDialog(scope,item){const modal=scope.querySelector('#ops-backup-restore-modal');if(!modal)return;modal.hidden=false;modal.setAttribute('aria-hidden','false');modal.innerHTML=`<div class="ops-restore-backdrop" data-restore-cancel></div><section class="ops-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="ops-restore-title"><div><h3 id="ops-restore-title">Restaurar este backup?</h3><p>Confira o ponto de recuperação antes de continuar.</p></div><dl class="ops-details"><div><dt>Data e hora</dt><dd>${esc(item.date)}</dd></div><div><dt>Motivo</dt><dd>${esc(item.reason)}</dd></div><div><dt>Tamanho</dt><dd>${esc(item.size)}</dd></div><div><dt>Integridade</dt><dd>${esc(item.integrity)}</dd></div></dl><div class="ops-backup-notice warning"><strong>Os dados atuais serão substituídos no próximo início.</strong><span>Antes disso, o ArtiSys criará automaticamente uma cópia de segurança dos dados atuais.</span></div><div class="ops-row-actions restore-actions"><button class="ops-secondary" data-restore-cancel>Cancelar</button><button class="ops-primary danger" data-restore-confirm>Restaurar backup</button></div></section>`;const close=()=>{modal.hidden=true;modal.setAttribute('aria-hidden','true');modal.innerHTML='';};modal.querySelectorAll('[data-restore-cancel]').forEach(el=>el.addEventListener('click',close));modal.querySelector('[data-restore-confirm]')?.addEventListener('click',async()=>{const confirmButton=modal.querySelector('[data-restore-confirm]');confirmButton.disabled=true;confirmButton.textContent='Preparando...';try{await api.prepareRestore(item.id);close();toast('Restauração preparada. Reinicie o ArtiSys para concluir.','success');panel.remove();await mount();}catch(error){confirmButton.disabled=false;confirmButton.textContent='Restaurar backup';toast(error.message,'error');}});modal.querySelector('[data-restore-confirm]')?.focus();}
    panel.querySelectorAll('[data-pilot-status]').forEach(select=>select.addEventListener('change',async()=>{try{const note=select.value.startsWith('BLOCKED')?(prompt('Registre a causa/dependência:','')||null):select.value==='NOT_APPLICABLE'?(prompt('Por que não se aplica a esta loja?','')||null):null;await api.updatePilotCheck(select.dataset.pilotStatus,{status:select.value,note});toast('Checklist atualizado.','success');panel.remove();await mount();}catch(error){toast(error.message,'error');}}));
    let selected=null;panel.querySelector('#ops-import-pick')?.addEventListener('click',async()=>{try{selected=await root.artisysDesktop.imports.pickFile();if(!selected)return;panel.querySelector('#ops-import-file').textContent=`${selected.name} · ${(selected.size/1024).toFixed(1)} KB`;panel.querySelector('#ops-import-preview').disabled=false;}catch(error){toast(error.message,'error');}});
    panel.querySelector('#ops-import-form')?.addEventListener('submit',async event=>{event.preventDefault();if(!selected)return;const form=new FormData(event.currentTarget);try{const preview=await api.importPreview({type:form.get('type'),format:selected.format,content:selected.content,collisionPolicy:form.get('collisionPolicy')});const host=panel.querySelector('#ops-import-preview-result');host.innerHTML=`<div class="ops-status-line">${badge(preview.summary.invalid?'COM ERROS':'PRONTO')}<span>${preview.summary.total} linhas · ${preview.summary.valid} válidas · ${preview.summary.invalid} inválidas</span>${preview.summary.invalid?'<span>Corrija o arquivo antes do commit.</span>':`<button class="ops-primary" id="ops-import-commit">Confirmar importação</button>`}</div>`;host.querySelector('#ops-import-commit')?.addEventListener('click',async()=>{try{await api.commitImport(preview.batchId);toast('Importação concluída.','success');}catch(error){toast(error.message,'error');}});}catch(error){toast(error.message,'error');}});
    panel.querySelector('#ops-create-diagnostics')?.addEventListener('click',async()=>{try{const result=await api.createDiagnostics();toast(`Diagnóstico gerado: ${result.fileName}`,'success');}catch(error){toast(error.message,'error');}});
  }

  const onSettings=({route})=>{if(route==='settings')void mount();};
  lifecycle.on('route:mounted',onSettings);
  lifecycle.on('route:updated',onSettings);
  if(document.body.dataset.activeRoute==='settings')void mount();
})();
