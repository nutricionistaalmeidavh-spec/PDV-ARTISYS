'use strict';
// Developer-only fiscal preview surface. The backend must explicitly opt in.
// Never transmits, authorizes, cancels or prints a fiscal document.
(() => {
 const lifecycle=window.PdvUiLifecycle,ApiClient=window.PdvApiClient?.ApiClient;
 if(!lifecycle||!ApiClient)return;
 const api=new ApiClient();
 let pending=false;
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
   <div class="ops-card-head"><div><h2>Fiscal — laboratório ACBrLib</h2>
    <p class="ops-muted">Somente preparação de rascunhos. NFC-e/NF-e sem emissão, envio à SEFAZ ou DANFE fiscal. Requer revisão contábil.</p>
   </div></div>
   <div class="ops-card-body">
    <h3>1. Dados do estabelecimento</h3>
    <form data-acbr-company class="field-grid">
      <label class="field"><span>Razão social</span><input name="name" required maxlength="160"></label>
      <label class="field"><span>CNPJ</span><input name="cnpj" required maxlength="14" minlength="14"></label>
      <label class="field"><span>Inscrição estadual</span><input name="stateRegistration" required maxlength="32"></label>
      <label class="field"><span>UF</span><input name="uf" required maxlength="2" minlength="2" value="SP"></label>
      <label class="field"><span>CRT</span><select name="crt"><option value="1">1 — Simples Nacional</option><option value="2">2 — Simples excesso sublimite</option><option value="3">3 — Regime normal</option><option value="4">4 — MEI</option></select></label>
      <label class="field"><span>Série</span><input name="series" type="number" required min="1" max="999" value="1"></label>
      <p class="ops-muted wide">Ambiente: homologação. Emissão automática e produção permanecem bloqueadas.</p>
      <div class="modal-actions"><button class="primary-button" type="submit">Salvar dados para revisão</button></div>
    </form>
    <h3>2. Perfil tributário por produto</h3>
    <form data-acbr-product class="field-grid">
      <label class="field wide"><span>Produto</span><select name="productId" required><option value="">Carregando produtos...</option></select></label>
      <label class="field"><span>NCM</span><input name="ncm" required minlength="8" maxlength="8"></label>
      <label class="field"><span>CEST (quando aplicável)</span><input name="cest" maxlength="7"></label>
      <label class="field"><span>CFOP</span><input name="cfop" required minlength="4" maxlength="4"></label>
      <label class="field"><span>Origem (0–8)</span><input name="origin" required maxlength="1" value="0"></label>
      <label class="field"><span>CST (regime normal)</span><input name="cst" maxlength="2"></label>
      <label class="field"><span>CSOSN (Simples)</span><input name="csosn" maxlength="3"></label>
      <label class="field"><span>CST PIS</span><input name="pisCst" maxlength="2" required></label>
      <label class="field"><span>CST COFINS</span><input name="cofinsCst" maxlength="2" required></label>
      <label class="field"><span>Unidade</span><input name="unit" maxlength="8" required value="UN"></label>
      <label class="field"><span>CST IBS/CBS (se aplicável)</span><input name="ibsCbsCst" maxlength="3"></label>
      <label class="field"><span>cClassTrib (se aplicável)</span><input name="cClassTrib" maxlength="6"></label>
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
    list.append(li);
   }
   root.append(list);
  }catch{message(card,'Falha ao consultar rascunhos fiscais.',true);}
 }
 function bind(card){
  const company=$(card,'[data-acbr-company]'),product=$(card,'[data-acbr-product]'),draft=$(card,'[data-acbr-draft]');
  product.elements.reviewedAt.value=new Date().toISOString().slice(0,10);
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
    for(const [key,value] of Object.entries(data)){if(key!=='productId'&&product.elements.namedItem(key))product.elements.namedItem(key).value=value||'';}
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
   if(!status?.reviewOnly||status.emissionEnabled||lifecycle.activeRoute!=='settings'||!page.isConnected)return;
   const card=buildCard();page.append(card);bind(card);
   window.PdvSettingsHub?.mount(page);
  }catch{/* Default commercial V1: no fiscal preview endpoint and no fiscal UI. */}
  finally{pending=false;}
 }
 lifecycle.on('route:updated',({route})=>{if(route==='settings')void mount();});
})();
