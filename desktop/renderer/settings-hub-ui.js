'use strict';

(() => {
  const content=document.getElementById('route-content');
  if(!content)return;
  const categories=[
    ['company','Empresa','Dados da empresa e implantação'],
    ['team','Equipe e permissões','Pessoas, papéis e acessos'],
    ['units','Unidades e dispositivos','Terminais e dispositivos conectados'],
    ['printing','Impressão e periféricos','Impressoras, balança, leitor e gaveta'],
    ['fiscal','Fiscal','Documentos, credenciais e monitoramento'],
    ['modules','Módulos','Ativação dos módulos do estabelecimento'],
    ['privacy','Privacidade e telemetria','Consentimento e diagnóstico anônimo'],
    ['diagnostics','Diagnóstico e backup','Saúde, suporte, importação e recuperação']
  ];
  let active='company';let scheduled=false;
  const page=()=>{const node=content.querySelector('.ops-page');return node?.querySelector('.ops-head h1')?.textContent?.trim()==='Configurações'?node:null;};
  const categoryFor=card=>{
    if(card.id==='settings-team-access')return'team';
    if(card.id==='ops-establishment-modules-card')return'modules';
    if(card.id==='telemetry-settings-card')return'privacy';
    if(card.id==='settings-devices')return'printing';
    const title=card.querySelector('h2,h3')?.textContent?.trim()||'';
    if(/privacidade|telemetria/i.test(title))return'privacy';
    if(/módulo/i.test(title))return'modules';
    if(/fiscal|focus|nf[cs]-?e|documento eletrônico/i.test(title))return'fiscal';
    if(/impress|hardware|periférico|balança|gaveta|leitor/i.test(title))return'printing';
    if(/terminal|unidade|dispositivo|acesso mobile/i.test(title))return'units';
    if(/loja|empresa|marca|identidade|configuração pública/i.test(title))return'company';
    if(/equipe|usuário|papéis|permissões|comiss/i.test(title))return'team';
    return'diagnostics';
  };
  function addTeamCard(root){
    if(!['admin','manager'].includes(document.body.dataset.userRole||''))return;
    if(root.querySelector('#settings-team-access'))return;
    const card=document.createElement('section');card.id='settings-team-access';card.className='ops-card';
    card.innerHTML='<div class="ops-card-head"><div><h2>Equipe e permissões</h2><p class="ops-muted">Cadastre pessoas, defina login, função e áreas liberadas.</p></div><button type="button" class="ops-primary" data-settings-route="sellers">Abrir Equipe e acessos</button></div>';
    root.appendChild(card);
    card.querySelector('[data-settings-route="sellers"]')?.addEventListener('click',()=>document.querySelector('#sidebar-nav [data-route="sellers"]')?.click());
  }
  function ensureHub(root){
    let hub=root.querySelector('#settings-hub');
    if(hub)return hub;
    hub=document.createElement('section');hub.id='settings-hub';hub.className='settings-hub';hub.innerHTML=`<nav class="settings-hub-nav" aria-label="Áreas de configuração">${categories.map(([id,label,description])=>`<button type="button" data-settings-category="${id}" class="${id===active?'active':''}"><strong>${label}</strong><span>${description}</span></button>`).join('')}</nav><div class="settings-hub-current" aria-live="polite"></div>`;
    root.querySelector('.ops-head')?.insertAdjacentElement('afterend',hub);
    hub.querySelectorAll('[data-settings-category]').forEach(button=>button.addEventListener('click',()=>{active=button.dataset.settingsCategory;apply(root,hub);}));
    return hub;
  }
  function apply(root,hub){
    addTeamCard(root);
    root.querySelectorAll('.ops-card').forEach(card=>{if(card.closest('#settings-hub'))return;card.dataset.settingsSection=categoryFor(card);card.hidden=card.dataset.settingsSection!==active;});
    root.querySelectorAll('.ops-grid,.vertical-layout').forEach(group=>{if(group.closest('#settings-hub'))return;const cards=[...group.querySelectorAll(':scope > .ops-card,:scope > section,.vertical-settings,.vertical-enabled')];if(cards.length)group.hidden=!cards.some(card=>!card.hidden);});
    hub.querySelectorAll('[data-settings-category]').forEach(button=>{const selected=button.dataset.settingsCategory===active;button.classList.toggle('active',selected);button.setAttribute('aria-current',selected?'page':'false');});
    const selected=categories.find(([id])=>id===active);const count=root.querySelectorAll(`[data-settings-section="${active}"]`).length;
    const summary=count?`${selected[1]} · ${count} área${count===1?'':'s'}`:`${selected[1]} · nenhuma configuração disponível para este perfil`;const status=hub.querySelector('.settings-hub-current');if(status.textContent!==summary)status.textContent=summary;
  }
  function mount(){scheduled=false;const root=page();if(!root)return;const hub=ensureHub(root);apply(root,hub);}
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(mount);};
  new MutationObserver(schedule).observe(content,{childList:true,subtree:true});schedule();
})();
