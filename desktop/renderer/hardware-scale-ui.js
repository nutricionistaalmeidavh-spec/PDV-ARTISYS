'use strict';

(()=>{
  function hardware(){ return window.artisysDesktop?.hardware; }

  function setStatus(message, error=false){
    const node=document.getElementById('scale-config-status');
    if(!node)return;
    node.textContent=String(message||'');
    node.style.color=error?'#b42318':'';
  }

  function setRequestVisibility(){
    const profile=document.getElementById('scale-profile');
    const row=document.getElementById('scale-request-row');
    if(row)row.hidden=profile?.value!=='urano-pop-s';
  }

  async function loadConfiguration(){
    const api=hardware();
    if(!api)return;
    const diagnostics=await api.diagnostics();
    const scale=diagnostics?.configuration?.scale||{};
    const profile=document.getElementById('scale-profile');
    const port=document.getElementById('scale-port');
    const request=document.getElementById('scale-request');
    if(!profile||!port||!request)return;

    profile.value=scale.profile==='urano-pop-s'?'urano-pop-s':'generic';
    const selected=String(scale.port||'');
    port.replaceChildren();
    const none=document.createElement('option');none.value='';none.textContent='Desativada / selecione uma porta';port.appendChild(none);
    const ports=Array.isArray(diagnostics?.serialPorts)?diagnostics.serialPorts:[];
    for(const item of ports){
      if(!item?.path)continue;
      const option=document.createElement('option');
      option.value=String(item.path);
      option.textContent=item.manufacturer?`${item.path} — ${item.manufacturer}`:String(item.path);
      port.appendChild(option);
    }
    if(selected && ![...port.options].some(option=>option.value===selected)){
      const option=document.createElement('option');option.value=selected;option.textContent=`${selected} — configurada (não detectada agora)`;port.appendChild(option);
    }
    port.value=selected;
    request.value=scale.requestCommand==='0x05'?'0x05':'0x04';
    setRequestVisibility();
    const summary=profile.value==='urano-pop-s'
      ? `Urano US 31/2 POP-S · ${selected||'sem porta'} · 9600 / 8N2`
      : `${selected?'Balança genérica em '+selected:'Balança não configurada'}`;
    setStatus(summary,false);
  }

  async function saveConfiguration(testAfter=false){
    const api=hardware();
    if(!api?.configureScale)throw new Error('Configuração de balança indisponível nesta versão.');
    const profile=document.getElementById('scale-profile')?.value||'generic';
    const port=document.getElementById('scale-port')?.value||'';
    const requestCommand=document.getElementById('scale-request')?.value||'0x04';
    setStatus('Salvando configuração...');
    const configuration=await api.configureScale({profile,port,requestCommand});
    if(testAfter && configuration.configured){
      const reading=await api.testScale();
      setStatus(`Configuração salva. Leitura: ${Number(reading.weight).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3})} ${reading.unit||'kg'}`);
    } else {
      setStatus(configuration.configured?'Configuração salva e aplicada.':'Balança desativada.');
    }
    const output=document.getElementById('hw-output');
    if(output)output.textContent=JSON.stringify(await api.diagnostics(),null,2);
  }

  function enhance(){
    const output=document.getElementById('hw-output');
    if(!output||document.getElementById('scale-config-card'))return;
    const existing=output.closest('.data-card');
    if(!existing?.parentNode)return;
    const card=document.createElement('div');
    card.className='data-card';
    card.id='scale-config-card';
    card.innerHTML=`
      <h2>Balança</h2>
      <p>Selecione o perfil e a porta COM. O perfil Urano aplica automaticamente 9600 / 8N2 e o protocolo POP-S.</p>
      <div class="vertical-form">
        <label class="field"><span>Modelo / protocolo</span><select id="scale-profile"><option value="generic">Genérica</option><option value="urano-pop-s">Urano US 31/2 POP-S</option></select></label>
        <label class="field"><span>Porta serial</span><select id="scale-port"><option value="">Carregando portas...</option></select></label>
        <label class="field" id="scale-request-row"><span>Comando de leitura Urano</span><select id="scale-request"><option value="0x04">0x04 (padrão)</option><option value="0x05">0x05</option></select></label>
        <div class="vertical-actions"><button type="button" id="scale-refresh-ports" class="secondary-button">Detectar portas</button><button type="button" id="scale-save" class="primary-button">Salvar configuração</button><button type="button" id="scale-save-test">Salvar e testar</button></div>
        <p id="scale-config-status" class="vertical-rule"></p>
      </div>`;
    existing.parentNode.insertBefore(card,existing);
    document.getElementById('scale-profile')?.addEventListener('change',setRequestVisibility);
    document.getElementById('scale-refresh-ports')?.addEventListener('click',()=>loadConfiguration().catch(error=>setStatus(error.message,true)));
    document.getElementById('scale-save')?.addEventListener('click',()=>saveConfiguration(false).catch(error=>setStatus(error.message,true)));
    document.getElementById('scale-save-test')?.addEventListener('click',()=>saveConfiguration(true).catch(error=>setStatus(error.message,true)));
    loadConfiguration().catch(error=>setStatus(error.message,true));
  }

  const observer=new MutationObserver(enhance);
  observer.observe(document.documentElement,{childList:true,subtree:true});
  enhance();
})();
