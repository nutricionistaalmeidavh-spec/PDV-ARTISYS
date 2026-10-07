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
    comboSelections:Array.isArray(input?.comboSelections)?clone(input.comboSelections):[],
    pizza:input?.pizza?clone(input.pizza):null
  });
  const signature=line=>JSON.stringify({
    productId:line.productId,
    note:line.note||'',
    configuration:line.configuration
  });
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
        pizza:item.configuration.pizza?clone(item.configuration.pizza):null,
        note:item.note
      }));
    }
    return{add,lines,clear,changeQuantity,setQuantity,summary,toOrderItems};
  }
  return{createCart};
});
