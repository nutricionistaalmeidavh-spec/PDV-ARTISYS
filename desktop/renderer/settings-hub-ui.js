'use strict';

(() => {
  const content=document.getElementById('route-content');
  const lifecycle=window.PdvUiLifecycle;
  if(!content||!lifecycle)return;
  const categories=[
    ['company','Empresa','Dados da empresa e implantação'],
    ['team','Equipe e permissões','Pessoas, papéis e acessos'],
    ['units','Unidades e dispositivos','Dados, servidor e terminais conectados'],
    ['printing','Impressão e periféricos','Impressoras, balança, leitor e gaveta'],
    ['fiscal','Fiscal','Documentos, credenciais e monitoramento'],
    ['modules','Áreas','Alimentação e Atacado quando mudam o fluxo principal'],
    ['privacy','Privacidade e telemetria','Consentimento e diagnóstico anônimo'],
    ['diagnostics','Diagnóstico e backup','Saúde, suporte, importação e recuperação']
  ];
  let active='company';let scheduled=false;
  const page=()=>{const node=content.querySelector('.ops-page');return node?.querySelector('.ops-head h1')?.textContent?.trim()==='Configurações'?node:null;};
  const categoryFor=card=>{
    const declared=String(card.dataset.settingsCategory||'');
    if(categories.some(([id])=>id===declared))return declared;
    if(card.id==='settings-team-access')return'team';
    if(card.id==='settings-data-server')return'units';
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
  function addDataServerCard(root){
    if(root.querySelector('#settings-data-server'))return;
    const card=document.createElement('section');card.id='settings-data-server';card.className='ops-card';
    card.innerHTML=`<div class="ops-card-head"><div><h2>Dados e servidor</h2><p class="ops-muted">Escolha explicitamente onde os dados ficam e qual aparelho atende os outros terminais.</p></div></div><div class="settings-mode-summary" role="status" aria-live="polite"></div><form id="settings-data-server-form" class="field-grid"><div class="field wide"><label for="settings-server-mode">Este computador será</label><select id="settings-server-mode" name="mode"><option value="local">Apenas meu caixa · dados neste computador</option><option value="lan-host">PC principal · atende aparelhos da rede local</option><option value="lan-client">Terminal cliente · conecta a um PC principal</option><option value="own-server">Terminal conectado a servidor próprio</option></select></div><div class="field" data-server-option="port"><label for="settings-server-port">Porta da rede local</label><input id="settings-server-port" name="port" type="number" min="1" max="65535" value="4174"></div><div class="field wide" data-server-option="serverUrl"><label for="settings-server-url">Endereço do servidor</label><input id="settings-server-url" name="serverUrl" placeholder="http://192.168.0.10:4174 ou https://servidor.exemplo"></div><div class="field" data-server-option="terminalId"><label for="settings-terminal-id">Identificação do terminal</label><input id="settings-terminal-id" name="terminalId"></div><div class="field" data-server-option="terminalKey"><label for="settings-terminal-key">Chave de pareamento</label><input id="settings-terminal-key" name="terminalKey" type="password" autocomplete="off"></div><div class="modal-actions wide"><button type="button" class="secondary-button" data-test>Testar conexão</button><button type="submit" class="primary-button">Salvar escolha e reiniciar</button></div><p class="ops-muted wide">A troca para servidor externo não migra dados locais automaticamente. A aplicação informa e bloqueia a mudança se houver dados sem migração.</p></form>`;
    root.appendChild(card);
    const form=card.querySelector('form');
    const modeSummary=card.querySelector('.settings-mode-summary');
    const modeCopy={local:['Somente neste computador','Os dados permanecem neste PC. Nenhum acesso pela rede é iniciado.'], 'lan-host':['PC principal da rede local','Este PC atende os terminais autorizados na mesma rede; a rede só é ativada após salvar.'], 'lan-client':['Terminal conectado','Este aparelho usa o servidor indicado abaixo. Se ele estiver indisponível, o sistema não troca silenciosamente para dados locais.'], 'own-server':['Servidor próprio','Este terminal conecta ao endereço configurado. A conexão não muda nem envia dados até você salvar.']};
    const syncModeFields=()=>{const mode=form.elements.mode.value;const [title,copy]=modeCopy[mode]||modeCopy.local;modeSummary.innerHTML=`<strong>${title}</strong><span>${copy}</span>`;card.querySelectorAll('[data-server-option]').forEach(field=>{const key=field.dataset.serverOption;const visible=key==='port'?mode==='lan-host':key==='serverUrl'?['lan-client','own-server'].includes(mode):['terminalId','terminalKey'].includes(key)?mode==='lan-client':false;field.hidden=!visible;});card.querySelector('[data-test]').hidden=!['lan-client','own-server'].includes(mode);};
    form.elements.mode.addEventListener('change',syncModeFields);
    syncModeFields();
    window.artisysDesktop.dataServer.state().then(value=>{form.elements.mode.value=value.mode;form.elements.port.value=value.port;form.elements.serverUrl.value=value.serverUrl||'';form.elements.terminalId.value=value.terminalId||'';form.elements.terminalKey.value=value.terminalKey||'';syncModeFields();}).catch(error=>{modeSummary.replaceChildren();const title=document.createElement('strong');title.textContent='Não foi possível confirmar o modo salvo';const detail=document.createElement('span');detail.textContent=String(error?.message||'Verifique a conexão antes de alterar esta opção.');modeSummary.append(title,detail);});
    form.querySelector('[data-test]').addEventListener('click',async()=>{try{await window.artisysDesktop.dataServer.test({serverUrl:form.elements.serverUrl.value});window.ToastUI?.show?.('Servidor encontrado.','success');}catch(error){window.ToastUI?.show?.(error.message,'error');}});
    form.addEventListener('submit',async event=>{event.preventDefault();try{await window.artisysDesktop.dataServer.save({mode:form.elements.mode.value,port:Number(form.elements.port.value),serverUrl:form.elements.serverUrl.value,terminalId:form.elements.terminalId.value,terminalKey:form.elements.terminalKey.value});await window.artisysDesktop.dataServer.restart();}catch(error){window.ToastUI?.show?.(error.message,'error');}});
  }
  function ensureHub(root){
    let hub=root.querySelector('#settings-hub');
    if(hub)return hub;
    root.dataset.settingsPage='true';
    hub=document.createElement('section');hub.id='settings-hub';hub.className='settings-hub';hub.innerHTML=`<nav class="settings-hub-nav" aria-label="Áreas de configuração">${categories.map(([id,label,description])=>`<button type="button" data-settings-category="${id}" class="${id===active?'active':''}" aria-pressed="${id===active}"><strong>${label}</strong><span>${description}</span></button>`).join('')}</nav><div class="settings-hub-current" aria-live="polite"></div>`;
    root.querySelector('.ops-head')?.insertAdjacentElement('afterend',hub);
    hub.querySelectorAll('[data-settings-category]').forEach(button=>button.addEventListener('click',()=>{active=button.dataset.settingsCategory;apply(root,hub);}));
    return hub;
  }
  function apply(root,hub){
    addTeamCard(root);
    addDataServerCard(root);
    root.querySelectorAll('.ops-card').forEach(card=>{if(card.closest('#settings-hub'))return;card.dataset.settingsSection=categoryFor(card);card.hidden=card.dataset.settingsSection!==active;});
    root.querySelectorAll('.ops-grid,.vertical-layout').forEach(group=>{if(group.closest('#settings-hub'))return;const cards=[...group.querySelectorAll(':scope > .ops-card,:scope > section,.vertical-settings,.vertical-enabled')];if(cards.length)group.hidden=!cards.some(card=>!card.hidden);});
    hub.querySelectorAll('[data-settings-category]').forEach(button=>{const selected=button.dataset.settingsCategory===active;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
    const selected=categories.find(([id])=>id===active);const count=root.querySelectorAll(`[data-settings-section="${active}"]`).length;
    const summary=count?`${selected[1]} · ${count} área${count===1?'':'s'}`:`${selected[1]} · nenhuma configuração disponível para este perfil`;const status=hub.querySelector('.settings-hub-current');if(status.textContent!==summary)status.textContent=summary;
  }
  function mount(){scheduled=false;const root=page();if(!root)return;const hub=ensureHub(root);apply(root,hub);}
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(mount);};
  const onRouteChange=({route})=>{if(route==='settings')schedule();};
  lifecycle.on('route:mounted',onRouteChange);
  lifecycle.on('route:updated',onRouteChange);
  if(document.body.dataset.activeRoute==='settings')schedule();
})();
