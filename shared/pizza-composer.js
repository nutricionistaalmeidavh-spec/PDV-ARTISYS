'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PdvPizzaComposer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

  function isPizzaProfile(profile){return Boolean(profile&&Array.isArray(profile.sizes)&&profile.sizes.length&&Array.isArray(profile.flavors)&&profile.flavors.length);}
  function normalizeSelection(input={}){return{
    sizeId:String(input.sizeId||''),
    flavorIds:[...new Set((Array.isArray(input.flavorIds)?input.flavorIds:[]).map(String).filter(Boolean))],
    crustId:String(input.crustId||'')||null
  };}
  function sizeFor(profile,sizeId){return(profile?.sizes||[]).find(row=>String(row.id)===String(sizeId))||null;}
  function validate(profile,input={}){
    if(!isPizzaProfile(profile))return'';
    const selection=normalizeSelection(input),size=sizeFor(profile,selection.sizeId);
    if(!size)return'Selecione o tamanho da pizza.';
    if(!selection.flavorIds.length)return'Selecione ao menos um sabor.';
    const max=Math.max(1,Number(size.maxFlavors||1));
    if(selection.flavorIds.length>max)return`Este tamanho permite no máximo ${max} sabor${max===1?'':'es'}.`;
    const allowed=new Set((profile.flavors||[]).map(row=>String(row.id)));
    if(selection.flavorIds.some(id=>!allowed.has(id)))return'Selecione somente sabores disponíveis.';
    if(selection.crustId&&!profile.crusts?.some(row=>String(row.id)===selection.crustId))return'Selecione uma borda disponível.';
    return'';
  }
  function render(profile,{namePrefix='pizza'}={}){
    if(!isPizzaProfile(profile))return'';
    const sizeOptions=(profile.sizes||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.name)}${Number(row.priceDeltaCents||0)?` · +${money(row.priceDeltaCents)}`:''}</option>`).join('');
    const flavorChoices=(profile.flavors||[]).map(row=>`<label class="pizza-choice"><input data-pizza-flavor type="checkbox" name="${esc(namePrefix)}FlavorId" value="${esc(row.id)}"><span>${esc(row.name)}</span><small>${Number(row.priceDeltaCents||0)?`+${money(row.priceDeltaCents)}`:'Incluso'}</small></label>`).join('');
    const crustOptions=(profile.crusts||[]).map(row=>`<option value="${esc(row.id)}">${esc(row.name)}${Number(row.priceDeltaCents||0)?` · +${money(row.priceDeltaCents)}`:''}</option>`).join('');
    return`<section class="pizza-composer" data-pizza-composer>
      <div class="pizza-composer-head"><strong>Monte sua pizza</strong><small>Tamanho → sabores → borda</small></div>
      <label class="field pizza-size-field"><span>Tamanho</span><select data-pizza-size name="${esc(namePrefix)}SizeId" required><option value="">Selecione o tamanho</option>${sizeOptions}</select></label>
      <fieldset class="pizza-flavors" data-pizza-flavors><legend>Sabores</legend><small data-pizza-flavor-help>Escolha o tamanho para ver quantos sabores são permitidos.</small>${flavorChoices}</fieldset>
      <label class="field pizza-crust-field"><span>Borda</span><select data-pizza-crust name="${esc(namePrefix)}CrustId"><option value="">Sem borda</option>${crustOptions}</select></label>
      <div class="inline-error hidden" data-pizza-error role="alert"></div>
    </section>`;
  }
  function read(form,{namePrefix='pizza'}={}){
    if(!form)return normalizeSelection();
    const fd=new FormData(form);
    return normalizeSelection({
      sizeId:fd.get(`${namePrefix}SizeId`),
      flavorIds:[...form.querySelectorAll('[data-pizza-flavor]:checked')].map(input=>input.value),
      crustId:fd.get(`${namePrefix}CrustId`)
    });
  }
  function updateFlavorLimit(form,profile){
    const sizeSelect=form?.querySelector('[data-pizza-size]'),host=form?.querySelector('[data-pizza-flavors]'),help=form?.querySelector('[data-pizza-flavor-help]');
    if(!sizeSelect||!host)return;
    const size=sizeFor(profile,sizeSelect.value),max=Math.max(1,Number(size?.maxFlavors||1));
    const checked=[...host.querySelectorAll('[data-pizza-flavor]:checked')];
    if(checked.length>max)checked.slice(max).forEach(input=>{input.checked=false;});
    host.querySelectorAll('[data-pizza-flavor]').forEach(input=>{input.disabled=Boolean(size)&&!input.checked&&host.querySelectorAll('[data-pizza-flavor]:checked').length>=max;});
    if(help)help.textContent=size?`Escolha até ${max} sabor${max===1?'':'es'} para ${size.name}.`:'Escolha o tamanho para definir o limite de sabores.';
  }
  function bind(form,profile,{onChange=null}={}){
    if(!form||!isPizzaProfile(profile))return()=>{};
    const update=()=>{updateFlavorLimit(form,profile);if(typeof onChange==='function')onChange(read(form));};
    form.querySelector('[data-pizza-size]')?.addEventListener('change',update);
    form.querySelector('[data-pizza-crust]')?.addEventListener('change',update);
    form.querySelectorAll('[data-pizza-flavor]').forEach(input=>input.addEventListener('change',update));
    update();
    return update;
  }
  function fractionLabel(fraction){
    const value=Number(fraction||0);
    if(Math.abs(value-0.5)<0.0001)return'½';
    if(Math.abs(value-(1/3))<0.0001)return'⅓';
    if(Math.abs(value-0.25)<0.0001)return'¼';
    return value>=0.999?'':`${Math.round(value*100)}%`;
  }
  function formatPizza(configuration){
    const pizza=configuration?.pizza||configuration;if(!pizza?.size)return'';
    const flavors=(pizza.flavors||[]).map(row=>`${fractionLabel(row.fraction)}${fractionLabel(row.fraction)?' ':''}${row.name}`).join(' + ');
    return [pizza.size.name,flavors,pizza.crust?.name?`Borda ${pizza.crust.name}`:null].filter(Boolean).join(' · ');
  }
  function summaryFromSelection(profile,input={}){
    const selection=normalizeSelection(input),size=sizeFor(profile,selection.sizeId);
    if(!size)return'';
    const flavorMap=new Map((profile.flavors||[]).map(row=>[String(row.id),row]));
    const flavors=selection.flavorIds.map(id=>flavorMap.get(String(id))).filter(Boolean);
    const fraction=flavors.length?1/flavors.length:1;
    const crust=(profile.crusts||[]).find(row=>String(row.id)===String(selection.crustId||''))||null;
    return formatPizza({size,flavors:flavors.map(row=>({...row,fraction})),crust});
  }

  return{isPizzaProfile,normalizeSelection,validate,render,read,bind,formatPizza,summaryFromSelection,clone};
});
