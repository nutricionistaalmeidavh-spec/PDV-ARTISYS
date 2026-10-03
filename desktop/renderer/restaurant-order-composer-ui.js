'use strict';

(()=>{
  const root=window;
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const hasConfiguration=config=>Boolean(config?.variants?.length||config?.groups?.length||config?.combos?.length);

  async function configure({api,modalRoot,product,quantity=1,note='',onAdd}={}){
    if(!api||!modalRoot||!product||typeof onAdd!=='function')throw new TypeError('Configuração do compositor inválida.');
    const config=await api.productConfiguration(product.id).catch(()=>({variants:[],groups:[],combos:[]}));
    if(!hasConfiguration(config)){
      onAdd({productId:product.id,name:product.name,unitPriceCents:Number(product.salePriceCents||0),quantity,note,configuration:{variantId:null,selections:[],comboSelections:[]}});
      return;
    }
    const variants=(config.variants||[]).map(variant=>`<label class="restaurant-config-choice"><input type="radio" name="variantId" value="${esc(variant.id)}"><span>${esc(variant.name)}</span><small>${variant.priceDeltaCents?money(variant.priceDeltaCents):'Incluso'}</small></label>`).join('');
    const groups=(config.groups||[]).map(group=>{
      const type=group.selectionType==='SINGLE'?'radio':'checkbox';
      const min=Math.max(Number(group.minSelections||0),group.required?1:0),max=Number(group.maxSelections||1);
      return `<fieldset data-config-group data-min="${min}" data-max="${max}"><legend>${esc(group.name)}</legend><small>Escolha entre ${min} e ${max}.</small>${(group.options||[]).map(option=>`<label class="restaurant-config-choice"><input data-option type="${type}" name="group-${esc(group.id)}" value="${esc(option.id)}"><span>${esc(option.name)}</span><small>${option.priceDeltaCents?money(option.priceDeltaCents):'Incluso'}</small></label>`).join('')}</fieldset>`;
    }).join('');
    const combos=(config.combos||[]).map(group=>`<fieldset data-combo-group data-min="${Number(group.minSelections||0)}" data-max="${Number(group.maxSelections||1)}"><legend>${esc(group.name)}</legend><small>Escolha entre ${Number(group.minSelections||0)} e ${Number(group.maxSelections||1)}.</small>${(group.items||[]).map(item=>`<label class="restaurant-config-choice"><input data-combo type="checkbox" data-group-id="${esc(group.id)}" data-product-id="${esc(item.productId)}"><span>${esc(item.productName)}</span><small>${item.priceDeltaCents?money(item.priceDeltaCents):'Incluso'}</small></label>`).join('')}</fieldset>`).join('');
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML=`<section class="modal-card restaurant-config-modal" role="dialog" aria-modal="true" aria-labelledby="restaurant-config-title"><header class="modal-head"><div><h2 id="restaurant-config-title">${esc(product.name)}</h2><p>Personalize o item antes de adicionar ao pedido.</p></div><button class="modal-close" type="button" data-config-close aria-label="Fechar">×</button></header><div class="modal-body"><form id="restaurant-config-product-form" class="restaurant-form">${variants?`<fieldset><legend>Variação</legend>${variants}</fieldset>`:''}${groups}${combos}<label>Observação<textarea name="note" maxlength="500">${esc(note)}</textarea></label><div class="ops-error hidden" data-config-error role="alert"></div><div class="restaurant-actions"><button type="button" class="restaurant-btn secondary" data-config-close>Cancelar</button><button class="restaurant-btn" type="submit">Adicionar ao pedido</button></div></form></div></section>`;
    const close=()=>{modalRoot.classList.add('hidden');modalRoot.innerHTML='';};
    modalRoot.querySelectorAll('[data-config-close]').forEach(button=>button.addEventListener('click',close));
    modalRoot.querySelector('#restaurant-config-product-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget;const errorNode=form.querySelector('[data-config-error]');
      for(const group of form.querySelectorAll('[data-config-group],[data-combo-group]')){
        const selector=group.hasAttribute('data-config-group')?'[data-option]:checked':'[data-combo]:checked';
        const count=group.querySelectorAll(selector).length,min=Number(group.dataset.min||0),max=Number(group.dataset.max||1);
        if(count<min||count>max){errorNode.textContent=`Selecione entre ${min} e ${max} opção(ões) em ${group.querySelector('legend')?.textContent||'este grupo'}.`;errorNode.classList.remove('hidden');return;}
      }
      const fd=new FormData(form);const variantId=String(fd.get('variantId')||'')||null;
      const selections=[...form.querySelectorAll('[data-option]:checked')].map(input=>input.value);
      const comboSelections=[...form.querySelectorAll('[data-combo]:checked')].map(input=>({groupId:input.dataset.groupId,productId:input.dataset.productId}));
      try{
        const priced=await api.priceConfiguredItem({productId:product.id,variantId:variantId||undefined,selections,comboSelections});
        onAdd({productId:product.id,name:product.name,unitPriceCents:priced.unitPriceCents,quantity,note:String(fd.get('note')||''),configuration:{variantId,selections,comboSelections}});
        close();
      }catch(error){errorNode.textContent=error.message;errorNode.classList.remove('hidden');}
    });
  }

  root.PdvRestaurantOrderComposerUi=Object.freeze({configure});
})();
