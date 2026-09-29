'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  const content=document.getElementById('route-content');
  const modalRoot=document.getElementById('modal-root');
  const toastRoot=document.getElementById('toast-root');
  if(!ApiClient||!content)return;
  const api=new ApiClient();
  let mounting=false;
  let currentUser=null;

  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roleLabel=role=>({admin:'Administrador',manager:'Gerente',cashier:'Operador / vendedor'})[role]||role;
  const canManageCatalog=()=>['admin','manager'].includes(currentUser?.role);
  const isAdmin=()=>currentUser?.role==='admin';
  function toast(message,type=''){if(!toastRoot)return;const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;toastRoot.appendChild(el);setTimeout(()=>el.remove(),3500);}
  async function session(){if(currentUser)return currentUser;try{currentUser=(await api.currentSession()).user;return currentUser;}catch{return null;}}
  function closeModal(){if(!modalRoot)return;modalRoot.classList.add('hidden');modalRoot.innerHTML='';}
  function modal(title,body,onMount){if(!modalRoot)return;modalRoot.classList.remove('hidden');modalRoot.innerHTML=`<section class="modal-card"><header><h2>${esc(title)}</h2><button type="button" class="modal-close" data-catalog-modal-close>×</button></header>${body}</section>`;modalRoot.querySelector('[data-catalog-modal-close]')?.addEventListener('click',closeModal);onMount?.(modalRoot);}
  function heading(){return content.querySelector('.page h1,.ops-page h1')?.textContent?.trim()||'';}

  async function renderUsers({force=false}={}){
    await session();
    if(!['admin','manager'].includes(currentUser?.role))return;
    const page=content.querySelector('.page');if(!page||heading()!=='Vendedores')return;
    const existing=page.querySelector('#catalog-user-management-users');
    if(existing&&!force)return;
    existing?.remove();
    const users=await api.users(true);
    const panel=document.createElement('section');panel.id='catalog-user-management-users';panel.className='data-card';panel.style.marginTop='14px';
    panel.innerHTML=`<div style="padding:14px"><header class="page-head"><div><h2>Usuários e vendedores</h2><p>Crie acessos, altere perfil e senha e controle usuários ativos e inativos sem remover as funções de vendedores.</p></div><button type="button" class="primary-button" id="catalog-new-user">＋ Novo usuário</button></header><div>${users.map(user=>{
      const managerBlocked=currentUser.role==='manager'&&user.role==='admin';
      const status=user.active?'Ativo':'Inativo';
      const activation=isAdmin()?(user.active?`<button type="button" class="danger-button" data-remove-user="${esc(user.id)}">Desativar</button>`:`<button type="button" class="secondary-button" data-reactivate-user="${esc(user.id)}">Ativar</button>`):'';
      return `<div class="data-row" data-user-row="${esc(user.id)}"><div><strong>${esc(user.name)}</strong><small>@${esc(user.username)}${user.email?` · ${esc(user.email)}`:''}</small></div><div><small>Perfil</small><strong>${esc(roleLabel(user.role))}</strong></div><div><small>Status</small><strong>${status}</strong></div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="secondary-button" data-edit-user="${esc(user.id)}" ${managerBlocked?'disabled title="Somente administrador pode alterar administradores"':''}>Editar</button>${activation}</div></div>`;
    }).join('')||'<div class="empty-state">Nenhum usuário cadastrado.</div>'}</div></div>`;
    page.appendChild(panel);
    panel.querySelector('#catalog-new-user')?.addEventListener('click',()=>openUserForm());
    panel.querySelectorAll('[data-edit-user]').forEach(button=>button.addEventListener('click',()=>{const user=users.find(item=>item.id===button.dataset.editUser);if(user)openUserForm(user);}));
    panel.querySelectorAll('[data-remove-user]').forEach(button=>button.addEventListener('click',()=>confirmUserDeactivation(users.find(item=>item.id===button.dataset.removeUser))));
    panel.querySelectorAll('[data-reactivate-user]').forEach(button=>button.addEventListener('click',async()=>{const user=users.find(item=>item.id===button.dataset.reactivateUser);if(!user)return;try{await api.saveUser({id:user.id,name:user.name,username:user.username,email:user.email||'',role:user.role,password:'',active:true});toast('Usuário ativado.','success');await renderUsers({force:true});}catch(error){toast(error.message,'error');}}));
  }

  function openUserForm(user=null){
    const editing=Boolean(user);const admin=isAdmin();
    if(currentUser?.role==='manager'&&user?.role==='admin')return toast('Somente administrador pode alterar administradores.','error');
    const roles=admin?['cashier','manager','admin']:['cashier','manager'];
    modal(editing?'Editar usuário':'Novo usuário',`<form id="catalog-user-form"><div class="field-grid"><div class="field wide"><label>Nome *</label><input name="name" required value="${esc(user?.name||'')}"></div><div class="field"><label>Usuário *</label><input name="username" autocomplete="off" required value="${esc(user?.username||'')}"></div><div class="field"><label>E-mail</label><input name="email" type="email" value="${esc(user?.email||'')}"></div><div class="field"><label>Perfil *</label><select name="role">${roles.map(role=>`<option value="${role}" ${(user?.role||'cashier')===role?'selected':''}>${esc(roleLabel(role))}</option>`).join('')}</select></div><div class="field wide"><label>${editing?'Nova senha (deixe em branco para manter)':'Senha *'}</label><input name="password" type="password" minlength="10" ${editing?'':'required'} autocomplete="new-password"></div>${admin?`<label class="field wide"><span><input name="active" type="checkbox" ${user?.active===false?'':'checked'}> Usuário ativo</span></label>`:''}</div><div class="modal-actions"><button type="button" class="secondary-button" data-catalog-modal-close>Cancelar</button><button type="submit" class="primary-button">Salvar usuário</button></div></form>`,root=>{
      root.querySelectorAll('[data-catalog-modal-close]').forEach(button=>button.addEventListener('click',closeModal));
      root.querySelector('#catalog-user-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const data=new FormData(form);try{await api.saveUser({id:user?.id,name:String(data.get('name')||''),username:String(data.get('username')||''),email:String(data.get('email')||''),role:String(data.get('role')||''),password:String(data.get('password')||''),active:admin?form.elements.namedItem('active').checked:(user?.active??true)});closeModal();toast(editing?'Usuário atualizado.':'Usuário criado.','success');await renderUsers({force:true});}catch(error){toast(error.message,'error');}});
    });
  }

  function confirmUserDeactivation(user){
    if(!user)return;
    modal('Desativar usuário',`<p>Desativar <strong>${esc(user.name)}</strong>? O histórico será preservado e o acesso será encerrado.</p><div class="modal-actions"><button type="button" class="secondary-button" data-catalog-modal-close>Cancelar</button><button type="button" class="danger-button" id="catalog-confirm-remove-user">Desativar</button></div>`,root=>{root.querySelectorAll('[data-catalog-modal-close]').forEach(button=>button.addEventListener('click',closeModal));root.querySelector('#catalog-confirm-remove-user')?.addEventListener('click',async()=>{try{await api.removeUser(user.id);closeModal();toast('Usuário desativado. Histórico preservado.','success');await renderUsers({force:true});}catch(error){toast(error.message,'error');}});});
  }

  async function enhanceCustomers(){
    await session();const root=content.querySelector('.page');if(!root||heading()!=='Clientes')return;
    if(!canManageCatalog()){
      root.querySelector('#new-customer')?.remove();
      root.querySelectorAll('[data-edit-customer]').forEach(button=>button.remove());
      return;
    }
    if(root.dataset.catalogDeletionEnhanced==='1')return;
    root.dataset.catalogDeletionEnhanced='1';
    const active=await api.customers();const activeIds=new Set(active.map(item=>item.id));
    root.querySelectorAll('[data-edit-customer]').forEach(button=>{
      const id=button.dataset.editCustomer;const row=button.closest('.data-row');
      if(!activeIds.has(id)){row?.remove();return;}
      if(row?.querySelector('[data-remove-customer]'))return;
      const remove=document.createElement('button');remove.type='button';remove.className='danger-button';remove.dataset.removeCustomer=id;remove.textContent='Excluir';button.insertAdjacentElement('afterend',remove);
      remove.addEventListener('click',()=>confirmCatalogRemoval('cliente',active.find(item=>item.id===id),()=>api.removeCustomer(id),async()=>{row?.remove();}));
    });
  }

  async function enhanceProducts(){
    await session();const root=content.querySelector('.page');if(!root||heading()!=='Produtos')return;
    if(!canManageCatalog()){
      root.querySelector('#new-product')?.remove();root.querySelector('#new-category')?.remove();
      root.querySelectorAll('[data-edit-product],[data-remove-product]').forEach(button=>button.remove());return;
    }
    if(root.querySelector('#catalog-category-management'))return;
    const categories=await api.categories();
    const card=document.createElement('section');card.id='catalog-category-management';card.className='data-card';card.style.marginTop='14px';
    card.innerHTML=`<div style="padding:14px"><div class="page-head" style="margin-bottom:10px"><div><h2 style="margin:0">Categorias</h2><p>Exclusão lógica mantém os produtos e o histórico vinculados.</p></div></div>${categories.map(category=>`<div class="data-row"><div><strong>${esc(category.name)}</strong><small>${esc(category.id)}</small></div><div></div><div></div><button type="button" class="danger-button" data-remove-category="${esc(category.id)}">Excluir</button></div>`).join('')||'<div class="empty-state">Nenhuma categoria ativa.</div>'}</div>`;
    root.appendChild(card);
    card.querySelectorAll('[data-remove-category]').forEach(button=>button.addEventListener('click',()=>{const category=categories.find(item=>item.id===button.dataset.removeCategory);confirmCatalogRemoval('categoria',category,()=>api.removeCategory(category.id),async()=>{card.remove();await enhanceProducts();});}));
  }

  async function enhanceSuppliers(){
    await session();if(!canManageCatalog())return;
    const form=content.querySelector('#enterprise-supplier-form');if(!form||content.querySelector('#catalog-supplier-management'))return;
    const suppliers=await api.suppliers();const host=form.closest('.ops-card');if(!host)return;
    const box=document.createElement('div');box.id='catalog-supplier-management';box.style.marginTop='14px';
    box.innerHTML=`<h3>Fornecedores ativos</h3>${suppliers.map(supplier=>`<div class="ops-row"><div><strong>${esc(supplier.name)}</strong><small>${esc(supplier.document||'Sem documento')}</small></div><button type="button" class="danger-button" data-remove-supplier="${esc(supplier.id)}">Excluir</button></div>`).join('')||'<p class="ops-muted">Nenhum fornecedor ativo.</p>'}`;
    host.appendChild(box);
    box.querySelectorAll('[data-remove-supplier]').forEach(button=>button.addEventListener('click',()=>{const supplier=suppliers.find(item=>item.id===button.dataset.removeSupplier);confirmCatalogRemoval('fornecedor',supplier,()=>api.removeSupplier(supplier.id),async()=>{box.remove();content.querySelector(`#enterprise-po-form option[value="${CSS.escape(supplier.id)}"]`)?.remove();await enhanceSuppliers();});}));
  }

  function confirmCatalogRemoval(label,item,action,refresh){
    if(!item)return;
    modal(`Excluir ${label}`,`<p>Excluir <strong>${esc(item.name)}</strong> do cadastro ativo?</p><p>O registro não será apagado fisicamente: vendas, compras e demais históricos continuarão preservados.</p><div class="modal-actions"><button type="button" class="secondary-button" data-catalog-modal-close>Cancelar</button><button type="button" class="danger-button" id="catalog-confirm-remove">Excluir</button></div>`,root=>{root.querySelectorAll('[data-catalog-modal-close]').forEach(button=>button.addEventListener('click',closeModal));root.querySelector('#catalog-confirm-remove')?.addEventListener('click',async()=>{try{await action();closeModal();toast(`${item.name} removido do cadastro ativo. Histórico preservado.`,'success');await refresh?.();}catch(error){toast(error.message,'error');}});});
  }

  async function mount(){
    if(mounting)return;mounting=true;
    try{
      await session();const title=heading();
      if(title==='Vendedores')await renderUsers();
      else if(title==='Clientes')await enhanceCustomers();
      else if(title==='Produtos')await enhanceProducts();
      else if(title==='Compras e recebimentos')await enhanceSuppliers();
    }catch(error){console.warn('Catalog/user management UI unavailable:',error?.message||error);}finally{mounting=false;}
  }

  const observer=new MutationObserver(()=>queueMicrotask(()=>void mount()));observer.observe(content,{childList:true,subtree:true});void mount();
})();
