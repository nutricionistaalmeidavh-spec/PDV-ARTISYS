'use strict';

(() => {
  const root=window;
  const { ApiClient }=root.PdvApiClient||{};
  if(typeof ApiClient!=='function')return;
  const api=new ApiClient();
  const content=document.getElementById('route-content');
  const toastRoot=document.getElementById('toast-root');
  const SUPPORTED_IMAGE_TYPES=new Set(['image/png','image/jpeg','image/webp']);
  const MAX_SOURCE_BYTES=4*1024*1024;
  const MAX_LOGO_DATA_LENGTH=699000;
  let pendingLogoDataUrl=null;
  let removeLogo=false;
  let mounting=false;

  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);}
  function showToast(message,type=''){if(!toastRoot)return;const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;toastRoot.appendChild(node);setTimeout(()=>node.remove(),3500);}
  function safeLogoDataUrl(value){const text=String(value??'').trim();return text.length<=MAX_LOGO_DATA_LENGTH&&/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/i.test(text)?text:null;}
  function settingsMap(rows){return Object.fromEntries((rows||[]).map(row=>[row.key,row.value]));}
  async function saveOrRemove(key,value){const text=String(value??'').trim();return text?api.saveSetting(key,text,'global'):api.removeSetting(key,'global');}

  function fileToPngDataUrl(file){
    return new Promise((resolve,reject)=>{
      if(!file||!SUPPORTED_IMAGE_TYPES.has(file.type)){reject(new Error('Use uma imagem PNG, JPG/JPEG ou WebP.'));return;}
      if(file.size>MAX_SOURCE_BYTES){reject(new Error('A logo deve ter no máximo 4 MB antes da otimização.'));return;}
      const reader=new FileReader();
      reader.onerror=()=>reject(new Error('Não foi possível ler a logo.'));
      reader.onload=()=>{
        const image=new Image();
        image.onerror=()=>reject(new Error('Arquivo de imagem inválido.'));
        image.onload=()=>{
          const scale=Math.min(1,512/image.naturalWidth,180/image.naturalHeight);
          const canvas=document.createElement('canvas');
          canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));
          canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
          const context=canvas.getContext('2d');
          if(!context){reject(new Error('Não foi possível preparar a logo.'));return;}
          context.clearRect(0,0,canvas.width,canvas.height);
          context.drawImage(image,0,0,canvas.width,canvas.height);
          const dataUrl=canvas.toDataURL('image/png');
          if(!safeLogoDataUrl(dataUrl)||dataUrl.length>MAX_LOGO_DATA_LENGTH){reject(new Error('A logo otimizada ficou grande demais. Use uma imagem mais simples.'));return;}
          resolve(dataUrl);
        };
        image.src=String(reader.result||'');
      };
      reader.readAsDataURL(file);
    });
  }

  function previewMarkup(dataUrl){
    const safe=safeLogoDataUrl(dataUrl);
    return safe
      ? `<div style="display:flex;align-items:center;justify-content:center;min-height:110px;padding:12px;border:1px dashed var(--border,#d8dee8);border-radius:10px;background:#fff"><img src="${escapeHtml(safe)}" alt="Prévia da logo" style="display:block;max-width:260px;max-height:100px;object-fit:contain"></div>`
      : '<div class="ops-empty">Nenhuma logo configurada. O cupom continua funcionando apenas com texto.</div>';
  }

  async function mount(){
    if(mounting||!content)return;
    const page=content.querySelector('.ops-page');
    if(!page||page.dataset.storeBrandingMounted==='true')return;
    const heading=page.querySelector('.ops-head h1');
    if(!heading||heading.textContent.trim()!=='Configurações')return;
    mounting=true;
    try{
      const [rows,cfg]=await Promise.all([api.settings({scope:'global',prefix:'store.'}),api.initialize().catch(()=>null)]);
      if(!page.isConnected||page.dataset.storeBrandingMounted==='true')return;
      const values=settingsMap(rows);
      const currentLogo=safeLogoDataUrl(values['store.logoDataUrl']);
      pendingLogoDataUrl=currentLogo;
      removeLogo=false;
      const card=document.createElement('section');
      card.className='ops-card';
      card.id='ops-store-receipt-card';
      card.innerHTML=`<div class="ops-card-head"><div><h2>Dados da loja e cupom não fiscal</h2><p class="ops-muted">Nome, endereço, telefone e logo são salvos localmente e usados nos próximos cupons. A logo é convertida para PNG no próprio computador.</p></div></div><form id="ops-store-receipt-form" class="ops-form"><label>Nome da loja/empresa<input name="storeName" class="ops-input" maxlength="80" value="${escapeHtml(values['store.name']||cfg?.storeName||'')}" placeholder="Ex.: Mercado Central"></label><label>Endereço<input name="address" class="ops-input" maxlength="160" value="${escapeHtml(values['store.address']||'')}" placeholder="Rua, número, bairro, cidade"></label><label>Telefone<input name="phone" class="ops-input" maxlength="60" value="${escapeHtml(values['store.phone']||'')}" placeholder="(00) 00000-0000"></label><label>Logo da empresa<input id="ops-store-logo" class="ops-input" type="file" accept="image/png,image/jpeg,image/webp"></label><div id="ops-store-logo-preview">${previewMarkup(currentLogo)}</div><div class="ops-actions"><button class="ops-primary" type="submit">Salvar dados da loja</button><button id="ops-store-logo-remove" class="ops-secondary" type="button" ${currentLogo?'':'disabled'}>Remover logo</button></div><p class="ops-muted">Sem serviço externo e sem custo adicional. Se algum campo ficar vazio, ele não aparece no cupom.</p></form>`;
      const firstGrid=page.querySelector('.ops-grid');
      if(firstGrid)page.insertBefore(card,firstGrid);else page.appendChild(card);
      page.dataset.storeBrandingMounted='true';

      const fileInput=card.querySelector('#ops-store-logo');
      const preview=card.querySelector('#ops-store-logo-preview');
      const removeButton=card.querySelector('#ops-store-logo-remove');
      fileInput?.addEventListener('change',async event=>{
        const file=event.target.files?.[0];if(!file)return;
        try{pendingLogoDataUrl=await fileToPngDataUrl(file);removeLogo=false;if(preview)preview.innerHTML=previewMarkup(pendingLogoDataUrl);if(removeButton)removeButton.disabled=false;showToast('Logo preparada. Clique em salvar para aplicar.','success');}
        catch(error){event.target.value='';showToast(error.message,'error');}
      });
      removeButton?.addEventListener('click',()=>{pendingLogoDataUrl=null;removeLogo=true;if(fileInput)fileInput.value='';if(preview)preview.innerHTML=previewMarkup(null);removeButton.disabled=true;});
      card.querySelector('#ops-store-receipt-form')?.addEventListener('submit',async event=>{
        event.preventDefault();const form=new FormData(event.currentTarget);
        const name=String(form.get('storeName')||'').trim();const address=String(form.get('address')||'').trim();const phone=String(form.get('phone')||'').trim();
        try{
          await saveOrRemove('store.name',name);
          await saveOrRemove('store.address',address);
          await saveOrRemove('store.phone',phone);
          if(removeLogo)await api.removeSetting('store.logoDataUrl','global');
          else if(pendingLogoDataUrl)await api.saveSetting('store.logoDataUrl',pendingLogoDataUrl,'global');
          const topbarName=document.getElementById('store-name');if(topbarName)topbarName.textContent=name||cfg?.storeName||'Loja Matriz';
          showToast('Dados da loja salvos para os próximos cupons.','success');
        }catch(error){showToast(error.message,'error');}
      });
    }catch(error){showToast(`Não foi possível carregar os dados do cupom: ${error.message}`,'error');}
    finally{mounting=false;}
  }

  const observer=new MutationObserver(()=>{void mount();});
  if(content)observer.observe(content,{childList:true,subtree:true});
  void mount();
})();
