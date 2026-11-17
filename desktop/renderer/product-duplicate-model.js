'use strict';

// Recomendação não destrutiva: apenas avisa e oferece editar o cadastro existente.
// Nomes iguais em categorias diferentes são permitidos; código/SKU iguais são sinalizados.
(function attach(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.PdvProductDuplicateModel=api;
})(typeof window!=='undefined'?window:globalThis,()=>{
  const normalized=value=>String(value??'').normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim().toLocaleLowerCase('pt-BR');
  const normalizedCode=value=>String(value??'').trim().toUpperCase();
  function findLikelyDuplicate(products=[],input={},excludeId=null){
    const active=(Array.isArray(products)?products:[]).filter(product=>
      product&&product.active!==false&&String(product.id)!==String(excludeId||''));
    const barcode=normalizedCode(input.barcode);
    const sku=normalizedCode(input.sku);
    const name=normalized(input.name);
    const categoryId=String(input.categoryId||'').trim();
    if(barcode){
      const item=active.find(product=>normalizedCode(product.barcode)===barcode);
      if(item)return{product:item,reason:'barcode'};
    }
    if(sku){
      const item=active.find(product=>normalizedCode(product.sku)===sku);
      if(item)return{product:item,reason:'sku'};
    }
    if(!name)return null;
    const item=active.find(product=>{
      if(normalized(product.name)!==name)return false;
      const currentCategory=String(product.categoryId||'').trim();
      return !categoryId||!currentCategory||currentCategory===categoryId;
    });
    return item?{product:item,reason:'name'}:null;
  }
  return Object.freeze({findLikelyDuplicate});
});
