'use strict';

(()=>{
  const ApiClient=window.PdvApiClient?.ApiClient;
  const registry=window.PdvRouteRegistry;
  const accessPolicy=window.PdvAccessPolicy;
  const content=document.getElementById('route-content');
  if(!ApiClient||!registry||!accessPolicy||!content)return;
  const api=new ApiClient();
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let activeTab='people';
  let currentUser=null;
  let accessModel={tabs:[],load:{},actions:{}};
  let snapshot={users:[],profiles:[],devices:[],security:null,permissions:[]};

  const TABS=Object.freeze([
    ['people','Pessoas'],
    ['profiles','Perfis'],
    ['devices','Dispositivos'],
    ['security','Segurança']
  ]);

  function toast(message,type=''){window.PdvToast?.show?.(message,type);}
  function canAction(name){return Boolean(accessModel.actions?.[name]);}
  function visibleTabs(){return TABS.filter(([id])=>accessModel.tabs?.includes(id));}

  async function load(){
    snapshot={users:[],profiles:[],devices:[],security:null,permissions:[]};
    const tasks=[];
    if(accessModel.load?.users)tasks.push(api.users(true).then(value=>{snapshot.users=value;}));
    if(accessModel.load?.profiles)tasks.push(api.accessProfiles(true).then(value=>{snapshot.profiles=value;}));
    if(accessModel.load?.permissions)tasks.push(api.accessPermissions().then(value=>{snapshot.permissions=value.permissions||[];}));
    if(accessModel.load?.devices)tasks.push(api.accessDevices().then(value=>{snapshot.devices=value;}));
    if(accessModel.load?.security)tasks.push(api.accessSecurity().then(value=>{snapshot.security=value;}));
    await Promise.all(tasks);
  }

  function profileName(id){return snapshot.profiles.find(profile=>profile.id===id)?.name||null;}
  function tabs(){return `<div class="tabs access-tabs">${visibleTabs().map(([id,label])=>`<button type="button" class="tab-button ${activeTab===id?'active':''}" data-access-tab="${id}">${label}</button>`).join('')}</div>`;}
  function profileDisplay(user){
    if(!accessModel.load?.profiles)return 'Perfil não disponível';
    return profileName(user.profileId)||'Sem perfil';
  }

  function peopleView(){
    const createButton=canAction('createPerson')?'<button type="button" class="primary-button" data-new-person>Nova pessoa</button>':'';
    return `<div class="data-card"><div class="card-head"><div><h2>Pessoas</h2><p>Perfil de acesso separado de cargo, comissão e dispositivo.</p></div>${createButton}</div>
      <div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Perfil de acesso</th><th>Login</th><th>Status</th><th></th></tr></thead><tbody>
      ${snapshot.users.map(user=>{
        const profileCell=canAction('assignProfile')
          ? `<select data-profile-select>${snapshot.profiles.filter(profile=>profile.active||profile.id===user.profileId).map(profile=>`<option value="${esc(profile.id)}" ${profile.id===user.profileId?'selected':''}>${esc(profile.name)}</option>`).join('')}</select>`
          : `<span>${esc(profileDisplay(user))}</span>`;
        const actions=[
          canAction('editPerson')?'<button type="button" class="secondary-button" data-edit-person>Editar</button>':'',
          canAction('assignProfile')?'<button type="button" class="secondary-button" data-save-profile>Salvar perfil</button>':''
        ].filter(Boolean).join('');
        return `<tr data-user-row="${esc(user.id)}"><td><strong>${esc(user.name)}</strong><small>${esc(user.email||user.username||'')}</small></td><td>${profileCell}</td><td>${esc(user.username||'')}</td><td>${user.active?'Ativo':'Inativo'}</td><td><div class="vertical-actions">${actions}</div></td></tr>`;
      }).join('')||'<tr><td colspan="5">Nenhuma pessoa cadastrada.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function permissionGroups(profile=null){
    const selected=new Set(profile?.permissions||[]);
    const groups=new Map();
    for(const permission of snapshot.permissions){
      if(permission.group==='public')continue;
      if(!groups.has(permission.group))groups.set(permission.group,[]);
      groups.get(permission.group).push(permission);
    }
    return [...groups.entries()].map(([group,permissions])=>`<fieldset class="data-card"><legend>${esc(group)}</legend>${permissions.map(permission=>`<label class="checkbox-row"><input type="checkbox" name="permission" value="${esc(permission.id)}" ${selected.has(permission.id)?'checked':''}><span><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span></label>`).join('')}</fieldset>`).join('');
  }

  function profilesView(){
    const createButton=canAction('createProfile')?'<button type="button" class="primary-button" data-new-profile>Novo perfil</button>':'';
    return `<div class="data-card"><div class="card-head"><div><h2>Perfis</h2><p>Conjuntos reutilizáveis de permissões para pessoas.</p></div>${createButton}</div>
      <div class="settings-grid">${snapshot.profiles.map(profile=>{
        const actions=[
          canAction('editProfile')&&!profile.protected?'<button type="button" class="secondary-button" data-edit-profile>Editar</button>':'',
          canAction('deleteProfile')&&!profile.protected?'<button type="button" class="secondary-button" data-delete-profile>Excluir</button>':''
        ].filter(Boolean).join('');
        return `<article class="data-card" data-profile-card="${esc(profile.id)}"><div class="card-head"><div><h3>${esc(profile.name)}</h3><p>${profile.protected?'Protegido pelo sistema':'Configurável'} · ${profile.permissions.length} permissões</p></div><span class="status-badge">${profile.active?'Ativo':'Inativo'}</span></div>${actions?`<div class="vertical-actions">${actions}</div>`:''}</article>`;
      }).join('')}</div></div>`;
  }

  function devicesView(){
    const createButton=canAction('pairDevice')?'<button type="button" class="primary-button" data-new-device>Novo dispositivo</button>':'';
    return `<div class="data-card"><div class="card-head"><div><h2>Dispositivos</h2><p>Credenciais, superfície operacional, escopo e último acesso.</p></div>${createButton}</div>
      <div class="table-wrap"><table><thead><tr><th>Dispositivo</th><th>Superfície</th><th>Escopo</th><th>Status</th><th>Último acesso</th><th></th></tr></thead><tbody>
      ${snapshot.devices.map(device=>{
        const actions=[
          canAction('blockDevice')?`<button type="button" class="secondary-button" data-toggle-device>${device.status==='ACTIVE'?'Bloquear':'Reativar'}</button>`:'',
          canAction('rotateDeviceCredential')?'<button type="button" class="secondary-button" data-rotate-device>Rotacionar credencial</button>':''
        ].filter(Boolean).join('');
        return `<tr data-device-row="${esc(device.id)}"><td><strong>${esc(device.name)}</strong><small>${esc(device.id)}</small></td><td>${esc(device.surface||device.deviceType)}</td><td>${device.scope?`${esc(device.scope.type)}: ${esc(device.scope.id||'estabelecimento')}`:'Estabelecimento'}</td><td>${esc(device.status)}</td><td>${esc(device.lastSeenAt||'Nunca')}</td><td><div class="vertical-actions">${actions}</div></td></tr>`;
      }).join('')||'<tr><td colspan="6">Nenhum dispositivo pareado.</td></tr>'}
      </tbody></table></div></div>`;
  }

  function securityView(){
    const security=snapshot.security||{counts:{},sessions:[],recent:[]};
    return `<div class="settings-grid">
      <article class="data-card"><h3>Logins ativos</h3><strong class="metric-value">${Number(security.counts?.sessions||0)}</strong></article>
      <article class="data-card"><h3>Administradores</h3><strong class="metric-value">${Number(security.counts?.administrators||0)}</strong></article>
      <article class="data-card"><h3>Dispositivos ativos</h3><strong class="metric-value">${Number(security.counts?.devices||0)}</strong></article>
      <article class="data-card"><h3>Dispositivos bloqueados</h3><strong class="metric-value">${Number(security.counts?.blockedDevices||0)}</strong></article>
      </div>
      <div class="data-card"><div class="card-head"><div><h2>Sessões</h2><p>Sessões humanas atualmente válidas.</p></div></div><div class="table-wrap"><table><thead><tr><th>Pessoa</th><th>Terminal</th><th>Expira</th><th></th></tr></thead><tbody>${(security.sessions||[]).map(session=>`<tr data-session-row="${esc(session.id||'')}"><td>${esc(session.name||session.userId)}</td><td>${esc(session.terminalId||'Local')}</td><td>${esc(session.expiresAt||'')}</td><td>${session.id&&canAction('revokeSession')?'<button type="button" class="secondary-button" data-revoke-session>Revogar</button>':''}</td></tr>`).join('')||'<tr><td colspan="4">Nenhuma sessão ativa.</td></tr>'}</tbody></table></div></div>
      <div class="data-card"><div class="card-head"><div><h2>Eventos recentes</h2><p>Login, perfis, usuários, dispositivos, módulos e configurações.</p></div></div><div class="table-wrap"><table><thead><tr><th>Quando</th><th>Evento</th><th>Ator</th><th>Entidade</th></tr></thead><tbody>${(security.recent||[]).map(event=>`<tr><td>${esc(event.createdAt)}</td><td>${esc(event.action)}</td><td>${esc(event.actorId||event.actorKind||'sistema')}</td><td>${esc(event.entity)} ${esc(event.entityId||'')}</td></tr>`).join('')||'<tr><td colspan="4">Nenhum evento recente.</td></tr>'}</tbody></table></div></div>`;
  }

  function view(){
    if(activeTab==='profiles')return profilesView();
    if(activeTab==='devices')return devicesView();
    if(activeTab==='security')return securityView();
    return peopleView();
  }

  function profileDialog(profile=null){
    const root=window.PdvModal;
    if(!root?.open)return;
    root.open(profile?'Editar perfil':'Novo perfil',`<form data-profile-form><div class="field"><label>Nome do perfil</label><input name="name" required value="${esc(profile?.name||'')}"></div><div class="access-permission-grid">${permissionGroups(profile)}</div><div class="form-actions"><button class="primary-button" type="submit">Salvar</button></div></form>`,{wide:true,onMount:modal=>{
      modal.querySelector('[data-profile-form]').addEventListener('submit',async event=>{
        event.preventDefault();const form=event.currentTarget;
        const permissions=[...form.querySelectorAll('input[name="permission"]:checked')].map(input=>input.value);
        try{
          if(profile)await api.updateAccessProfile(profile.id,{name:form.elements.name.value,permissions});
          else await api.createAccessProfile({name:form.elements.name.value,permissions});
          window.PdvModal.close();await render({state:{user:currentUser}});toast('Perfil salvo.','success');
        }catch(error){toast(error.message,'error');}
      });
    }});
  }

  function personDialog(existing=null){
    const editing=Boolean(existing);
    const profileField=canAction('assignProfile')&&snapshot.profiles.length
      ? `<div class="field"><label>Perfil de acesso</label><select name="profileId">${snapshot.profiles.filter(profile=>profile.active||profile.id===existing?.profileId).map(profile=>`<option value="${esc(profile.id)}" ${profile.id===existing?.profileId?'selected':''}>${esc(profile.name)}</option>`).join('')}</select></div>`
      :'';
    const passwordField=!editing
      ? '<div class="field"><label>Senha inicial</label><input name="password" type="password" minlength="10" required></div>'
      : canAction('resetPassword')?'<div class="field"><label>Nova senha (opcional)</label><input name="password" type="password" minlength="10"></div>':'';
    const activeField=editing&&canAction('disablePerson')
      ? `<label class="checkbox-row"><input name="active" type="checkbox" ${existing.active?'checked':''}><span><strong>Acesso ativo</strong><small>Desmarque para desativar o login desta pessoa.</small></span></label>`
      :'';
    window.PdvModal?.open?.(editing?'Editar pessoa':'Nova pessoa',`<form data-person-form><div class="field"><label>Nome</label><input name="name" required value="${esc(existing?.name||'')}"></div><div class="field"><label>E-mail</label><input name="email" type="email" value="${esc(existing?.email||'')}"></div><div class="field"><label>Usuário</label><input name="username" required value="${esc(existing?.username||'')}"></div>${passwordField}${profileField}${activeField}<div class="form-actions"><button class="primary-button" type="submit">${editing?'Salvar pessoa':'Criar pessoa'}</button></div></form>`,{onMount:modal=>{
      modal.querySelector('[data-person-form]').addEventListener('submit',async event=>{
        event.preventDefault();const form=event.currentTarget;
        const payload={name:form.elements.name.value,email:form.elements.email.value,username:form.elements.username.value};
        if(editing)payload.id=existing.id;else{payload.password=form.elements.password.value;payload.active=true;}
        if(form.elements.profileId)payload.profileId=form.elements.profileId.value;
        if(editing&&form.elements.active)payload.active=form.elements.active.checked;
        if(editing&&form.elements.password?.value)payload.password=form.elements.password.value;
        try{await api.saveUser(payload);window.PdvModal.close();await render({state:{user:currentUser}});toast(editing?'Pessoa atualizada.':'Pessoa criada.','success');}catch(error){toast(error.message,'error');}
      });
    }});
  }

  function deviceDialog(){
    window.PdvModal?.open?.('Novo dispositivo',`<form data-device-form><div class="field"><label>Nome</label><input name="name" required></div><div class="field"><label>Superfície</label><select name="deviceType"><option value="WAITER">Garçom</option><option value="TABLET">Tablet de mesa</option><option value="KITCHEN">KDS / cozinha</option><option value="SELF_SERVICE">Autoatendimento</option></select></div><div class="field"><label>Mesa (somente Tablet)</label><input name="tableId" placeholder="ID da mesa"></div><div class="form-actions"><button class="primary-button" type="submit">Parear</button></div></form>`,{onMount:modal=>{
      modal.querySelector('[data-device-form]').addEventListener('submit',async event=>{
        event.preventDefault();const form=event.currentTarget;
        const deviceType=form.elements.deviceType.value;
        try{const created=await api.createAccessDevice({name:form.elements.name.value,deviceType,tableId:deviceType==='TABLET'?form.elements.tableId.value:null});window.PdvModal.close();await render({state:{user:currentUser}});window.PdvModal?.open?.('Credencial do dispositivo',`<p>Copie esta credencial agora. Ela não será exibida novamente.</p><div class="data-card"><code>${esc(created.credential)}</code></div>`); }catch(error){toast(error.message,'error');}
      });
    }});
  }

  function bind(){
    content.querySelectorAll('[data-access-tab]').forEach(button=>button.addEventListener('click',()=>{activeTab=button.dataset.accessTab;paint();}));
    content.querySelector('[data-new-profile]')?.addEventListener('click',()=>profileDialog());
    content.querySelector('[data-new-person]')?.addEventListener('click',()=>personDialog());
    content.querySelector('[data-new-device]')?.addEventListener('click',deviceDialog);
    content.querySelectorAll('[data-profile-card]').forEach(card=>{
      const profile=snapshot.profiles.find(item=>item.id===card.dataset.profileCard);
      card.querySelector('[data-edit-profile]')?.addEventListener('click',()=>profileDialog(profile));
      card.querySelector('[data-delete-profile]')?.addEventListener('click',async()=>{try{await api.deleteAccessProfile(profile.id);await render({state:{user:currentUser}});toast('Perfil excluído.','success');}catch(error){toast(error.message,'error');}});
    });
    content.querySelectorAll('[data-user-row]').forEach(row=>{
      const user=snapshot.users.find(item=>String(item.id)===String(row.dataset.userRow));
      row.querySelector('[data-edit-person]')?.addEventListener('click',()=>personDialog(user));
      row.querySelector('[data-save-profile]')?.addEventListener('click',async()=>{try{await api.assignAccessProfile(row.dataset.userRow,row.querySelector('[data-profile-select]').value);await render({state:{user:currentUser}});toast('Perfil atualizado.','success');}catch(error){toast(error.message,'error');}});
    });
    content.querySelectorAll('[data-device-row]').forEach(row=>{
      const device=snapshot.devices.find(item=>item.id===row.dataset.deviceRow);
      row.querySelector('[data-toggle-device]')?.addEventListener('click',async()=>{try{await api.setAccessDeviceStatus(device.id,device.status==='ACTIVE'?'BLOCKED':'ACTIVE');await render({state:{user:currentUser}});toast('Dispositivo atualizado.','success');}catch(error){toast(error.message,'error');}});
      row.querySelector('[data-rotate-device]')?.addEventListener('click',async()=>{try{const result=await api.rotateAccessDevice(device.id);await render({state:{user:currentUser}});window.PdvModal?.open?.('Nova credencial',`<p>A credencial anterior foi invalidada.</p><div class="data-card"><code>${esc(result.credential)}</code></div>`);}catch(error){toast(error.message,'error');}});
    });
    content.querySelectorAll('[data-session-row]').forEach(row=>row.querySelector('[data-revoke-session]')?.addEventListener('click',async()=>{try{await api.revokeAccessSession(row.dataset.sessionRow);await render({state:{user:currentUser}});toast('Sessão revogada.','success');}catch(error){toast(error.message,'error');}}));
  }

  function paint(){
    content.innerHTML=`<section class="page access-center-page"><header class="page-head"><div><h1>Acessos e equipe</h1><p>Controle quem entra, o que cada perfil pode fazer e quais dispositivos estão autorizados.</p></div></header>${tabs()}<div data-access-panel>${view()}</div></section>`;
    bind();
  }

  async function render({state}={}){
    currentUser=state?.user||window.PdvCurrentAccess||null;
    accessModel=accessPolicy.accessCenterModel(currentUser);
    const firstTab=accessModel.tabs[0]||null;
    if(!firstTab){
      content.innerHTML='<section class="page"><div class="data-card"><h2>Acesso indisponível</h2><p>Seu perfil não possui permissão para consultar esta área.</p></div></section>';
      return;
    }
    if(!accessModel.tabs.includes(activeTab))activeTab=firstTab;
    content.innerHTML='<section class="page"><div class="data-card"><p>Carregando acessos...</p></div></section>';
    try{await load();paint();}catch(error){content.innerHTML=`<section class="page"><div class="data-card"><h2>Não foi possível carregar os acessos</h2><p>${esc(error.message)}</p></div></section>`;}
  }

  if(!registry.has('access'))registry.register('access',{owner:'access-center',render});
})();
