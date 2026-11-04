'use strict';
// Developer-only fiscal preview surface. The backend must explicitly opt in.
// Never transmits, authorizes, cancels or prints a fiscal document.
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
    <p class="ops-muted">Somente preparação de rascunhos. NFC-e/NF-e sem emissão, envio à SEFAZ ou DANFE fiscal. Requer revisão contábil.</p>
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
    li.textContent=`${d.documentType.toUpperCase()} ${d.series}/${d.number} — Venda ${d.snapshot.sale.saleNumber} — R$ ${(d.totalCents/100).toFixed(2)} — ${d.status}`;
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
    if(d.status==='READY'&&fiscalStatus.emissionEnabled)addAction('Emitir em homologação','transmit');
    if(d.status==='UNKNOWN'&&fiscalStatus.emissionEnabled)addAction('Consultar SEFAZ','consult');
    list.append(li);
   }
   root.append(list);
  }catch{message(card,'Falha ao consultar rascunhos fiscais.',true);}
 }
 function bind(card){
  const company=$(card,'[data-acbr-company]'),product=$(card,'[data-acbr-product]'),draft=$(card,'[data-acbr-draft]');
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
