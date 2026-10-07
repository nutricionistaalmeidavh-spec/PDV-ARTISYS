'use strict';

function createConfiguredItemPricingService({catalog,catalogCustomization,pizzeria}={}){
  if(!catalog||!catalogCustomization||!pizzeria)throw new TypeError('catalog, catalogCustomization and pizzeria are required.');

  function requireProduct(productId){
    const product=catalog.getProduct(String(productId||''));
    if(!product||product.active===false)throw new Error('Produto nao encontrado ou inativo.');
    return product;
  }

  function configuration(productId){
    const product=requireProduct(productId);
    let generic={groups:[],variants:[],combos:[]};
    try{generic=catalogCustomization.getProductConfiguration(product.id)||generic;}catch{}
    let pizza=null;
    try{pizza=pizzeria.getProfile(product.id);}catch{}
    return{
      groups:generic.groups||[],
      variants:generic.variants||[],
      combos:generic.combos||[],
      pizza:pizza||null
    };
  }

  function price(input={}){
    const product=requireProduct(input.productId);
    const quantity=Number(input.quantity??1);
    if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade deve ser maior que zero.');
    const note=String(input.note||'').trim().slice(0,500);
    const current=configuration(product.id);

    if(current.pizza){
      const pizza=input.pizza||{};
      if(!pizza.sizeId||!Array.isArray(pizza.flavorIds)||!pizza.flavorIds.length)throw new Error('Escolha o tamanho e ao menos um sabor da pizza.');
      const priced=pizzeria.pricePizza({
        productId:product.id,
        sizeId:pizza.sizeId,
        flavorIds:pizza.flavorIds,
        crustId:pizza.crustId||null,
        selections:Array.isArray(input.selections)?input.selections:[]
      });
      return{
        productId:product.id,
        quantity,
        unitPriceCents:priced.unitPriceCents,
        configurationSnapshot:priced.configurationSnapshot,
        note
      };
    }

    const priced=catalogCustomization.priceConfiguredItem({
      productId:product.id,
      variantId:input.variantId||undefined,
      selections:Array.isArray(input.selections)?input.selections:[],
      comboSelections:Array.isArray(input.comboSelections)?input.comboSelections:[]
    });
    return{
      productId:product.id,
      quantity,
      unitPriceCents:priced.unitPriceCents,
      configurationSnapshot:priced.configurationSnapshot,
      note
    };
  }

  return{configuration,price};
}

module.exports={createConfiguredItemPricingService};
