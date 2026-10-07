'use strict';

const {randomUUID}=require('node:crypto');
const {assertCents}=require('../shared/money');
const {writeAudit}=require('../../core/audit-log');

const PRICING_POLICIES=new Set(['HIGHEST_FLAVOR','PROPORTIONAL_AVERAGE']);
const SIZE_PREFIX='__pizza_size__:';
const FLAVOR_PREFIX='__pizza_flavor__:';
const CRUST_PREFIX='__pizza_crust__:';
const FLAVOR_GROUP_PREFIX='__pizza_flavors__:';
const CRUST_GROUP_PREFIX='__pizza_crusts__:';

function positiveNumber(value,label,{min=0.000001,max=1000}={}){
  const n=Number(value);
  if(!Number.isFinite(n)||n<min||n>max)throw new Error(`${label} invalido.`);
  return n;
}
function fractionText(count){
  const n=Number(count);
  if(n===2)return'½';
  if(n===3)return'⅓';
  if(n===4)return'¼';
  if(n===5)return'⅕';
  if(n===6)return'⅙';
  if(n===8)return'⅛';
  return`1/${n}`;
}
function roundQuantity(value){return Math.round(Number(value||0)*1000000)/1000000;}

function createPizzeriaService({db,modules,catalogCustomization=null,recipes=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules)throw new TypeError('db and modules are required.');
  const gate=()=>modules.requireEnabled('FOOD');

  function requireProduct(productId){
    const row=db.prepare('SELECT id,name,sale_price_cents AS salePriceCents,active FROM products WHERE id=?').get(String(productId));
    if(!row||!row.active)throw new Error('Produto nao encontrado ou inativo.');
    return row;
  }
  function requireRecipeProduct(productId,label){
    const id=String(productId||'').trim();
    if(!id)return null;
    requireProduct(id);
    if(!recipes?.getRecipe?.(id))throw new Error(`${label} precisa apontar para uma ficha tecnica ativa.`);
    return id;
  }
  function mapProfile(row){
    if(!row)return null;
    return{productId:row.product_id,pricingPolicy:row.pricing_policy};
  }
  function mapSize(row){
    if(!row)return null;
    return{id:row.id,productId:row.product_id,name:row.name,maxFlavors:Number(row.max_flavors),priceDeltaCents:Number(row.price_delta_cents),recipeMultiplier:Number(row.recipe_multiplier??1),active:Boolean(row.active)};
  }
  function mapFlavor(row){
    if(!row)return null;
    return{id:row.id,productId:row.product_id,name:row.name,priceDeltaCents:Number(row.price_delta_cents),recipeProductId:row.recipe_product_id||null,active:Boolean(row.active)};
  }
  function mapCrust(row){
    if(!row)return null;
    return{id:row.id,productId:row.product_id,name:row.name,priceDeltaCents:Number(row.price_delta_cents),recipeProductId:row.recipe_product_id||null,active:Boolean(row.active)};
  }

  function upsertProfile(input={},actor={}){
    gate();
    const product=requireProduct(input.productId);
    const pricingPolicy=String(input.pricingPolicy||'HIGHEST_FLAVOR').trim().toUpperCase();
    if(!PRICING_POLICIES.has(pricingPolicy))throw new Error('Politica de preco da pizza invalida.');
    db.prepare(`INSERT INTO pizza_profiles(product_id,pricing_policy,updated_at) VALUES(?,?,?)
      ON CONFLICT(product_id) DO UPDATE SET pricing_policy=excluded.pricing_policy,updated_at=excluded.updated_at`).run(product.id,pricingPolicy,now());
    writeAudit(db,{action:'pizzeria.profile.upsert',entity:'product',entityId:product.id,actor,context:{pricingPolicy}},now);
    return getProfile(product.id);
  }

  function upsertSize(input={},actor={}){
    gate();
    const product=requireProduct(input.productId);
    const id=String(input.id||idFactory('pizza-size'));
    const name=String(input.name||'').trim();if(!name)throw new Error('Nome do tamanho obrigatorio.');
    const maxFlavors=Math.trunc(Number(input.maxFlavors??1));if(!Number.isInteger(maxFlavors)||maxFlavors<1||maxFlavors>8)throw new Error('Quantidade maxima de sabores invalida.');
    const priceDeltaCents=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    const recipeMultiplier=positiveNumber(input.recipeMultiplier??1,'Fator de consumo do tamanho',{min:0.05,max:10});
    const ts=now();
    db.prepare(`INSERT INTO pizza_sizes(id,product_id,name,max_flavors,price_delta_cents,active,created_at,updated_at,recipe_multiplier)
      VALUES(?,?,?,?,?,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,max_flavors=excluded.max_flavors,price_delta_cents=excluded.price_delta_cents,active=1,updated_at=excluded.updated_at,recipe_multiplier=excluded.recipe_multiplier`)
      .run(id,product.id,name,maxFlavors,priceDeltaCents,ts,ts,recipeMultiplier);
    writeAudit(db,{action:'pizzeria.size.upsert',entity:'pizza-size',entityId:id,actor,context:{productId:product.id,name,maxFlavors,priceDeltaCents,recipeMultiplier}},now);
    return mapSize(db.prepare('SELECT * FROM pizza_sizes WHERE id=?').get(id));
  }

  function upsertFlavor(input={},actor={}){
    gate();
    const product=requireProduct(input.productId);
    const id=String(input.id||idFactory('pizza-flavor'));
    const name=String(input.name||'').trim();if(!name)throw new Error('Nome do sabor obrigatorio.');
    const priceDeltaCents=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    const recipeProductId=requireRecipeProduct(input.recipeProductId,'Sabor');
    const ts=now();
    db.prepare(`INSERT INTO pizza_flavors(id,product_id,name,price_delta_cents,active,created_at,updated_at,recipe_product_id)
      VALUES(?,?,?,?,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,active=1,updated_at=excluded.updated_at,recipe_product_id=excluded.recipe_product_id`)
      .run(id,product.id,name,priceDeltaCents,ts,ts,recipeProductId);
    writeAudit(db,{action:'pizzeria.flavor.upsert',entity:'pizza-flavor',entityId:id,actor,context:{productId:product.id,name,priceDeltaCents,recipeProductId}},now);
    return mapFlavor(db.prepare('SELECT * FROM pizza_flavors WHERE id=?').get(id));
  }

  function upsertCrust(input={},actor={}){
    gate();
    const product=requireProduct(input.productId);
    const id=String(input.id||idFactory('pizza-crust'));
    const name=String(input.name||'').trim();if(!name)throw new Error('Nome da borda obrigatorio.');
    const priceDeltaCents=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    const recipeProductId=requireRecipeProduct(input.recipeProductId,'Borda');
    const ts=now();
    db.prepare(`INSERT INTO pizza_crusts(id,product_id,name,price_delta_cents,active,created_at,updated_at,recipe_product_id)
      VALUES(?,?,?,?,1,?,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,active=1,updated_at=excluded.updated_at,recipe_product_id=excluded.recipe_product_id`)
      .run(id,product.id,name,priceDeltaCents,ts,ts,recipeProductId);
    writeAudit(db,{action:'pizzeria.crust.upsert',entity:'pizza-crust',entityId:id,actor,context:{productId:product.id,name,priceDeltaCents,recipeProductId}},now);
    return mapCrust(db.prepare('SELECT * FROM pizza_crusts WHERE id=?').get(id));
  }

  function getProfile(productId){
    gate();
    const profile=mapProfile(db.prepare('SELECT * FROM pizza_profiles WHERE product_id=?').get(String(productId)));
    if(!profile)return null;
    return{
      ...profile,
      sizes:db.prepare('SELECT * FROM pizza_sizes WHERE product_id=? AND active=1 ORDER BY name,id').all(profile.productId).map(mapSize),
      flavors:db.prepare('SELECT * FROM pizza_flavors WHERE product_id=? AND active=1 ORDER BY name,id').all(profile.productId).map(mapFlavor),
      crusts:db.prepare('SELECT * FROM pizza_crusts WHERE product_id=? AND active=1 ORDER BY name,id').all(profile.productId).map(mapCrust)
    };
  }

  function hasProfile(productId){
    gate();
    return Boolean(db.prepare('SELECT 1 FROM pizza_profiles WHERE product_id=?').get(String(productId)));
  }

  function safeProfile(productId){
    const profile=getProfile(productId);
    if(!profile)return null;
    return{
      productId:profile.productId,
      pricingPolicy:profile.pricingPolicy,
      sizes:profile.sizes.map(({recipeMultiplier,...size})=>({...size})),
      flavors:profile.flavors.map(({recipeProductId,...flavor})=>({...flavor})),
      crusts:profile.crusts.map(({recipeProductId,...crust})=>({...crust}))
    };
  }

  function composerConfiguration(productId,baseConfiguration={groups:[],variants:[],combos:[]}){
    const profile=getProfile(productId);
    if(!profile)return baseConfiguration;
    const maxFlavors=Math.max(1,...profile.sizes.map(size=>Number(size.maxFlavors||1)));
    const pizzaGroups=[
      {
        id:`${FLAVOR_GROUP_PREFIX}${profile.productId}`,
        name:'Sabores',
        selectionType:'MULTIPLE',
        minSelections:1,
        maxSelections:maxFlavors,
        required:true,
        sortOrder:-1000,
        options:profile.flavors.map(flavor=>({id:`${FLAVOR_PREFIX}${flavor.id}`,name:flavor.name,priceDeltaCents:flavor.priceDeltaCents}))
      }
    ];
    if(profile.crusts.length)pizzaGroups.push({
      id:`${CRUST_GROUP_PREFIX}${profile.productId}`,
      name:'Borda',
      selectionType:'SINGLE',
      minSelections:0,
      maxSelections:1,
      required:false,
      sortOrder:-900,
      options:profile.crusts.map(crust=>({id:`${CRUST_PREFIX}${crust.id}`,name:crust.name,priceDeltaCents:crust.priceDeltaCents}))
    });
    return{
      productId:profile.productId,
      basePriceCents:Number(requireProduct(profile.productId).salePriceCents||0),
      variants:profile.sizes.map(size=>({id:`${SIZE_PREFIX}${size.id}`,name:size.name,attributes:{kind:'pizza-size'},priceDeltaCents:size.priceDeltaCents,costCents:null})),
      groups:[...pizzaGroups,...(baseConfiguration.groups||[])],
      combos:[...(baseConfiguration.combos||[])]
    };
  }

  function expandRecipe(productId,quantity){
    if(!recipes?.getRecipe?.(productId))return[];
    return recipes.expandItems([{productId,quantity}]);
  }
  function aggregateStock(profile,size,flavors,crust){
    const totals=new Map();
    const add=(items,multiplier=1)=>{for(const item of items||[]){const id=String(item.productId);const qty=roundQuantity(Number(item.quantity||0)*multiplier);if(qty<=0)continue;totals.set(id,roundQuantity((totals.get(id)||0)+qty));}};
    const sizeFactor=Number(size.recipeMultiplier||1);
    add(expandRecipe(profile.productId,sizeFactor));
    const flavorFraction=1/Math.max(flavors.length,1);
    for(const flavor of flavors)if(flavor.recipeProductId)add(expandRecipe(flavor.recipeProductId,sizeFactor*flavorFraction));
    if(crust?.recipeProductId)add(expandRecipe(crust.recipeProductId,sizeFactor));
    return[...totals.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([productId,quantity])=>({productId,quantity}));
  }

  function pricePizza(input={}){
    gate();
    const product=requireProduct(input.productId);
    const profile=getProfile(product.id);if(!profile)throw new Error('Produto nao esta configurado como pizza.');
    const size=profile.sizes.find(item=>item.id===String(input.sizeId||''));if(!size)throw new Error('Escolha um tamanho valido.');
    const flavorIds=[...new Set((input.flavorIds||[]).map(String).filter(Boolean))];
    if(!flavorIds.length)throw new Error('Escolha ao menos um sabor.');
    if(flavorIds.length>size.maxFlavors)throw new Error(`O tamanho ${size.name} aceita no maximo ${size.maxFlavors} sabor(es).`);
    const flavors=flavorIds.map(id=>profile.flavors.find(item=>item.id===id));
    if(flavors.some(item=>!item))throw new Error('Sabor invalido para esta pizza.');
    const crustId=String(input.crustId||'').trim();
    const crust=crustId?profile.crusts.find(item=>item.id===crustId):null;
    if(crustId&&!crust)throw new Error('Borda invalida para esta pizza.');

    let flavorDelta=0;
    if(profile.pricingPolicy==='HIGHEST_FLAVOR')flavorDelta=Math.max(...flavors.map(item=>Number(item.priceDeltaCents||0)));
    else flavorDelta=Math.round(flavors.reduce((sum,item)=>sum+Number(item.priceDeltaCents||0),0)/flavors.length);
    const unitPriceCents=Number(product.salePriceCents||0)+Number(size.priceDeltaCents||0)+flavorDelta+Number(crust?.priceDeltaCents||0);
    if(!Number.isSafeInteger(unitPriceCents)||unitPriceCents<0)throw new Error('Preco da pizza invalido.');

    const fraction=1/flavors.length;
    const flavorLabel=flavors.length===1?flavors[0].name:flavors.map(item=>`${fractionText(flavors.length)} ${item.name}`).join(' + ');
    const displayLabel=`${size.name} · ${flavorLabel}${crust?` · Borda ${crust.name}`:''}`;
    const stockItems=aggregateStock(profile,size,flavors,crust);
    return{
      unitPriceCents,
      configurationSnapshot:{
        version:1,
        productId:product.id,
        pizza:{
          pricingPolicy:profile.pricingPolicy,
          displayLabel,
          size:{id:size.id,name:size.name,priceDeltaCents:size.priceDeltaCents,recipeMultiplier:size.recipeMultiplier},
          flavors:flavors.map(item=>({id:item.id,name:item.name,priceDeltaCents:item.priceDeltaCents,fraction})),
          crust:crust?{id:crust.id,name:crust.name,priceDeltaCents:crust.priceDeltaCents}:null,
          stockItems
        }
      }
    };
  }

  function parseComposerSelection(input,profile){
    const explicit=input.pizza&&typeof input.pizza==='object'?input.pizza:null;
    if(explicit)return{
      sizeId:String(explicit.sizeId||''),
      flavorIds:Array.isArray(explicit.flavorIds)?explicit.flavorIds.map(String):[],
      crustId:explicit.crustId?String(explicit.crustId):null
    };
    const variantId=String(input.variantId||'');
    const selections=(input.selections||[]).map(value=>String(value?.optionId||value));
    return{
      sizeId:variantId.startsWith(SIZE_PREFIX)?variantId.slice(SIZE_PREFIX.length):'',
      flavorIds:selections.filter(id=>id.startsWith(FLAVOR_PREFIX)).map(id=>id.slice(FLAVOR_PREFIX.length)),
      crustId:(selections.find(id=>id.startsWith(CRUST_PREFIX))||'').slice(CRUST_PREFIX.length)||null
    };
  }

  function priceOrderItem(input={}){
    gate();
    const profile=getProfile(input.productId);
    if(!profile)return null;
    const pizzaSelection=parseComposerSelection(input,profile);
    const pizza=pricePizza({productId:profile.productId,...pizzaSelection});
    const allSelections=(input.selections||[]).map(value=>String(value?.optionId||value));
    const genericSelections=allSelections.filter(id=>!id.startsWith(FLAVOR_PREFIX)&&!id.startsWith(CRUST_PREFIX));
    const genericVariant=String(input.variantId||'');
    let genericSnapshot={version:1,productId:profile.productId,variant:null,options:[],comboSelections:[]};
    let genericDelta=0;
    if(catalogCustomization){
      const generic=catalogCustomization.priceConfiguredItem({
        productId:profile.productId,
        variantId:genericVariant&& !genericVariant.startsWith(SIZE_PREFIX)?genericVariant:undefined,
        selections:genericSelections,
        comboSelections:Array.isArray(input.comboSelections)?input.comboSelections:[]
      });
      genericDelta=Number(generic.unitPriceCents)-Number(requireProduct(profile.productId).salePriceCents||0);
      genericSnapshot=generic.configurationSnapshot;
    }
    return{
      productId:profile.productId,
      quantity:input.quantity??1,
      unitPriceCents:pizza.unitPriceCents+genericDelta,
      configurationSnapshot:{...genericSnapshot,pizza:pizza.configurationSnapshot.pizza},
      note:String(input.note||'').trim().slice(0,500)
    };
  }

  return{
    upsertProfile,upsertSize,upsertFlavor,upsertCrust,getProfile,safeProfile,hasProfile,
    composerConfiguration,pricePizza,priceOrderItem,
    SIZE_PREFIX,FLAVOR_PREFIX,CRUST_PREFIX
  };
}

module.exports={createPizzeriaService,PRICING_POLICIES,SIZE_PREFIX,FLAVOR_PREFIX,CRUST_PREFIX};
