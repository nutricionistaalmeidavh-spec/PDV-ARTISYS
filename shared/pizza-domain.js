'use strict';

(function initPizzaDomain(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.ArtiSysPizzaDomain=Object.freeze(api);
})(typeof globalThis!=='undefined'?globalThis:this,function pizzaDomainFactory(){
  function clean(value){return String(value??'').trim();}
  function fractionText(value){
    const n=Number(value);
    if(Math.abs(n-1)<1e-9)return'';
    if(Math.abs(n-.5)<1e-9)return'½ ';
    if(Math.abs(n-(1/3))<1e-9)return'⅓ ';
    if(Math.abs(n-.25)<1e-9)return'¼ ';
    if(Number.isFinite(n)&&n>0)return`${Math.round(n*100)}% `;
    return'';
  }
  function pizzaSnapshot(configuration){
    return configuration?.pizza&&typeof configuration.pizza==='object'?configuration.pizza:null;
  }
  function formatPizzaConfiguration(configuration){
    const pizza=pizzaSnapshot(configuration);
    if(!pizza)return'';
    if(clean(pizza.displayLabel))return clean(pizza.displayLabel);
    const parts=[];
    if(pizza.size?.name)parts.push(clean(pizza.size.name));
    const flavors=(pizza.flavors||[]).map(flavor=>`${fractionText(flavor.fraction)}${clean(flavor.name)}`.trim()).filter(Boolean);
    if(flavors.length)parts.push(flavors.join(' + '));
    if(pizza.crust?.name)parts.push(`Borda ${clean(pizza.crust.name)}`);
    const additions=(pizza.additions||[]).map(item=>clean(item.name)).filter(Boolean);
    if(additions.length)parts.push(additions.join(', '));
    return parts.join(' · ');
  }
  function isPizzaProduct(product){return Boolean(product?.pizza&&Array.isArray(product.pizza.sizes)&&product.pizza.sizes.length);}
  function orderItemLabel(item){
    const base=clean(item?.productName||item?.name);
    const config=formatPizzaConfiguration(item?.configuration||item?.configurationSnapshot);
    return config?`${base} — ${config}`:base;
  }
  return{fractionText,pizzaSnapshot,formatPizzaConfiguration,isPizzaProduct,orderItemLabel};
});
