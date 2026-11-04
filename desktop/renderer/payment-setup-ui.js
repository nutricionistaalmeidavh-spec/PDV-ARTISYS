'use strict';
(function paymentSetupUi() {
  const content=document.getElementById('route-content');
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!content||!ApiClient)return;
  const api=new ApiClient();
  const token=()=>window.sessionStorage?.getItem('artisys.sessionToken')||'';
  const can=cap=>Boolean(window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,cap));
  const text=(input)=>String(input??'').trim();
  const notify=(message,kind='')=>window.PdvToast?.show?.(message,kind);
  function parseTerminalMap(raw){
    const lines=text(raw).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if(!lines.length)return null;
    const result=Object.create(null);
    const values=new Set();
    for(const line of lines){
      const parts=line.split('=');
      if(parts.length!==2||!parts.every(s=>/^[A-Za-z0-9_-]{1,40}$/.test(s.trim())))
        throw new Error('Cada linha precisa ser CAIXA=ID_PAYGO (exemplo: PDV-01=1234).');
      const local=parts[0].trim(),remote=parts[1].trim();
      if(Object.hasOwn(result,local)||values.has(remote))
        throw new Error('Cada caixa e PinPad devem aparecer apenas uma vez.');
      result[local]=remote;values.add(remote);
    }
    return result;
  }
  function mount(root){
    if(!root||root.querySelector('#settings-payment-setup'))return;
    const card=document.createElement('section');
    card.id='settings-payment-setup';card.dataset.settingsCategory='payments';card.className='ops-card';
    const manage=can('deployment.manage'),managePix=can('settings.manage');
    card.innerHTML=`
      <div class="ops-card-head"><div><h2>Assistente de pagamentos · Pix e TEF</h2>
        <p class="ops-muted">Funciona sem TEF por padrão. Nenhum contrato, maquininha, API paga ou serviço externo é obrigatório para o PDV.</p></div></div>
      <div class="field-grid">
        <div class="field wide"><strong>Etapa 1 — Pix gratuito (QR local)</strong>
          <p>Cadastre a chave da loja e gere o QR durante a venda. O recebimento deve ser conferido no extrato; o QR local não consulta o banco.</p></div>
      </div>
      <form id="payment-setup-pix" class="field-grid">
        <div class="field wide"><label for="payment-setup-pix-key">Chave Pix da loja</label><input id="payment-setup-pix-key" name="key" autocomplete="off" required ${managePix?'':'disabled'}></div>
        <div class="field"><label for="payment-setup-pix-merchant">Nome do recebedor</label><input id="payment-setup-pix-merchant" name="merchantName" maxlength="25" required ${managePix?'':'disabled'}></div>
        <div class="field"><label for="payment-setup-pix-city">Cidade</label><input id="payment-setup-pix-city" name="merchantCity" maxlength="15" required ${managePix?'':'disabled'}></div>
        <div class="modal-actions wide"><button type="submit" class="primary-button" ${managePix?'':'disabled'}>Salvar Pix da loja</button></div>
      </form>
      <div class="field-grid">
        <div class="field wide"><strong>Etapa 2 — Escolha como aceitar cartões</strong>
          <p>Pix e cartão manual continuam disponíveis sem integração. Para PinPad automático, configure um provedor TEF separadamente, com as credenciais fornecidas à loja.</p></div>
      </div>
      <form id="payment-setup-tef" class="field-grid">
        <div class="field wide"><label for="payment-setup-mode">Integração de cartões</label><select id="payment-setup-mode" name="mode" ${manage?'':'disabled'}>
          <option value="manual">Sem TEF integrado (padrão, R$ 0)</option>
          <option value="paygo">PayGo Windows (opcional, depende da operadora)</option>
          <option value="bridge">Executável TEF compatível já instalado (avançado)</option>
        </select></div>
        <div class="field-grid wide" data-payment-paygo hidden>
          <div class="field wide"><strong>Etapa 3 — Instalar e ativar o PayGo Windows em cada caixa</strong>
            <p>O cliente PayGo é fornecido pela operadora, não acompanha o instalador ArtiSys. Instale, ative com ID e senha de instalação e teste o PinPad no próprio PayGo antes de usar no PDV.</p>
            <button type="button" class="secondary-button" data-paygo-download ${manage?'':'disabled'}>Abrir download oficial do PayGo Windows</button></div>
          <div class="field wide"><label for="payment-paygo-url">Servidor da API PayGo</label><input id="payment-paygo-url" name="baseUrl" type="url" value="https://sandbox.controlpay.com.br/webapi/" placeholder="https://.../webapi/" required ${manage?'':'disabled'}></div>
          <div class="field wide"><label for="payment-paygo-key">Chave de integração fornecida pela operadora</label><input id="payment-paygo-key" name="integrationKey" type="password" autocomplete="new-password" placeholder="Deixe vazio para conservar a chave já salva" ${manage?'':'disabled'}></div>
          <div class="field"><label for="payment-paygo-terminal">ID PayGo (um único caixa)</label><input id="payment-paygo-terminal" name="terminalId" placeholder="Ex.: 1234" ${manage?'':'disabled'}></div>
          <div class="field wide"><label for="payment-paygo-map">Vários caixas: uma linha por terminal LAN (substitui o ID acima)</label>
            <textarea id="payment-paygo-map" name="terminalMap" rows="3" placeholder="PDV-01=1234&#10;PDV-02=5678" ${manage?'':'disabled'}></textarea>
            <small>O identificador da esquerda deve ser igual ao terminal que consta na venda do ArtiSys. Não reutilize um PinPad em dois caixas.</small></div>
        </div>
        <div class="field-grid wide" data-payment-bridge hidden>
          <div class="field wide"><strong>Etapa 3 — Selecionar o bridge TEF instalado</strong>
            <p>Somente um programa compatível com o contrato de integração ArtiSys. Selecionar um .exe qualquer não cria integração ACBr, SiTef ou PayGo nem comprova homologação.</p></div>
          <div class="field wide"><label for="payment-bridge-exe">Executável TEF (.exe)</label><input id="payment-bridge-exe" name="executable" readonly placeholder="Nenhum executável selecionado" ${manage?'':'disabled'}>
            <button type="button" class="secondary-button" data-bridge-select ${manage?'':'disabled'}>Selecionar executável instalado</button></div>
        </div>
        <div class="field wide" data-payment-mode-summary role="status" aria-live="polite">Carregando configuração...</div>
        <div class="modal-actions wide"><button type="submit" class="primary-button" ${manage?'':'disabled'}>Salvar configuração TEF</button>
          <button type="button" class="secondary-button" data-payments-restart hidden ${manage?'':'disabled'}>Reiniciar ArtiSys para ativar</button></div>
      </form>
      <p class="ops-muted">Etapa 4 — Faça uma venda de homologação no equipamento real. Não basta salvar a configuração para declarar o terminal aprovado. Configurações TEF ficam protegidas no armazenamento do sistema operacional do PC principal; o instalador e o banco comercial não guardam a senha da operadora.</p>
      <p class="ops-muted" data-payment-setup-error role="alert"></p>`;
    root.appendChild(card);
    const pixForm=card.querySelector('#payment-setup-pix');
    const tefForm=card.querySelector('#payment-setup-tef');
    const mode=tefForm.elements.namedItem('mode');
    const status=card.querySelector('[data-payment-mode-summary]');
    const errorBox=card.querySelector('[data-payment-setup-error]');
    const updateMode=()=>{
      card.querySelector('[data-payment-paygo]').hidden=mode.value!=='paygo';
      card.querySelector('[data-payment-bridge]').hidden=mode.value!=='bridge';
    };
    mode.addEventListener('change',updateMode);
    const showError=error=>{errorBox.textContent=String(error?.message||error);notify(errorBox.textContent,'error');};
    void (async()=>{
      try{
        const rows=await api.settings({scope:'global',prefix:'payments.pix.static'});
        const config=rows.find(x=>x.key==='payments.pix.static')?.value||{};
        for(const key of ['key','merchantName','merchantCity']){
          const field=pixForm.elements.namedItem(key);if(field)field.value=config[key]||'';
        }
      }catch(error){if(managePix)showError(error);}
      try{
        if(!window.artisysDesktop?.payments)throw new Error('Assistente TEF indisponivel nesta plataforma.');
        if(!manage){status.textContent='Somente gestores autorizados podem configurar TEF.';return;}
        const config=await window.artisysDesktop.payments.state(token());
        mode.value=config.mode||'manual';
        for(const key of ['baseUrl','terminalId','executable']){
          const field=tefForm.elements.namedItem(key);if(field&&config[key])field.value=config[key];
        }
        tefForm.elements.namedItem('terminalMap').value=config.terminalMap?
          Object.entries(config.terminalMap).map(([local,remote])=>local+'='+remote).join('\n'):'';
        status.textContent=config.error?
          'TEF desativado: '+config.error:
          config.mode==='paygo'?'PayGo salvo. Reinicie o PDV e teste o PinPad.':
          config.mode==='bridge'?'Bridge selecionado. Reinicie e teste o executável homologado.':
          'Sem TEF integrado — vendas manuais e Pix continuam disponíveis.';
        if(!config.encryptionAvailable)status.textContent+=' O armazenamento criptografado do sistema operacional está indisponível para novas credenciais.';
        updateMode();
      }catch(error){status.textContent='TEF indisponível neste computador.';if(manage)showError(error);}
    })();
    pixForm.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!managePix)return;
      try{
        await api.saveSetting('payments.pix.static',{
          key:text(pixForm.elements.namedItem('key').value),
          merchantName:text(pixForm.elements.namedItem('merchantName').value),
          merchantCity:text(pixForm.elements.namedItem('merchantCity').value)
        });
        notify('Pix local configurado. Na venda, gere o QR e confira o extrato.','success');
      }catch(error){showError(error);}
    });
    card.querySelector('[data-paygo-download]')?.addEventListener('click',async()=>{
      try{await window.artisysDesktop.payments.openPayGoDownload(token());}
      catch(error){showError(error);}
    });
    card.querySelector('[data-bridge-select]')?.addEventListener('click',async()=>{
      try{
        const result=await window.artisysDesktop.payments.chooseBridge(token());
        if(!result.cancelled)tefForm.elements.namedItem('executable').value=result.executable||'';
      }catch(error){showError(error);}
    });
    tefForm.addEventListener('submit',async event=>{
      event.preventDefault();if(!manage)return;
      try{
        const chosen=mode.value;
        const input={mode:chosen};
        if(chosen==='paygo'){
          input.baseUrl=text(tefForm.elements.namedItem('baseUrl').value);
          input.integrationKey=text(tefForm.elements.namedItem('integrationKey').value);
          input.terminalMap=parseTerminalMap(tefForm.elements.namedItem('terminalMap').value);
          input.terminalId=text(tefForm.elements.namedItem('terminalId').value);
        }
        if(chosen==='bridge')input.executable=text(tefForm.elements.namedItem('executable').value);
        const result=await window.artisysDesktop.payments.save(input,token());
        tefForm.elements.namedItem('integrationKey').value='';
        errorBox.textContent='';
        status.textContent=result.mode==='manual'?
          'TEF desativado. Reinicie para aplicar.':'Configuração salva com proteção do sistema operacional. Reinicie para aplicar; depois teste o PinPad.';
        card.querySelector('[data-payments-restart]').hidden=false;
        notify('Configuração salva. Reinicie o ArtiSys para ativar.','success');
      }catch(error){showError(error);}
    });
    card.querySelector('[data-payments-restart]')?.addEventListener('click',async()=>{
      try{await window.artisysDesktop.payments.restart(token());}
      catch(error){showError(error);}
    });
  }
  window.PdvPaymentSetupUi=Object.freeze({mount});
})();
