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
    if(!pizza)return{groups:generic.groups||[],variants:generic.variants||[],combos:generic.combos||[],pizza:null};
    const maxFlavors=Math.max(1,...(pizza.sizes||[]).map(size=>Number(size.maxFlavors||1)));
    const pizzaGroups=[
      {
        id:'__pizza_flavors__',
        name:'Sabores',
        selectionType:'MULTIPLE',
        minSelections:1,
        maxSelections:maxFlavors,
        required:true,
        sortOrder:-20,
        options:(pizza.flavors||[]).map(flavor=>({
          id:flavor.id,
          name:flavor.name,
          priceDeltaCents:flavor.priceDeltaCents
        }))
      },
      {
        id:'__pizza_crust__',
        name:'Borda',
        selectionType:'SINGLE',
        minSelections:0,
        maxSelections:1,
        required:false,
        sortOrder:-10,
        options:(pizza.crusts||[]).map(crust=>({
          id:crust.id,
          name:crust.name,
          priceDeltaCents:crust.priceDeltaCents
        }))
      }
    ];
    return{
      groups:[...pizzaGroups,...(generic.groups||[])],
      variants:(pizza.sizes||[]).map(size=>({
        id:size.id,
        name:size.name,
        attributes:{pizzaSize:true,maxFlavors:size.maxFlavors},
        priceDeltaCents:size.priceDeltaCents
      })),
      combos:generic.combos||[],
      pizza
    };
  }

  function price(input={}){
    const product=requireProduct(input.productId);
    const quantity=Number(input.quantity??1);
    if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade deve ser maior que zero.');
    const note=String(input.note||'').trim().slice(0,500);
    const current=configuration(product.id);

    if(current.pizza){
      const profile=current.pizza;
      const submittedSelections=Array.isArray(input.selections)?input.selections.map(value=>typeof value==='string'?value:value?.optionId).filter(Boolean):[];
      const flavorIds=new Set((profile.flavors||[]).map(item=>String(item.id)));
      const crustIds=new Set((profile.crusts||[]).map(item=>String(item.id)));
      const pizzaInput=input.pizza||{};
      const sizeId=String(pizzaInput.sizeId||input.variantId||'');
      const selectedFlavorIds=Array.isArray(pizzaInput.flavorIds)&&pizzaInput.flavorIds.length
        ? pizzaInput.flavorIds.map(String)
        : submittedSelections.filter(id=>flavorIds.has(String(id))).map(String);
      const crustId=String(pizzaInput.crustId||submittedSelections.find(id=>crustIds.has(String(id)))||'')||null;
      const genericSelections=submittedSelections.filter(id=>!flavorIds.has(String(id))&&!crustIds.has(String(id)));
      if(!sizeId||!selectedFlavorIds.length)throw new Error('Escolha o tamanho e ao menos um sabor da pizza.');
      const priced=pizzeria.pricePizza({
        productId:product.id,
        sizeId,
        flavorIds:selectedFlavorIds,
        crustId,
        selections:genericSelections
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
