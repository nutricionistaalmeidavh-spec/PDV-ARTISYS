'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PdvOrderComposer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const normalizedConfiguration=input=>({
    variantId:input?.variantId||null,
    selections:Array.isArray(input?.selections)?[...input.selections]:[],
    comboSelections:Array.isArray(input?.comboSelections)?clone(input.comboSelections):[]
  });
  const signature=line=>JSON.stringify({
    productId:line.productId,
    note:line.note||'',
    configuration:line.configuration
  });
  const selectedIds=values=>new Set((values||[]).map(value=>String(value?.optionId||value)));
  function limitsForGroup(configuration,group,selections=[]){
    const min=Math.max(Number(group?.minSelections||0),group?.required?1:0);
    let max=Number(group?.maxSelections??1);
    const limit=group?.selectionLimit;
    if(limit?.sourceGroupId&&limit?.maxByOptionId){
      const selected=selectedIds(selections);
      const source=(configuration?.groups||[]).find(row=>String(row.id)===String(limit.sourceGroupId));
      const sourceOption=(source?.options||[]).find(option=>selected.has(String(option.id)));
      const dependent=sourceOption?Number(limit.maxByOptionId[String(sourceOption.id)]):NaN;
      if(Number.isFinite(dependent)&&dependent>=0)max=dependent;
    }
    return{min,max};
  }
  function validateConfiguration(configuration=null,{variantId=null,selections=[],comboSelections=[]}={}){
    const config=configuration||{};
    const selected=selectedIds(selections);
    for(const group of config.groups||[]){
      const count=(group.options||[]).filter(option=>selected.has(String(option.id))).length;
      const {min,max}=limitsForGroup(config,group,selections);
      if(group.selectionType==='SINGLE'&&count>1)return `${group.name||'Opções'}: escolha somente uma opção.`;
      if(count<min||count>max)return `${group.name||'Opções'}: escolha entre ${min} e ${max}.`;
    }
    for(const group of config.combos||[]){
      const count=(comboSelections||[]).filter(item=>String(item.groupId)===String(group.id)).length;
      const min=Number(group.minSelections||0),max=Number(group.maxSelections||1);
      if(count<min||count>max)return `${group.name||'Combo'}: escolha entre ${min} e ${max}.`;
    }
    return'';
  }
  function fractionLabel(value){
    const number=Number(value);
    if(Math.abs(number-0.5)<1e-6)return'½';
    if(Math.abs(number-(1/3))<1e-6)return'⅓';
    if(Math.abs(number-(2/3))<1e-6)return'⅔';
    if(Math.abs(number-0.25)<1e-6)return'¼';
    if(Math.abs(number-0.75)<1e-6)return'¾';
    if(Number.isFinite(number)&&number>0&&number<1)return`${Math.round(number*100)}%`;
    return'';
  }
  function formatConfiguration(configuration=null){
    const config=configuration||{};
    if(config.pizza){
      const pizza=config.pizza,parts=[];
      if(pizza.size?.name)parts.push(String(pizza.size.name));
      const flavors=(pizza.flavors||[]).map(flavor=>{
        const prefix=fractionLabel(flavor.fraction);
        return`${prefix?prefix+' ':''}${flavor.name||''}`.trim();
      }).filter(Boolean);
      if(flavors.length)parts.push(flavors.join(' + '));
      if(pizza.crust?.name)parts.push(`Borda ${pizza.crust.name}`);
      return parts.join(' · ');
    }
    const parts=[];
    if(config.variant?.name)parts.push(String(config.variant.name));
    for(const option of config.options||[])if(option?.name)parts.push(String(option.name));
    for(const item of config.comboSelections||[])if(item?.productName)parts.push(String(item.productName));
    return parts.join(' · ');
  }
  function priceConfigured({basePriceCents=0,configuration=null,variantId=null,selections=[],comboSelections=[]}={}){
    const config=configuration||{};let cents=Math.max(0,Math.trunc(Number(basePriceCents)||0));
    const variant=(config.variants||[]).find(item=>String(item.id)===String(variantId||''));if(variant)cents+=Number(variant.priceDeltaCents||0);
    const selected=new Set((selections||[]).map(value=>String(value?.optionId||value)));
    for(const group of config.groups||[]){
      const deltas=(group.options||[]).filter(option=>selected.has(String(option.id))).map(option=>Number(option.priceDeltaCents||0));
      const mode=String(group.pricingMode||'ADDITIVE').toUpperCase();
      if(mode==='HIGHEST_FLAVOR'||mode==='HIGHEST')cents+=deltas.length?Math.max(...deltas):0;
      else if(mode==='PROPORTIONAL_AVERAGE'||mode==='AVERAGE')cents+=deltas.length?Math.round(deltas.reduce((sum,value)=>sum+value,0)/deltas.length):0;
      else cents+=deltas.reduce((sum,value)=>sum+value,0);
    }
    for(const pick of comboSelections||[]){const group=(config.combos||[]).find(item=>String(item.id)===String(pick.groupId));const item=group?.items?.find(row=>String(row.productId)===String(pick.productId));if(item)cents+=Number(item.priceDeltaCents||0);}
    return Math.max(0,Math.trunc(cents));
  }
  function createCart({idFactory=()=>`line-${Date.now()}-${Math.random().toString(36).slice(2)}`}={}){
    let items=[];
    function add(input={}){
      const productId=String(input.productId||'').trim();
      if(!productId)throw new Error('Produto obrigatorio.');
      const quantity=Number(input.quantity??1);
      if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade deve ser maior que zero.');
      const configuration=normalizedConfiguration(input.configuration||input);
      const candidate={
        id:String(input.id||idFactory()),
        productId,
        name:String(input.name||productId),
        unitPriceCents:Math.max(0,Math.trunc(Number(input.unitPriceCents)||0)),
        quantity,
        note:String(input.note||'').trim().slice(0,500),
        configuration
      };
      const existing=items.find(item=>signature(item)===signature(candidate)&&item.unitPriceCents===candidate.unitPriceCents);
      if(existing){existing.quantity+=quantity;return clone(existing);}
      items.push(candidate);return clone(candidate);
    }
    function lines(){return clone(items);}
    function clear(){items=[];}
    function changeQuantity(id,delta){
      const item=items.find(row=>row.id===String(id));if(!item)return null;
      item.quantity=Number((item.quantity+Number(delta||0)).toFixed(3));
      if(item.quantity<=0){items=items.filter(row=>row!==item);return null;}
      return clone(item);
    }
    function setQuantity(id,quantity){
      const item=items.find(row=>row.id===String(id));if(!item)return null;
      const value=Number(quantity);if(!Number.isFinite(value)||value<=0){items=items.filter(row=>row!==item);return null;}
      item.quantity=value;return clone(item);
    }
    function summary(){
      return{
        lines:items.length,
        quantity:items.reduce((sum,item)=>sum+Number(item.quantity||0),0),
        totalCents:items.reduce((sum,item)=>sum+Math.round(Number(item.unitPriceCents||0)*Number(item.quantity||0)),0)
      };
    }
    function toOrderItems(){
      return items.map(item=>({
        productId:item.productId,
        quantity:item.quantity,
        variantId:item.configuration.variantId,
        selections:[...item.configuration.selections],
        comboSelections:clone(item.configuration.comboSelections),
        note:item.note
      }));
    }
    return{add,lines,clear,changeQuantity,setQuantity,summary,toOrderItems};
  }
  return{createCart,priceConfigured,validateConfiguration,formatConfiguration,limitsForGroup};
});
