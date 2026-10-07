'use strict';

(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PdvPizzaComposer=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
  const byId=(rows,id)=>(rows||[]).find(row=>String(row.id)===String(id))||null;

  function isPizzaProfile(profile){
    return Boolean(profile&&Array.isArray(profile.sizes)&&profile.sizes.length&&Array.isArray(profile.flavors)&&profile.flavors.length);
  }

  function maxFlavors(profile,sizeId){
    const size=byId(profile?.sizes,sizeId);
    return Math.max(1,Number(size?.maxFlavors||1));
  }

  function createSelection(profile,input={}){
    const sizeId=byId(profile?.sizes,input.sizeId)?.id||null;
    const allowedFlavors=new Set((profile?.flavors||[]).map(row=>String(row.id)));
    const unique=[];
    for(const id of Array.isArray(input.flavorIds)?input.flavorIds:[]){
      const key=String(id);
      if(allowedFlavors.has(key)&&!unique.includes(key))unique.push(key);
    }
    const limit=sizeId?maxFlavors(profile,sizeId):8;
    const crustId=byId(profile?.crusts,input.crustId)?.id||null;
    return{sizeId,flavorIds:unique.slice(0,limit),crustId};
  }

  function reduce(profile,state={},action={}){
    const current=createSelection(profile,state);
    switch(action.type){
      case 'size':{
        const sizeId=byId(profile?.sizes,action.id)?.id||null;
        return createSelection(profile,{...current,sizeId});
      }
      case 'flavor.toggle':{
        const id=String(action.id||'');
        if(!byId(profile?.flavors,id))return current;
        const exists=current.flavorIds.includes(id);
        const flavorIds=exists?current.flavorIds.filter(row=>row!==id):[...current.flavorIds,id];
        return createSelection(profile,{...current,flavorIds});
      }
      case 'flavors':
        return createSelection(profile,{...current,flavorIds:Array.isArray(action.ids)?action.ids:[]});
      case 'crust':
        return createSelection(profile,{...current,crustId:action.id||null});
      case 'reset':
        return createSelection(profile);
      default:
        return current;
    }
  }

  function validate(profile,input={}){
    if(!isPizzaProfile(profile))return'Configuração de pizza indisponível.';
    const state=createSelection(profile,input);
    if(!state.sizeId)return'Selecione o tamanho.';
    if(!state.flavorIds.length)return'Selecione ao menos um sabor.';
    const limit=maxFlavors(profile,state.sizeId);
    if(state.flavorIds.length>limit)return`Este tamanho permite no máximo ${limit} sabor${limit===1?'':'es'}.`;
    return'';
  }

  function toPayload(input={}){
    return{
      sizeId:input.sizeId||null,
      flavorIds:Array.isArray(input.flavorIds)?[...input.flavorIds]:[],
      crustId:input.crustId||null
    };
  }

  function fractionPrefix(count){
    if(count<=1)return'';
    if(count===2)return'½ ';
    if(count===3)return'⅓ ';
    if(count===4)return'¼ ';
    return`${Math.round(100/count)}% `;
  }

  function summaryFromSelection(profile,input={}){
    const state=createSelection(profile,input);
    const size=byId(profile?.sizes,state.sizeId);
    const flavors=state.flavorIds.map(id=>byId(profile?.flavors,id)).filter(Boolean);
    const crust=byId(profile?.crusts,state.crustId);
    const parts=[];
    if(size?.name)parts.push(size.name);
    if(flavors.length){
      const prefix=fractionPrefix(flavors.length);
      parts.push(flavors.map(row=>`${prefix}${row.name}`).join(' + '));
    }
    if(crust?.name)parts.push(`Borda ${String(crust.name).replace(/^Borda\s+/i,'')}`);
    return parts.join(' · ');
  }

  function formatPizza(configuration){
    const pizza=configuration?.pizza||configuration;
    if(!pizza||!pizza.size)return'';
    const parts=[];
    if(pizza.size?.name)parts.push(String(pizza.size.name));
    const flavors=Array.isArray(pizza.flavors)?pizza.flavors:[];
    if(flavors.length){
      parts.push(flavors.map(row=>{
        const fraction=Number(row.fraction||0);
        const prefix=fraction===0.5?'½ ':fraction>0&&Math.abs(fraction-(1/3))<0.001?'⅓ ':fraction===0.25?'¼ ':'';
        return`${prefix}${row.name||''}`.trim();
      }).join(' + '));
    }
    if(pizza.crust?.name)parts.push(`Borda ${String(pizza.crust.name).replace(/^Borda\s+/i,'')}`);
    return parts.filter(Boolean).join(' · ');
  }

  function derive(profile,state={}){
    const selection=createSelection(profile,state);
    return{
      selection:clone(selection),
      error:validate(profile,selection),
      maxFlavors:selection.sizeId?maxFlavors(profile,selection.sizeId):1,
      summary:summaryFromSelection(profile,selection)
    };
  }

  return Object.freeze({isPizzaProfile,createSelection,reduce,validate,toPayload,summaryFromSelection,formatPizza,derive});
});
