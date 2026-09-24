'use strict';

(()=>{
  const PROFILES=Object.freeze([
    {id:'generic',label:'Genérica',summary:'Configuração serial genérica'},
    {id:'urano-pop-s',label:'Urano US 31/2 POP-S',summary:'9600 / 8N2 · protocolo POP-S binário'},
    {id:'toledo-prix3-prt5',label:'Toledo Prix 3 / PRT 5',summary:'9600 / 8N1 · protocolo Prt5'},
    {id:'urano-udc',label:'Urano UDC CO / CO-E',summary:'9600 / 8N1 · protocolo Std04'},
    {id:'filizola-bp-cs',label:'Filizola BP-S / CS',summary:'9600 / 8N1 · protocolo numérico legado · requer validação física'},
    {id:'generic-numeric',label:'Serial numérica genérica',summary:'9600 / 8N1 · parser numérico'}
  ]);
  function hardware(){return window.artisysDesktop?.hardware;}
  function setStatus(message,error=false){const node=document.getElementById('scale-config-status');if(!node)return;node.textContent=String(message||'');node.style.color=error?'#b42318':'';}
  function profileMeta(id){return PROFILES.find(item=>item.id===id)||PROFILES[0];}
  function setRequestVisibility(){const profile=document.getElementById('scale-profile');const row=document.getElementById('scale-request-row');if(row)row.hidden=profile?.value!=='urano-pop-s';const hint=document.getElementById('scale-profile-hint');if(hint)hint.textContent=profileMeta(profile?.value).summary;}
  async function loadConfiguration(){
    const api=hardware();if(!api)return;const diagnostics=await api.diagnostics();const scale=diagnostics?.configuration?.scale||{};const profile=document.getElementById('scale-profile');const port=document.getElementById('scale-port');const request=document.getElementById('scale-request');if(!profile||!port||!request)return;
    profile.value=PROFILES.some(item=>item.id===scale.profile)?scale.profile:'generic';const selected=String(scale.port||'');port.replaceChildren();const none=document.createElement('option');none.value='';none.textContent='Desativada / selecione uma porta';port.appendChild(none);const ports=Array.isArray(diagnostics?.serialPorts)?diagnostics.serialPorts:[];for(const item of ports){if(!item?.path)continue;const option=document.createElement('option');option.value=String(item.path);option.textContent=item.manufacturer?`${item.path} — ${item.manufacturer}`:String(item.path);port.appendChild(option);}if(selected&&![...port.options].some(option=>option.value===selected)){const option=document.createElement('option');option.value=selected;option.textContent=`${selected} — configurada (não detectada agora)`;port.appendChild(option);}port.value=selected;request.value=scale.requestCommand==='0x05'?'0x05':'0x04';setRequestVisibility();const meta=profileMeta(profile.value);setStatus(selected?`${meta.label} · ${selected} · ${meta.summary}`:'Balança não configurada',false);
  }
  async function saveConfiguration(testAfter=false){
    const api=hardware();if(!api?.configureScale)throw new Error('Configuração de balança indisponível nesta versão.');const profile=document.getElementById('scale-profile')?.value||'generic';const port=document.getElementById('scale-port')?.value||'';const requestCommand=document.getElementById('scale-request')?.value||'0x04';setStatus('Salvando configuração...');const configuration=await api.configureScale({profile,port,requestCommand});if(testAfter&&configuration.configured){const reading=await api.testScale();setStatus(`Configuração salva. Leitura: ${Number(reading.weight).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3})} ${reading.unit||'kg'}`);}else{setStatus(configuration.configured?'Configuração salva e aplicada.':'Balança desativada.');}const output=document.getElementById('hw-output');if(output)output.textContent=JSON.stringify(await api.diagnostics(),null,2);
  }
  function enhance(){
    const output=document.getElementById('hw-output');if(!output||document.getElementById('scale-config-card'))return;const existing=output.closest('.data-card');if(!existing?.parentNode)return;const card=document.createElement('div');card.className='data-card';card.id='scale-config-card';card.innerHTML=`
      <h2>Balança</h2>
      <p>Selecione o modelo/protocolo e a porta COM. Os parâmetros seriais documentados são aplicados automaticamente pelo perfil.</p>
      <div class="vertical-form">
        <label class="field"><span>Modelo / protocolo</span><select id="scale-profile">${PROFILES.map(item=>`<option value="${item.id}">${item.label}</option>`).join('')}</select></label>
        <p id="scale-profile-hint" class="vertical-rule"></p>
        <label class="field"><span>Porta serial</span><select id="scale-port"><option value="">Carregando portas...</option></select></label>
        <label class="field" id="scale-request-row"><span>Comando de leitura Urano POP-S</span><select id="scale-request"><option value="0x04">0x04 (padrão)</option><option value="0x05">0x05</option></select></label>
        <div class="vertical-actions"><button type="button" id="scale-refresh-ports" class="secondary-button">Detectar portas</button><button type="button" id="scale-save" class="primary-button">Salvar configuração</button><button type="button" id="scale-save-test">Salvar e testar</button></div>
        <p id="scale-config-status" class="vertical-rule"></p>
        <p class="vertical-rule">Compatibilidade por protocolo não substitui homologação física do modelo conectado.</p>
      </div>`;existing.parentNode.insertBefore(card,existing);document.getElementById('scale-profile')?.addEventListener('change',setRequestVisibility);document.getElementById('scale-refresh-ports')?.addEventListener('click',()=>loadConfiguration().catch(error=>setStatus(error.message,true)));document.getElementById('scale-save')?.addEventListener('click',()=>saveConfiguration(false).catch(error=>setStatus(error.message,true)));document.getElementById('scale-save-test')?.addEventListener('click',()=>saveConfiguration(true).catch(error=>setStatus(error.message,true)));loadConfiguration().catch(error=>setStatus(error.message,true));
  }
  document.addEventListener('click',event=>{if(event.target?.closest?.('#e54-hardware-card'))queueMicrotask(enhance);});enhance();
})();
