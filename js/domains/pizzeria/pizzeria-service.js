'use strict';

const { randomUUID }=require('node:crypto');
const { assertCents }=require('../shared/money');
const { roundQuantity }=require('../inventory/inventory-rules');
const { writeAudit }=require('../../core/audit-log');
const { formatPizzaConfiguration }=require('../../../shared/pizza-domain');

function createPizzeriaService({db,modules,catalogCustomization=null,recipeService=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules)throw new TypeError('db and modules are required.');
  const gate=()=>modules.requireEnabled('FOOD');
  function product(id){const row=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(id));if(!row)throw new Error('Produto de pizza nao encontrado ou inativo.');return row;}
  function recipeProduct(id,label){
    if(id==null||String(id).trim()==='')return null;
    const row=product(String(id));
    if(recipeService&&!recipeService.getRecipe(row.id))throw new Error(`Ficha tecnica de ${label} nao encontrada.`);
    return row;
  }
  function normalizeMultiplier(value){
    const number=Number(value??1);
    if(!Number.isFinite(number)||number<=0||number>20)throw new Error('Fator de consumo do tamanho invalido.');
    return number;
  }
  function aggregate(target,items=[]){
    for(const item of items||[]){
      const productId=String(item?.productId||'').trim();
      const quantity=roundQuantity(Number(item?.quantity||0));
      if(!productId||quantity<=0)continue;
      target.set(productId,roundQuantity((target.get(productId)||0)+quantity));
    }
  }
  function expandRecipe(productId,quantity){
    if(!recipeService||!recipeService.getRecipe(productId))return[];
    return recipeService.expandItems([{productId,quantity}]);
  }

  function upsertProfile(input={},actor={}){
    gate();const p=product(input.productId);const policy=String(input.pricingPolicy||'HIGHEST_FLAVOR').toUpperCase();
    if(!['HIGHEST_FLAVOR','PROPORTIONAL_AVERAGE'].includes(policy))throw new Error('Politica de preco da pizza invalida.');
    const ts=now();
    db.prepare(`INSERT INTO pizza_profiles(product_id,pricing_policy,active,created_at,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(product_id) DO UPDATE SET pricing_policy=excluded.pricing_policy,active=1,updated_at=excluded.updated_at`).run(p.id,policy,ts,ts);
    writeAudit(db,{action:'pizzeria.profile.upsert',entity:'pizza-profile',entityId:p.id,actor,context:{pricingPolicy:policy}},now);
    return{productId:p.id,pricingPolicy:policy,active:true};
  }

  function upsertSize(input={},actor={}){
    gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-size'));const name=String(input.name||'').trim();
    if(!name)throw new Error('Nome do tamanho obrigatorio.');
    const maxFlavors=Number(input.maxFlavors??1);if(!Number.isInteger(maxFlavors)||maxFlavors<1||maxFlavors>8)throw new Error('Maximo de sabores invalido.');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');const recipeMultiplier=normalizeMultiplier(input.recipeMultiplier);
    const ts=now();
    db.prepare(`INSERT INTO pizza_sizes(id,product_id,name,max_flavors,price_delta_cents,recipe_multiplier,active,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,max_flavors=excluded.max_flavors,price_delta_cents=excluded.price_delta_cents,recipe_multiplier=excluded.recipe_multiplier,active=1,updated_at=excluded.updated_at`).run(id,p.id,name,maxFlavors,delta,recipeMultiplier,ts,ts);
    writeAudit(db,{action:'pizzeria.size.upsert',entity:'pizza-size',entityId:id,actor,context:{productId:p.id,name,maxFlavors,priceDeltaCents:delta,recipeMultiplier}},now);
    return{id,productId:p.id,name,maxFlavors,priceDeltaCents:delta,recipeMultiplier};
  }

  function upsertFlavor(input={},actor={}){
    gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-flavor'));const name=String(input.name||'').trim();
    if(!name)throw new Error('Nome do sabor obrigatorio.');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    const linked=recipeProduct(input.recipeProductId,'sabor');
    const ts=now();
    db.prepare(`INSERT INTO pizza_flavors(id,product_id,name,price_delta_cents,recipe_product_id,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,recipe_product_id=excluded.recipe_product_id,active=1,updated_at=excluded.updated_at`).run(id,p.id,name,delta,linked?.id||null,ts,ts);
    writeAudit(db,{action:'pizzeria.flavor.upsert',entity:'pizza-flavor',entityId:id,actor,context:{productId:p.id,name,priceDeltaCents:delta,recipeProductId:linked?.id||null}},now);
    return{id,productId:p.id,name,priceDeltaCents:delta,recipeProductId:linked?.id||null,recipeProductName:linked?.name||null};
  }

  function upsertCrust(input={},actor={}){
    gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-crust'));const name=String(input.name||'').trim();
    if(!name)throw new Error('Nome da borda obrigatorio.');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    const linked=recipeProduct(input.recipeProductId,'borda');
    const ts=now();
    db.prepare(`INSERT INTO pizza_crusts(id,product_id,name,price_delta_cents,recipe_product_id,active,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,recipe_product_id=excluded.recipe_product_id,active=1,updated_at=excluded.updated_at`).run(id,p.id,name,delta,linked?.id||null,ts,ts);
    writeAudit(db,{action:'pizzeria.crust.upsert',entity:'pizza-crust',entityId:id,actor,context:{productId:p.id,name,priceDeltaCents:delta,recipeProductId:linked?.id||null}},now);
    return{id,productId:p.id,name,priceDeltaCents:delta,recipeProductId:linked?.id||null,recipeProductName:linked?.name||null};
  }

  function getProfile(productId){
    gate();const p=product(productId);const profile=db.prepare('SELECT * FROM pizza_profiles WHERE product_id=? AND active=1').get(p.id);if(!profile)return null;
    const sizes=db.prepare('SELECT id,name,max_flavors AS maxFlavors,price_delta_cents AS priceDeltaCents,recipe_multiplier AS recipeMultiplier FROM pizza_sizes WHERE product_id=? AND active=1 ORDER BY name,id').all(p.id)
      .map(row=>({...row,recipeMultiplier:Number(row.recipeMultiplier||1)}));
    const flavors=db.prepare(`SELECT f.id,f.name,f.price_delta_cents AS priceDeltaCents,f.recipe_product_id AS recipeProductId,rp.name AS recipeProductName FROM pizza_flavors f LEFT JOIN products rp ON rp.id=f.recipe_product_id WHERE f.product_id=? AND f.active=1 ORDER BY f.name,f.id`).all(p.id);
    const crusts=db.prepare(`SELECT c.id,c.name,c.price_delta_cents AS priceDeltaCents,c.recipe_product_id AS recipeProductId,rp.name AS recipeProductName FROM pizza_crusts c LEFT JOIN products rp ON rp.id=c.recipe_product_id WHERE c.product_id=? AND c.active=1 ORDER BY c.name,c.id`).all(p.id);
    return{productId:p.id,pricingPolicy:profile.pricing_policy,sizes,flavors,crusts};
  }

  function resolveSelection(input={}){
    const p=product(input.productId);const profile=getProfile(p.id);if(!profile)throw new Error('Perfil de pizzaria nao configurado para o produto.');
    const size=db.prepare('SELECT * FROM pizza_sizes WHERE id=? AND product_id=? AND active=1').get(String(input.sizeId||''),p.id);if(!size)throw new Error('Tamanho de pizza invalido.');
    const ids=(input.flavorIds||[]).map(String);if(!ids.length)throw new Error('Selecione ao menos um sabor.');
    if(new Set(ids).size!==ids.length)throw new Error('Nao repita o mesmo sabor na pizza.');
    if(ids.length>size.max_flavors)throw new Error(`Tamanho permite no maximo ${size.max_flavors} sabores.`);
    const flavors=ids.map(id=>{const row=db.prepare('SELECT * FROM pizza_flavors WHERE id=? AND product_id=? AND active=1').get(id,p.id);if(!row)throw new Error(`Sabor de pizza invalido: ${id}.`);return{id:row.id,name:row.name,priceDeltaCents:row.price_delta_cents,recipeProductId:row.recipe_product_id||null,fraction:1/ids.length};});
    let crust=null;if(input.crustId){const row=db.prepare('SELECT * FROM pizza_crusts WHERE id=? AND product_id=? AND active=1').get(String(input.crustId),p.id);if(!row)throw new Error('Borda de pizza invalida.');crust={id:row.id,name:row.name,priceDeltaCents:row.price_delta_cents,recipeProductId:row.recipe_product_id||null};}
    return{p,profile,size,flavors,crust};
  }

  function stockRequirements(input={}){
    gate();const {p,size,flavors,crust}=resolveSelection(input);const totals=new Map();const multiplier=normalizeMultiplier(size.recipe_multiplier);
    aggregate(totals,expandRecipe(p.id,multiplier));
    for(const flavor of flavors)if(flavor.recipeProductId)aggregate(totals,expandRecipe(flavor.recipeProductId,multiplier*flavor.fraction));
    if(crust?.recipeProductId)aggregate(totals,expandRecipe(crust.recipeProductId,multiplier));
    return[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([productId,quantity])=>({productId,quantity}));
  }

  function pricePizza(input={}){
    gate();const {p,profile,size,flavors,crust}=resolveSelection(input);
    let flavorDelta=0;if(profile.pricingPolicy==='HIGHEST_FLAVOR')flavorDelta=Math.max(...flavors.map(f=>f.priceDeltaCents));else flavorDelta=Math.round(flavors.reduce((sum,f)=>sum+f.priceDeltaCents,0)/flavors.length);
    let additionsDelta=0;let additions=null;
    if(catalogCustomization&&Array.isArray(input.selections)&&input.selections.length){
      const configured=catalogCustomization.priceConfiguredItem({productId:p.id,selections:input.selections});
      additions=configured.configurationSnapshot.options;additionsDelta=configured.unitPriceCents-p.sale_price_cents;
    }
    const unitPriceCents=p.sale_price_cents+size.price_delta_cents+flavorDelta+(crust?.priceDeltaCents||0)+additionsDelta;
    if(unitPriceCents<0||!Number.isSafeInteger(unitPriceCents))throw new Error('Preco da pizza invalido.');
    const pizza={
      pricingPolicy:profile.pricingPolicy,
      size:{id:size.id,name:size.name,priceDeltaCents:size.price_delta_cents,maxFlavors:size.max_flavors,recipeMultiplier:normalizeMultiplier(size.recipe_multiplier)},
      flavors,
      crust,
      additions:additions||[],
      stockItems:stockRequirements({productId:p.id,sizeId:size.id,flavorIds:flavors.map(item=>item.id),crustId:crust?.id||null})
    };
    pizza.displayLabel=formatPizzaConfiguration({pizza});
    return{unitPriceCents,configurationSnapshot:{version:2,productId:p.id,pizza}};
  }

  return{upsertProfile,upsertSize,upsertFlavor,upsertCrust,getProfile,pricePizza,stockRequirements};
}
module.exports={createPizzeriaService};
