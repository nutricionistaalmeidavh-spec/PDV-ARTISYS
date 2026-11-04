'use strict';
// Opt-in fiscal administration, with official transactions restricted to homologation.
(() => {
 const lifecycle=window.PdvUiLifecycle,ApiClient=window.PdvApiClient?.ApiClient;
 if(!lifecycle||!ApiClient)return;
 const api=new ApiClient();
 let pending=false;let fiscalStatus={};
 const prefix='/api/v1/fiscal-preview';
 const $=(root,selector)=>root.querySelector(selector);
 const message=(root,text,error=false)=>{
  const out=$(root,'[data-fiscal-preview-status]');
  if(out){out.textContent=String(text||'');out.dataset.error=error?'true':'false';}
 };
 function buildCard(){
  const card=document.createElement('section');
  card.id='settings-acbrlib-preview';card.className='ops-card';card.dataset.settingsCategory='company';
  card.innerHTML=`
   <div class="ops-card-head"><div><h2>Fiscal — preparação e homologação ACBrLib</h2>
    <p class="ops-muted">Prepare documentos e realize testes de homologação na SEFAZ. O contador aprova os tributos; produção permanece bloqueada.</p>
   </div></div>
   <div class="ops-card-body">
    <h3>1. Dados do estabelecimento</h3>
    <form data-acbr-company class="field-grid">
      <label class="field"><span>Razão social</span><input name="name" required maxlength="160"></label>
      <label class="field"><span>CNPJ</span><input name="cnpj" required maxlength="14" minlength="14"></label>
      <label class="field"><span>Inscrição estadual</span><input name="stateRegistration" required maxlength="32"></label>
      <label class="field"><span>Nome fantasia</span><input name="tradeName" maxlength="60"></label>
      <label class="field"><span>Logradouro</span><input name="street" required maxlength="60"></label>
      <label class="field"><span>Número</span><input name="streetNumber" required maxlength="60"></label>
      <label class="field"><span>Bairro</span><input name="district" required maxlength="60"></label>
      <label class="field"><span>Código IBGE município</span><input name="municipalityCode" required pattern="[0-9]{7}" maxlength="7"></label>
      <label class="field"><span>Município</span><input name="municipalityName" required maxlength="60"></label>
      <label class="field"><span>CEP (somente números)</span><input name="postalCode" required pattern="[0-9]{8}" maxlength="8"></label>
      <label class="field"><span>UF</span><input name="uf" required maxlength="2" minlength="2" value="SP"></label>
      <label class="field"><span>CRT</span><select name="crt"><option value="1">1 — Simples Nacional</option><option value="2">2 — Simples excesso sublimite</option><option value="3">3 — Regime normal</option><option value="4">4 — MEI</option></select></label>
      <label class="field"><span>Regime de apuração IBS/CBS (NT 2026.005)</span>
        <select name="ibsCbsRegime" required>
          <option value="unconfigured">Não confirmado — emissão bloqueada</option>
          <option value="regular">Regime regular de IBS/CBS revisado</option>
          <option value="simples">Simples Nacional sem regime regular (aguardando gTribSN ACBr)</option>
          <option value="mei">MEI — sem grupo IBS/CBS</option>
        </select>
      </label>
      <label class="field"><span>Série</span><input name="series" type="number" required min="1" max="999" value="1"></label>
      <p class="ops-muted wide">Ambiente: homologação. Emissão automática e produção permanecem bloqueadas.</p>
      <div class="modal-actions"><button class="primary-button" type="submit">Salvar dados para revisão</button></div>
    </form>
    <h3>1b. Certificado digital A1 — somente no PC principal</h3>
    <div data-acbr-local-cert hidden>
      <p data-acbr-cert-status class="ops-muted" role="status" aria-live="polite"></p>
      <form data-acbr-cert-form class="field-grid" autocomplete="off">
        <label class="field"><span>UF do certificado</span><input name="uf" required maxlength="2" value="SP"></label>
        <label class="field"><span>Senha do A1</span><input name="password" type="password" required autocomplete="new-password"></label>
        <label class="field"><span>CSC NFC-e de homologação</span><input name="csc" type="password" autocomplete="off"></label>
        <label class="field"><span>Identificador CSC</span><input name="idCsc" autocomplete="off" maxlength="8"></label>
        <div class="modal-actions"><button class="primary-button" type="submit">Escolher arquivo PFX/P12 e importar localmente</button></div>
      </form>
      <button class="secondary-button" data-acbr-enable-homologation type="button" hidden>Habilitar envio somente em homologação</button>
      <p class="ops-muted">A1 e CSC ficam neste computador. O arquivo não vai para a API nem para o GitHub. A emissão requer reinicialização após habilitar.</p>
    </div>
    <h3>2. Perfil tributário por produto</h3>
    <form data-acbr-product class="field-grid">
      <label class="field wide"><span>Produto</span><select name="productId" required><option value="">Carregando produtos...</option></select></label>
      <label class="field"><span>NCM</span><input name="ncm" required minlength="8" maxlength="8"></label>
      <label class="field"><span>cAtivSN (CRT 1/2, NT 2026.005)</span><input name="cAtivSN" maxlength="2" pattern="(01|02|03|04|90)" placeholder="01"></label>
      <label class="field"><span>CEST (quando aplicável)</span><input name="cest" maxlength="7"></label>
      <label class="field"><span>CFOP</span><input name="cfop" required minlength="4" maxlength="4"></label>
      <label class="field"><span>Origem (0–8)</span><input name="origin" required maxlength="1" value="0"></label>
      <label class="field"><span>CST (regime normal)</span><input name="cst" maxlength="2"></label>
      <label class="field"><span>CSOSN (Simples)</span><input name="csosn" maxlength="3"></label>
      <label class="field"><span>CST PIS</span><input name="pisCst" maxlength="2" required></label>
      <label class="field"><span>CST COFINS</span><input name="cofinsCst" maxlength="2" required></label>
      <label class="field"><span>Unidade</span><input name="unit" maxlength="8" required value="UN"></label>
      <label class="field"><span>CST IBS/CBS revisado</span><input name="ibsCbsCst" required maxlength="3"></label>
      <label class="field"><span>cClassTrib revisado</span><input name="cClassTrib" required maxlength="6"></label>
      <label class="field"><span>Alíquota IBS UF (%)</span><input name="ibsUfRate" required placeholder="0.1000" pattern="[0-9]{1,3}\\.[0-9]{4}" inputmode="decimal"></label>
      <label class="field"><span>Alíquota IBS município (%)</span><input name="ibsMunRate" required placeholder="0.0000" pattern="[0-9]{1,3}\\.[0-9]{4}" inputmode="decimal"></label>
      <label class="field"><span>Alíquota CBS (%)</span><input name="cbsRate" required placeholder="0.9000" pattern="[0-9]{1,3}\\.[0-9]{4}" inputmode="decimal"></label>
      <label class="field wide"><span><input name="zeroLegacyTaxesConfirmed" type="checkbox"> Contabilidade confirmou tratamento sem valor de ICMS/PIS/COFINS para este perfil?</span></label>
      <p class="ops-muted wide">Informar classificação e valores aprovados pela contabilidade. ST devido exige integração separada ao total da venda; até lá o envio permanece bloqueado.</p>
      <details class="wide" data-acbr-legacy><summary>Tributação ICMS / PIS / COFINS e ST — campos avançados</summary>
        <div class="field-grid">
          <p class="ops-muted wide">Os campos seguintes são informados e revisados pela contabilidade. Não há alíquotas preenchidas automaticamente. Taxa percentual com quatro decimais, por exemplo 18.0000.</p>
          <label class="field"><span>Base do ICMS próprio (% do item líquido)</span><input name="icmsBasePercent" inputmode="decimal" placeholder="100.0000"></label>
          <label class="field"><span>Alíquota ICMS próprio (%)</span><input name="icmsRate" inputmode="decimal" placeholder="18.0000"></label>
          <label class="field"><span>Redução de base ICMS (%)</span><input name="icmsReduction" inputmode="decimal" placeholder="40.0000"></label>
          <label class="field"><span>Alíquota PIS (%)</span><input name="pisRate" inputmode="decimal" placeholder="1.6500"></label>
          <label class="field"><span>Alíquota COFINS (%)</span><input name="cofinsRate" inputmode="decimal" placeholder="7.6000"></label>
          <label class="field"><span>Base de ST retido (centavos)</span><input name="stRetainedBaseCents" type="number" min="0" step="1"></label>
          <label class="field"><span>Valor ICMS-ST retido (centavos)</span><input name="stRetainedAmountCents" type="number" min="0" step="1"></label>
          <label class="field"><span>Base ST devido (centavos por operação)</span><input name="stDueBaseCents" type="number" min="0" step="1"></label>
          <label class="field"><span>Alíquota ST devido (%)</span><input name="stDueRate" inputmode="decimal"></label>
          <label class="field"><span>Valor ST devido (centavos por operação)</span><input name="stDueAmountCents" type="number" min="0" step="1"></label>
          <label class="field"><span>Crédito Simples (%)</span><input name="simpleCreditRate" inputmode="decimal"></label>
          <label class="field"><span>Valor crédito Simples (centavos)</span><input name="simpleCreditAmountCents" type="number" min="0" step="1"></label>
        </div>
      </details>
      <label class="field"><span>Responsável pela revisão</span><input name="reviewedBy" required maxlength="120"></label>
      <label class="field"><span>Data da revisão</span><input name="reviewedAt" type="date" required></label>
      <div class="modal-actions"><button class="primary-button" type="submit">Salvar perfil revisado</button></div>
    </form>
    <h3>3. Preparar documento da venda concluída</h3>
    <form data-acbr-draft class="field-grid">
      <label class="field wide"><span>Venda concluída</span><select name="saleId" required><option value="">Carregando vendas...</option></select></label>
      <label class="field"><span>Documento</span><select name="documentType"><option value="nfce">NFC-e — modelo 65</option><option value="nfe">NF-e — modelo 55</option></select></label>
      <div class="modal-actions"><button class="primary-button" type="submit">Preparar rascunho (não emitir)</button></div>
    </form>
    <form data-acbr-recipient class="field-grid" hidden>
      <h3 class="wide">Destinatário da NF-e (modelo 55)</h3>
      <label class="field"><span>CPF/CNPJ</span><input name="taxId" required maxlength="14"></label>
      <label class="field"><span>Nome/razão social</span><input name="name" required maxlength="60"></label>
      <label class="field"><span>Indicador de IE</span><select name="indIEDest"><option value="9">Não contribuinte</option><option value="1">Contribuinte</option><option value="2">Isento</option></select></label>
      <label class="field"><span>IE (quando aplicável)</span><input name="ie"></label>
      <label class="field"><span>Logradouro</span><input name="street" required></label>
      <label class="field"><span>Número</span><input name="streetNumber" required></label>
      <label class="field"><span>Bairro</span><input name="district" required></label>
      <label class="field"><span>Código IBGE município</span><input name="municipalityCode" required pattern="[0-9]{7}"></label>
      <label class="field"><span>Município</span><input name="municipalityName" required></label>
      <label class="field"><span>UF</span><input name="uf" required maxlength="2"></label>
      <label class="field"><span>CEP</span><input name="postalCode" required pattern="[0-9]{8}"></label>
    </form>
    <section data-acbr-inutilization hidden>
     <h3>4. Inutilização de números (somente homologação)</h3>
     <p class="ops-muted">Somente numerações reservadas e não utilizadas. Consulte a contabilidade. Um resultado indeterminado jamais pode ser reenviado sem conciliação na SEFAZ.</p>
     <form data-acbr-inutilization-form class="field-grid">
      <label class="field"><span>Modelo</span><select name="model"><option value="65">NFC-e (65)</option><option value="55">NF-e (55)</option></select></label>
      <label class="field"><span>Série</span><input name="series" type="number" min="1" max="999" value="1" required></label>
      <label class="field"><span>Ano</span><input name="year" type="number" min="2000" max="2099" required></label>
      <label class="field"><span>Primeiro número</span><input name="startNumber" type="number" min="1" max="999999999" required></label>
      <label class="field"><span>Último número</span><input name="endNumber" type="number" min="1" max="999999999" required></label>
      <label class="field wide"><span>Justificativa (15 a 255 caracteres)</span><textarea name="reason" minlength="15" maxlength="255" required></textarea></label>
      <div class="modal-actions"><button class="secondary-button" type="submit">Inutilizar faixa em homologação</button></div>
     </form><div data-acbr-inutilization-history role="status"></div>
    </section>
    <p data-fiscal-preview-status role="status" aria-live="polite"></p>
    <div data-acbr-documents class="ops-muted"></div>
   </div>`;
  return card;
 }
 function values(form){
  const out={};
  new FormData(form).forEach((v,k)=>out[k]=String(v).trim());
  return out;
 }
 async function fillSelect(select,fn,key,label){
  try{
   const list=await fn();
   if(!select.isConnected)return;
   select.replaceChildren();
   const choose=document.createElement('option');choose.value='';choose.textContent='Selecione';select.append(choose);
   for(const item of (Array.isArray(list)?list:[])){
    const option=document.createElement('option');option.value=String(item[key]||'');
    option.textContent=String(label(item));if(option.value)select.append(option);
   }
  }catch{if(select.isConnected)select.replaceChildren(new Option('Não foi possível carregar',''));}
 }
 async function refreshDocuments(card){
  const root=$(card,'[data-acbr-documents]');if(!root)return;
  try{
   const docs=await api.request(prefix+'/documents');
   if(!root.isConnected)return;
   root.replaceChildren();
   const title=document.createElement('strong');title.textContent='Rascunhos para revisão: '+docs.length;root.append(title);
   const list=document.createElement('ul');
   for(const d of docs.slice(0,20)){
    const li=document.createElement('li');
    li.textContent=`${d.documentType.toUpperCase()} ${d.series}/${d.number} — Venda ${d.snapshot.sale.saleNumber} — R$ ${(d.totalCents/100).toFixed(2)} — ${d.status}${d.issuanceMode==='nfce-offline'?(d.offlineStatus==='PENDING'?' — EMITIDA OFFLINE (fila pendente)':d.offlineStatus==='UNKNOWN'?' — TRANSMISSÃO INDETERMINADA (consultar SEFAZ)':d.offlineStatus==='AUTHORIZED'?' — CONTINGÊNCIA AUTORIZADA':d.offlineStatus==='REJECTED'?' — NFC-e OFFLINE REJEITADA: consultar contabilidade para regularização':' — CONTINGÊNCIA PREPARADA (não emitida nem autorizada)'):''}`;
    const endpoint=prefix+'/documents/'+encodeURIComponent(d.id);
    const addAction=(title,operation)=>{
      const button=document.createElement('button');button.type='button';button.className='secondary-button';button.textContent=title;
      li.append(' ',button);
      button.addEventListener('click',async()=>{
        button.disabled=true;
        try{
          let body={};
          if(operation==='compile'&&d.documentType==='nfe'){
            const form=$(card,'[data-acbr-recipient]');
            form.hidden=false;if(!form.reportValidity())throw Error('Informe o destinatário completo da NF-e');
            body={recipient:values(form)};
          }
          if(operation==='transmit'){
            const ux=window.ArtisysUxComponents;
            if(!ux?.openFormDialog)throw Error('Confirmação de emissão indisponível');
            const approval=await ux.openFormDialog({
              title:'Confirmar emissão em homologação',
              description:'Esta ação envia um documento real ao ambiente de testes da SEFAZ. Não gera nota de produção.',
              confirmLabel:'Enviar para homologação',
              cancelLabel:'Voltar',
              tone:'default',
              body:'<p>Confirme a emissão apenas após conferir emitente, tributação, valores e certificado.</p>'
            });
            if(!approval.confirmed)return;
          }
          const result=await api.request(endpoint+'/'+operation,{method:'POST',body});
          if(operation==='danfe'){
            if(!result.ready)throw Error('PDF DANFE indisponível');
            const save=window.artisysDesktop?.fiscal?.saveDanfe;
            if(!save)throw Error('Salvar DANFE exige PDV ArtiSys Desktop');
            const saved=await save(d.id,api.sessionToken);
            message(card,saved?.saved?'DANFE PDF autorizado salvo no computador.':
              'DANFE gerado e validado; salvamento cancelado.');
            return;
          }
          message(card,operation==='compile'?'INI gerado para revisão, nenhuma nota emitida.':
            result.status==='AUTHORIZED'?'Autorização SEFAZ confirmada.':
            result.status==='REJECTED'?'SEFAZ rejeitou a nota (cStat '+result.cStat+'): '+result.reason+'. Não reenviar automaticamente.':
            'Resultado pendente: consultar SEFAZ antes de qualquer reenvio.');
          await refreshDocuments(card);
        }catch(e){message(card,e.message||'Falha no processo fiscal',true);}
        finally{button.disabled=false;}
      });
    };
    if(d.status==='REVIEW_REQUIRED'&&fiscalStatus.iniPreparationEnabled)addAction('Gerar INI','compile');

    if(d.status==='REVIEW_REQUIRED'&&d.documentType==='nfce'&&fiscalStatus.emissionEnabled){
      const details=document.createElement('details');
      const summary=document.createElement('summary');summary.textContent='Preparar NFC-e de contingência (modo offline)';
      const form=document.createElement('form');form.className='field-grid';
      const label=document.createElement('label');label.className='field wide';
      const title=document.createElement('span');title.textContent='Justificativa da indisponibilidade da SEFAZ (mínimo 15 caracteres)';
      const reason=document.createElement('textarea');
      reason.minLength=15;reason.maxLength=256;reason.required=true;
      reason.setAttribute('data-acbr-offline-reason','');
      const warning=document.createElement('p');
      warning.textContent='A preparação offline não representa nota fiscal emitida nem autorizada. Não imprima DANFE fiscal; transmita e confira a autorização após reconexão.';
      const btn=document.createElement('button');btn.type='submit';btn.className='secondary-button';
      btn.textContent='Preparar documento para contingência';
      label.append(title,reason);form.append(label,warning,btn);
      details.append(summary,form);li.append(details);
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(!form.reportValidity())return;
        const ux=window.ArtisysUxComponents;
        if(!ux?.openFormDialog){message(card,'Confirmação de contingência indisponível',true);return;}
        const approval=await ux.openFormDialog({
          title:'Preparar NFC-e em contingência',
          description:'Somente para falha de comunicação comprovada com a SEFAZ. Este passo não emite nem autoriza a nota.',
          confirmLabel:'Confirmar preparação',cancelLabel:'Voltar',tone:'default',
          body:'<p>O documento manterá tpEmis=9 e só será transmitido manualmente após reconexão.</p>'
        });
        if(!approval.confirmed)return;
        btn.disabled=true;
        try{
          const result=await api.request(endpoint+'/compile',{method:'POST',
            body:{contingency:{reason:reason.value.trim()}}});
          message(card,result.issuanceMode==='nfce-offline'?
            'Contingência preparada; NFC-e não emitida, sem DANFE autorizado. Transmita após reconectar.':
            'Preparação fiscal não confirmou modo de contingência.',result.issuanceMode!=='nfce-offline');
          await refreshDocuments(card);
        }catch(err){message(card,err.message||'Falha ao preparar contingência',true);}
        finally{btn.disabled=false;}
      });
    }
    if(d.status==='READY'&&fiscalStatus.emissionEnabled&&d.issuanceMode!=='nfce-offline')addAction('Emitir em homologação','transmit');

    if(d.issuanceMode==='nfce-offline'&&fiscalStatus.emissionEnabled){
      const button=(text,onClick)=>{
        const control=document.createElement('button');
        control.type='button';control.className='secondary-button';control.textContent=text;
        li.append(' ',control);
        control.addEventListener('click',async()=>{
          control.disabled=true;
          try{await onClick();}catch(err){message(card,err.message||'Falha de contingência',true);}
          finally{control.disabled=false;}
        });
      };
      const savePdf=async()=>{
        const save=window.artisysDesktop?.fiscal?.saveOfflineDanfe;
        if(!save)throw Error('DANFE NFC-e offline exige aplicativo Windows no PC principal');
        const result=await save(d.id,api.sessionToken);
        message(card,result?.saved?'DANFE de contingência salvo. Imprima DUAS vias, uma para consumidor e uma para arquivo do estabelecimento.':
          'Salvamento cancelado.');
      };
      if(d.status==='READY'&&!d.offlineStatus){
        button('Emitir NFC-e OFFLINE e gerar DANFE de contingência',async()=>{
          const ux=window.ArtisysUxComponents;
          if(!ux?.openFormDialog)throw Error('Confirmação de emissão offline indisponível');
          const approval=await ux.openFormDialog({
            title:'Emitir NFC-e offline na homologação',
            description:'A emissão gera XML fiscal assinado, QR Code de contingência, DANFE e fila para envio após reconexão. A emissão local não significa autorização pela SEFAZ.',
            confirmLabel:'Assinar e emitir offline',cancelLabel:'Voltar',tone:'default',
            body:'<p>Confirme que a SEFAZ está indisponível. Depois imprima DUAS vias do DANFE e transmita a nota à SEFAZ após reconexão, dentro do prazo regulamentar.</p>'
          });
          if(!approval.confirmed)return;
          const result=await api.request(endpoint+'/offline-issue',{method:'POST',body:{}});
          if(result.status!=='ISSUED_OFFLINE')throw Error('Emissão offline não foi confirmada');
          message(card,'NFC-e assinada offline. Sem autorização SEFAZ; o XML está na fila. Salve e imprima o DANFE em duas vias.');
          await savePdf();
          await refreshDocuments(card);
        });
      }
      if(['PENDING','UNKNOWN','AUTHORIZED'].includes(d.offlineStatus))
        button('Salvar DANFE NFC-e de contingência',savePdf);
      if(d.offlineStatus==='PENDING'){
        button('Transmitir fila offline após reconexão',async()=>{
          const ux=window.ArtisysUxComponents;
          if(!ux?.openFormDialog)throw Error('Confirmação de envio indisponível');
          const approval=await ux.openFormDialog({
            title:'Transmitir NFC-e da fila à SEFAZ',
            description:'Cada nota assinada será transmitida uma única vez. Sem resposta oficial, o documento ficará indeterminado para consulta, sem reenvio automático.',
            confirmLabel:'Transmitir fila após reconexão',cancelLabel:'Voltar',tone:'default',
            body:'<p>Certifique-se de que o PC voltou a ter conexão e o certificado A1 está disponível.</p>'
          });
          if(!approval.confirmed)return;
          const result=await api.request(prefix+'/offline-queue/flush',{method:'POST',body:{limit:10}});
          const uncertain=result.filter(x=>x.status==='UNKNOWN');
          message(card,uncertain.length?'Há NFC-e indeterminada: CONSULTAR SEFAZ, nunca reenviar cegamente.':
            'Fila processada; verifique cada autorização e protocolo.',uncertain.length>0);
          await refreshDocuments(card);
        });
      }
    }
    if(d.status==='UNKNOWN'&&fiscalStatus.emissionEnabled)addAction('Consultar SEFAZ','consult');
    if(d.status==='AUTHORIZED'&&fiscalStatus.iniPreparationEnabled)addAction('Gerar e salvar DANFE PDF','danfe');
    if(d.status==='AUTHORIZED'&&fiscalStatus.emissionEnabled){
      const details=document.createElement('details');
      const summary=document.createElement('summary');summary.textContent='Solicitar cancelamento na SEFAZ de homologação';
      const form=document.createElement('form');form.className='field-grid';
      const label=document.createElement('label');label.className='field wide';
      const hint=document.createElement('span');hint.textContent='Justificativa (15 a 255 caracteres)';
      const field=document.createElement('textarea');field.setAttribute('data-acbr-cancel-reason','');
      field.minLength=15;field.maxLength=255;field.required=true;
      const submit=document.createElement('button');submit.type='submit';submit.className='secondary-button';
      submit.textContent='Confirmar cancelamento de teste';
      label.append(hint,field);form.append(label,submit);details.append(summary,form);li.append(details);
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(!form.reportValidity())return;
        const ux=window.ArtisysUxComponents;
        if(!ux?.openFormDialog){message(card,'Confirmação indisponível',true);return;}
        const approval=await ux.openFormDialog({title:'Cancelar nota em homologação',
          description:'Ação fiscal não pode ser repetida automaticamente se a SEFAZ não responder.',
          confirmLabel:'Confirmar cancelamento',cancelLabel:'Voltar',tone:'default',
          body:'<p>Confirme a autorização da nota e a justificativa aprovada pela contabilidade.</p>'});
        if(!approval.confirmed)return;
        submit.disabled=true;
        try{
          const result=await api.request(endpoint+'/cancel',{method:'POST',body:{reason:field.value.trim()}});
          message(card,result.status==='CANCELLED'?'Cancelamento confirmado pela SEFAZ de homologação.':
            'Cancelamento sem confirmação: consultar SEFAZ antes de nova operação.',result.status!=='CANCELLED');
          await refreshDocuments(card);
        }catch(error){message(card,error.message||'Não foi possível cancelar',true);}
        finally{submit.disabled=false;}
      });
    }

    if(d.status==='AUTHORIZED'&&d.documentType==='nfe'&&fiscalStatus.emissionEnabled){
      const details=document.createElement('details');
      const summary=document.createElement('summary');
      summary.textContent='Carta de Correção (CC-e) — NF-e 55';
      const form=document.createElement('form');form.className='field-grid';
      const textLabel=document.createElement('label');textLabel.className='field wide';
      const textHint=document.createElement('span');
      textHint.textContent='Texto da CC-e (15–1000 caracteres, sem mudar valores, imposto, quantidade, identidade ou datas)';
      const correction=document.createElement('textarea');correction.minLength=15;correction.maxLength=1000;correction.required=true;
      correction.setAttribute('data-acbr-cce-text','');
      textLabel.append(textHint,correction);
      const reviewerLabel=document.createElement('label');reviewerLabel.className='field wide';
      const reviewerText=document.createElement('span');reviewerText.textContent='Contador ou responsável pela revisão';
      const reviewer=document.createElement('input');reviewer.maxLength=120;reviewer.minLength=3;reviewer.required=true;
      reviewerLabel.append(reviewerText,reviewer);
      const ackLabel=document.createElement('label');ackLabel.className='field wide';
      const ack=document.createElement('input');ack.type='checkbox';ack.required=true;
      ackLabel.append(ack,' Contabilidade confirmou que a CC-e não altera imposto, valor, quantidade, emitente, destinatário ou data.');
      const previousLabel=document.createElement('label');previousLabel.className='field wide';
      const replacesPrevious=document.createElement('input');replacesPrevious.type='checkbox';
      previousLabel.append(replacesPrevious,' Se houver CC-e anterior, esta nova carta consolida e substitui todas as correções anteriores.');
      const submit=document.createElement('button');submit.className='secondary-button';submit.type='submit';
      submit.textContent='Enviar CC-e de homologação';
      form.append(textLabel,reviewerLabel,ackLabel,previousLabel,submit);
      details.append(summary,form);li.append(details);
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(!form.reportValidity())return;
        submit.disabled=true;
        try{
          const history=await api.request(endpoint+'/cce');
          const prior=history.at(-1);
          if(prior?.status==='UNKNOWN')throw Error('CC-e anterior sem resposta: consulte a SEFAZ, não reenvie');
          if(prior&&!replacesPrevious.checked)throw Error('Confirme que a nova CC-e substitui todas as anteriores');
          const sequence=(prior?.sequence||0)+1;
          if(sequence>20)throw Error('Limite de sequências CC-e atingido');
          const ux=window.ArtisysUxComponents;
          if(!ux?.openFormDialog)throw Error('Confirmação de CC-e indisponível');
          const approval=await ux.openFormDialog({
            title:'Enviar carta de correção em homologação',
            description:'A CC-e é evento fiscal e não pode modificar valores, impostos ou identidade das partes. Um timeout exige conciliação, não nova tentativa.',
            confirmLabel:'Transmitir CC-e',cancelLabel:'Voltar',tone:'default',
            body:'<p>O contador revisou a correção? O documento original continuará autorizado, com o evento vinculado.</p>'
          });
          if(!approval.confirmed)return;
          const result=await api.request(endpoint+'/cce',{method:'POST',body:{
            correction:correction.value.trim(),reviewedBy:reviewer.value.trim(),sequence,
            confirmNoMaterialChange:ack.checked,replacesPrevious:replacesPrevious.checked
          }});
          message(card,result.status==='CONFIRMED'?'CC-e registrada na SEFAZ de homologação, sequência '+sequence+'.':
            'CC-e indeterminada: consultar a SEFAZ antes de outra operação.',result.status!=='CONFIRMED');
        }catch(error){message(card,error.message||'CC-e não enviada',true);}
        finally{submit.disabled=false;}
      });
    }
    list.append(li);
   }
   root.append(list);
  }catch{message(card,'Falha ao consultar rascunhos fiscais.',true);}
 }
 function bind(card){
  const company=$(card,'[data-acbr-company]'),product=$(card,'[data-acbr-product]'),draft=$(card,'[data-acbr-draft]');
  const localFiscal=window.artisysDesktop?.fiscal;
  const localSection=$(card,'[data-acbr-local-cert]');
  const localState=$(card,'[data-acbr-cert-status]');
  const importForm=$(card,'[data-acbr-cert-form]');
  const enableButton=$(card,'[data-acbr-enable-homologation]');
  if(localFiscal?.status&&localFiscal?.importCertificate&&localFiscal?.enableHomologation){
    const refreshCertificate=async()=>{
      const state=await localFiscal.status();
      localSection.hidden=!state.available;
      if(!state.available)return;
      localState.textContent=!state.encryptionAvailable?
        'O armazenamento criptografado do Windows está indisponível. Não é possível importar o certificado.':
        state.homologationEnabled?'Homologação habilitada neste PC. Somente notas de teste.':
        state.configured?'Certificado A1 importado. Para liberar o teste, habilite homologação.':
        'Nenhum certificado A1 configurado neste PC.';
      enableButton.hidden=!state.configured||state.homologationEnabled||!state.encryptionAvailable;
    };
    importForm.addEventListener('submit',async e=>{
      e.preventDefault();
      const button=importForm.querySelector('button[type=submit]');button.disabled=true;
      try{
        const values=Object.fromEntries(new FormData(importForm).entries());
        const result=await localFiscal.importCertificate({...values,sessionToken:api.sessionToken});
        if(!result.cancelled){
          message(card,'Certificado importado no PC principal. Reinicie o PDV antes de habilitar o envio em homologação.');
          await refreshCertificate();
        }
      }catch(err){message(card,err.message||'Falha ao importar certificado',true);}
      finally{
        importForm.elements.password.value='';
        importForm.elements.csc.value='';
        button.disabled=false;
      }
    });
    enableButton.addEventListener('click',async()=>{
      enableButton.disabled=true;
      try{
        const result=await localFiscal.enableHomologation(api.sessionToken);
        message(card,result.restartRequired?'Homologação liberada localmente. Reinicie o PDV para ativar.':'Configuração salva.');
        await refreshCertificate();
      }catch(err){message(card,err.message||'Configuração fiscal incompleta',true);}
      finally{enableButton.disabled=false;}
    });
    void refreshCertificate().catch(()=>{localSection.hidden=true;});
  }
  product.elements.reviewedAt.value=new Date().toISOString().slice(0,10);
  const recipient=$(card,'[data-acbr-recipient]');
  const toggleRecipient=()=>{recipient.hidden=draft.elements.documentType.value!=='nfe';};
  draft.elements.documentType.addEventListener('change',toggleRecipient);toggleRecipient();
  const locked=async(form,fn)=>{
   const button=form.querySelector('button[type="submit"]');button.disabled=true;
   try{await fn();message(card,'Dados fiscais salvos para revisão. Nenhuma nota foi emitida.');}
   catch(e){message(card,e.message||'Não foi possível salvar',true);}
   finally{button.disabled=false;}
  };
  company.addEventListener('submit',event=>{event.preventDefault();void locked(company,async()=>{
    await api.request(prefix+'/company',{method:'PUT',body:{...values(company),environment:'homologation',series:Number(company.elements.series.value)}});
  });});
  product.addEventListener('submit',event=>{event.preventDefault();void locked(product,async()=>{
    const data=values(product);
    data.zeroLegacyTaxesConfirmed=product.elements.zeroLegacyTaxesConfirmed.checked;
    data.reformTax={ibsUfRate:data.ibsUfRate,ibsMunRate:data.ibsMunRate,cbsRate:data.cbsRate};
    const maybeInt=value=>value===''?null:Number(value);
    if(data.icmsBasePercent||data.icmsRate||data.icmsReduction)
      data.icms={basePercent:data.icmsBasePercent,rate:data.icmsRate,...(data.icmsReduction?{reduction:data.icmsReduction}:{})};
    if(data.pisRate)data.pis={rate:data.pisRate};
    if(data.cofinsRate)data.cofins={rate:data.cofinsRate};
    if(data.stRetainedBaseCents||data.stRetainedAmountCents)
      data.icmsRetained={baseCents:maybeInt(data.stRetainedBaseCents),amountCents:maybeInt(data.stRetainedAmountCents)};
    if(data.stDueBaseCents||data.stDueRate||data.stDueAmountCents)
      data.icmsSt={baseCents:maybeInt(data.stDueBaseCents),rate:data.stDueRate,amountCents:maybeInt(data.stDueAmountCents)};
    if(data.simpleCreditRate||data.simpleCreditAmountCents)
      data.simpleCredit={rate:data.simpleCreditRate,amountCents:maybeInt(data.simpleCreditAmountCents)};
    for(const key of ['ibsUfRate','ibsMunRate','cbsRate','icmsBasePercent','icmsRate','icmsReduction',
      'pisRate','cofinsRate','stRetainedBaseCents','stRetainedAmountCents','stDueBaseCents',
      'stDueRate','stDueAmountCents','simpleCreditRate','simpleCreditAmountCents'])delete data[key];
    await api.request(prefix+'/products/'+encodeURIComponent(data.productId),{method:'PUT',body:data});
  });});
  draft.addEventListener('submit',event=>{event.preventDefault();void locked(draft,async()=>{
    const data=values(draft);
    await api.request(prefix+'/sales/'+encodeURIComponent(data.saleId)+'/prepare',{method:'POST',body:{documentType:data.documentType}});
    await refreshDocuments(card);
  });});
  const inutPanel=$(card,'[data-acbr-inutilization]');
  const inutForm=$(card,'[data-acbr-inutilization-form]');
  inutPanel.hidden=!fiscalStatus.emissionEnabled;
  inutForm.elements.year.value=String(new Date().getFullYear());
  inutForm.elements.series.value=company.elements.series.value||'1';
  company.elements.series.addEventListener('change',()=>{inutForm.elements.series.value=company.elements.series.value;});
  inutForm.addEventListener('submit',async event=>{
   event.preventDefault();if(!fiscalStatus.emissionEnabled||!inutForm.reportValidity())return;
   const ux=window.ArtisysUxComponents;
   if(!ux?.openFormDialog){message(card,'Confirmação indisponível',true);return;}
   const approval=await ux.openFormDialog({title:'Inutilização em homologação',
    description:'Use somente intervalos reservados sem nota emitida, confirmados pela contabilidade.',
    confirmLabel:'Confirmar inutilização',cancelLabel:'Voltar',tone:'default',
    body:'<p>Resultado indeterminado exige consulta à SEFAZ antes de repetir.</p>'});
   if(!approval.confirmed)return;
   const body=values(inutForm);
   for(const k of ['model','series','year','startNumber','endNumber'])body[k]=Number(body[k]);
   const submit=inutForm.querySelector('button[type="submit"]');submit.disabled=true;
   try{
    const result=await api.request(prefix+'/inutilizations',{method:'POST',body});
    message(card,result.status==='CONFIRMED'?'Faixa inutilizada em homologação, protocolo confirmado.':
      'Inutilização indeterminada: consulte a SEFAZ antes de nova tentativa.',result.status!=='CONFIRMED');
    const history=await api.request(prefix+'/inutilizations');
    const target=$(card,'[data-acbr-inutilization-history]');
    if(target)target.textContent='Faixas registradas: '+history.length+'; último estado: '+(history[0]?.status||'nenhum');
   }catch(err){message(card,err.message||'Falha na inutilização',true);}
   finally{submit.disabled=false;}
  });
  void api.request(prefix+'/company').then(cfg=>{
   if(!cfg||!card.isConnected)return;
   for(const [key,value] of Object.entries(cfg)){if(company.elements.namedItem(key))company.elements.namedItem(key).value=String(value);}
  }).catch(()=>{});
  void fillSelect(product.elements.productId,()=>api.products(), 'id',p=>p.name||p.sku||p.id);
  void fillSelect(draft.elements.saleId,()=>api.salesHistory({status:'COMPLETED',limit:50}),'id',s=>`${s.saleNumber} · R$ ${(s.totalCents/100).toFixed(2)}`);
  void refreshDocuments(card);
  product.elements.productId.addEventListener('change',()=>{
   const id=product.elements.productId.value;if(!id)return;
   void api.request(prefix+'/products/'+encodeURIComponent(id)).then(data=>{
    if(!product.isConnected||product.elements.productId.value!==id)return;
    for(const [key,value] of Object.entries(data)){
     if(key==='zeroLegacyTaxesConfirmed')product.elements.zeroLegacyTaxesConfirmed.checked=value===true;
     else if(key==='reformTax'&&value){for(const name of ['ibsUfRate','ibsMunRate','cbsRate'])if(value[name]!=null)product.elements[name].value=value[name];}
     else if(key==='icms'&&value){product.elements.icmsBasePercent.value=value.basePercent||'';product.elements.icmsRate.value=value.rate||'';product.elements.icmsReduction.value=value.reduction||'';}
     else if(key==='pis'&&value){product.elements.pisRate.value=value.rate||'';}
     else if(key==='cofins'&&value){product.elements.cofinsRate.value=value.rate||'';}
     else if(key==='icmsRetained'&&value){product.elements.stRetainedBaseCents.value=value.baseCents??'';product.elements.stRetainedAmountCents.value=value.amountCents??'';}
     else if(key==='icmsSt'&&value){product.elements.stDueBaseCents.value=value.baseCents??'';product.elements.stDueRate.value=value.rate||'';product.elements.stDueAmountCents.value=value.amountCents??'';}
     else if(key==='simpleCredit'&&value){product.elements.simpleCreditRate.value=value.rate||'';product.elements.simpleCreditAmountCents.value=value.amountCents??'';}
     else if(key!=='productId'&&product.elements.namedItem(key))product.elements.namedItem(key).value=value||'';
    }
   }).catch(()=>{});
  });
 }
 async function mount(){
  if(pending||lifecycle.activeRoute!=='settings')return;
  const content=document.getElementById('route-content');
  const page=content?.querySelector('.ops-page');
  if(!page||page.querySelector('.ops-head h1')?.textContent?.trim()!=='Configurações')return;
  if(page.querySelector('#settings-acbrlib-preview'))return;
  if(!window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,'settings.manage'))return;
  pending=true;
  try{
   const status=await api.request(prefix+'/status');
   if(!status?.reviewOnly||lifecycle.activeRoute!=='settings'||!page.isConnected)return;
   fiscalStatus=status;
   const card=buildCard();page.append(card);bind(card);
   window.PdvSettingsHub?.mount(page);
  }catch{/* Default commercial V1: no fiscal preview endpoint and no fiscal UI. */}
  finally{pending=false;}
 }
 lifecycle.on('route:updated',({route})=>{if(route==='settings')void mount();});
})();
