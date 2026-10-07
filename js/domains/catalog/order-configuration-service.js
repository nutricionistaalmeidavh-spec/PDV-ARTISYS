'use strict';

const PIZZA_SIZE_GROUP_ID='__artisys_pizza_size__';
const PIZZA_FLAVOR_GROUP_ID='__artisys_pizza_flavors__';
const PIZZA_CRUST_GROUP_ID='__artisys_pizza_crust__';

function createOrderConfigurationService({catalogCustomization,pizzeria}={}){
  if(!catalogCustomization||!pizzeria)throw new TypeError('catalogCustomization and pizzeria are required.');

  function pizzaProfile(productId){
    try{return pizzeria.getProfile(productId);}catch{return null;}
  }

  function getProductConfiguration(productId){
    const base=catalogCustomization.getProductConfiguration(productId);
    const pizza=pizzaProfile(productId);
    if(!pizza)return base;

    const maxFlavors=Math.max(1,...pizza.sizes.map(size=>Number(size.maxFlavors||1)));
    return{
      productId:base.productId,
      basePriceCents:base.basePriceCents,
      configurationKind:'PIZZA',
      pricingPolicy:pizza.pricingPolicy,
      variants:[],
      groups:[
        {
          id:PIZZA_SIZE_GROUP_ID,
          name:'Tamanho',
          selectionType:'SINGLE',
          minSelections:1,
          maxSelections:1,
          required:true,
          sortOrder:-300,
          pricingMode:'ADDITIVE',
          options:pizza.sizes.map(size=>({
            id:size.id,
            name:size.name,
            priceDeltaCents:Number(size.priceDeltaCents||0)
          }))
        },
        {
          id:PIZZA_FLAVOR_GROUP_ID,
          name:'Sabores',
          selectionType:'MULTIPLE',
          minSelections:1,
          maxSelections:maxFlavors,
          required:true,
          sortOrder:-200,
          pricingMode:pizza.pricingPolicy,
          maxSelectionsBySize:Object.fromEntries(pizza.sizes.map(size=>[size.id,Number(size.maxFlavors||1)])),
          options:pizza.flavors.map(flavor=>({
            id:flavor.id,
            name:flavor.name,
            priceDeltaCents:Number(flavor.priceDeltaCents||0)
          }))
        },
        {
          id:PIZZA_CRUST_GROUP_ID,
          name:'Borda',
          selectionType:'SINGLE',
          minSelections:0,
          maxSelections:1,
          required:false,
          sortOrder:-100,
          pricingMode:'ADDITIVE',
          options:pizza.crusts.map(crust=>({
            id:crust.id,
            name:crust.name,
            priceDeltaCents:Number(crust.priceDeltaCents||0)
          }))
        },
        ...(base.groups||[])
      ],
      combos:base.combos||[]
    };
  }

  function priceConfiguredItem(input={}){
    const pizza=pizzaProfile(input.productId);
    if(!pizza)return catalogCustomization.priceConfiguredItem(input);

    const selected=(input.selections||[]).map(value=>String(value?.optionId||value));
    const sizeIds=new Set(pizza.sizes.map(row=>String(row.id)));
    const flavorIds=new Set(pizza.flavors.map(row=>String(row.id)));
    const crustIds=new Set(pizza.crusts.map(row=>String(row.id)));
    const sizes=selected.filter(id=>sizeIds.has(id));
    const flavors=selected.filter(id=>flavorIds.has(id));
    const crusts=selected.filter(id=>crustIds.has(id));
    if(sizes.length>1)throw new Error('Selecione somente um tamanho.');
    if(crusts.length>1)throw new Error('Selecione no maximo uma borda.');
    const sizeId=sizes[0]||String(input.variantId||'');
    const genericSelections=selected.filter(id=>!sizeIds.has(id)&&!flavorIds.has(id)&&!crustIds.has(id));

    return pizzeria.pricePizza({
      productId:input.productId,
      sizeId,
      flavorIds:flavors,
      crustId:crusts[0]||null,
      selections:genericSelections,
      comboSelections:Array.isArray(input.comboSelections)?input.comboSelections:[]
    });
  }

  return{getProductConfiguration,priceConfiguredItem};
}

module.exports={createOrderConfigurationService,PIZZA_SIZE_GROUP_ID,PIZZA_FLAVOR_GROUP_ID,PIZZA_CRUST_GROUP_ID};
