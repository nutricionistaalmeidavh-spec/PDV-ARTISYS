'use strict';

const { randomUUID }=require('node:crypto');
const { assertCents }=require('../shared/money');
const { roundQuantity }=require('../inventory/inventory-rules');
const { writeAudit }=require('../../core/audit-log');

function createPizzeriaService({db,modules,catalogCustomization=null,recipes=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules)throw new TypeError('db and modules are required.');

  const gate=()=>modules.requireEnabled('FOOD');
  function product(id){const row=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(id));if(!row)throw new Error('Produto de pizza nao encontrado ou inativo.');return row;}
  function recipeProduct(id,label){
    if(id==null||String(id).trim()==='')return null;
    const row=product(String(id));
    if(recipes&&!recipes.getRecipe(row.id))throw new Error(`Ficha tecnica obrigatoria para ${label}.`);
    return row.id;
  }
  function aggregate(target,productId,quantity){
    const id=String(productId||'').trim(),value=roundQuantity(Number(quantity||0));
    if(!id||value<=0)return;
    target.set(id,roundQuantity((target.get(id)||0)+value));
  }
  function expandRecipe(target,productId,quantity){
    if(!recipes||!recipes.getRecipe(productId))return;
    for(const row of recipes.expandItems([{productId,quantity}])||[])aggregate(target,row.productId,row.quantity);
  }

  function upsertProfile(input={},actor={}){
    gate();const p=product(input.productId);const policy=String(input.pricingPolicy||'HIGHEST_FLAVOR').toUpperCase();
    if(!['HIGHEST_FLAVOR','PROPORTIONAL_AVERAGE'].includes(policy))throw new Error('Politica de preco da pizza invalida.');
    const ts=now();
    db.prepare(`INSERT INTO pizza_profiles(product_id,pricing_policy,active,created_at,updated_at) VALUES(?,?,1,?,?)
      ON CONFLICT(product_id) DO UPDATE SET pricing_policy=excluded.pricing_policy,active=1,updated_at=excluded.updated_at`).run(p.id,policy,ts,ts);
    writeAudit(db,{action:'pizzeria.profile.upsert',entity:'pizza-profile',entityId:p.id,actor,context:{pricingPolicy:policy}},now);
    return{productId:p.id,pricingPolicy:policy,active:true};
  }

  function upsertSize(input={},actor={}){
    gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-size'));const name=String(input.name||'').trim();
    if(!name)throw new Error('Nome do tamanho obrigatorio.');
    const maxFlavors=Number(input.maxFlavors??1);if(!Number.isInteger(maxFlavors)||maxFlavors<1||maxFlavors>8)throw new Error('Maximo de sabores invalido.');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    const recipeMultiplier=Number(input.recipeMultiplier??1);if(!Number.isFinite(recipeMultiplier)||recipeMultiplier<=0||recipeMultiplier>20)throw new Error('Fator de consumo do tamanho invalido.');
    const ts=now();
    db.prepare(`INSERT INTO pizza_sizes(id,product_id,name,max_flavors,price_delta_cents,recipe_multiplier,active,created_at,updated_at)
      VALUES(?,?,?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,max_flavors=excluded.max_flavors,price_delta_cents=excluded.price_delta_cents,recipe_multiplier=excluded.recipe_multiplier,active=1,updated_at=excluded.updated_at`)
      .run(id,p.id,name,maxFlavors,delta,recipeMultiplier,ts,ts);
    writeAudit(db,{action:'pizzeria.size.upsert',entity:'pizza-size',entityId:id,actor,context:{productId:p.id,name,maxFlavors,priceDeltaCents:delta,recipeMultiplier}},now);
    return{id,productId:p.id,name,maxFlavors,priceDeltaCents:delta,recipeMultiplier};
  }

  function upsertFlavor(input={},actor={}){
    gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-flavor'));const name=String(input.name||'').trim();
    if(!name)throw new Error('Nome do sabor obrigatorio.');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    const recipeProductId=recipeProduct(input.recipeProductId,'o sabor');
    const ts=now();
    db.prepare(`INSERT INTO pizza_flavors(id,product_id,name,price_delta_cents,recipe_product_id,active,created_at,updated_at)
      VALUES(?,?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,recipe_product_id=excluded.recipe_product_id,active=1,updated_at=excluded.updated_at`)
      .run(id,p.id,name,delta,recipeProductId,ts,ts);
    writeAudit(db,{action:'pizzeria.flavor.upsert',entity:'pizza-flavor',entityId:id,actor,context:{productId:p.id,name,priceDeltaCents:delta,recipeProductId}},now);
    return{id,productId:p.id,name,priceDeltaCents:delta,recipeProductId};
  }

  function upsertCrust(input={},actor={}){
    gate();const p=product(input.productId);const id=String(input.id||idFactory('pizza-crust'));const name=String(input.name||'').trim();
    if(!name)throw new Error('Nome da borda obrigatorio.');
    const delta=assertCents(Number(input.priceDeltaCents??0),'priceDeltaCents');
    const recipeProductId=recipeProduct(input.recipeProductId,'a borda');
    const ts=now();
    db.prepare(`INSERT INTO pizza_crusts(id,product_id,name,price_delta_cents,recipe_product_id,active,created_at,updated_at)
      VALUES(?,?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,name=excluded.name,price_delta_cents=excluded.price_delta_cents,recipe_product_id=excluded.recipe_product_id,active=1,updated_at=excluded.updated_at`)
      .run(id,p.id,name,delta,recipeProductId,ts,ts);
    writeAudit(db,{action:'pizzeria.crust.upsert',entity:'pizza-crust',entityId:id,actor,context:{productId:p.id,name,priceDeltaCents:delta,recipeProductId}},now);
    return{id,productId:p.id,name,priceDeltaCents:delta,recipeProductId};
  }

  function getProfile(productId){
    gate();const p=product(productId);const profile=db.prepare('SELECT * FROM pizza_profiles WHERE product_id=? AND active=1').get(p.id);if(!profile)return null;
    return{
      productId:p.id,pricingPolicy:profile.pricing_policy,
      sizes:db.prepare('SELECT id,name,max_flavors AS maxFlavors,price_delta_cents AS priceDeltaCents,recipe_multiplier AS recipeMultiplier FROM pizza_sizes WHERE product_id=? AND active=1 ORDER BY name,id').all(p.id),
      flavors:db.prepare('SELECT id,name,price_delta_cents AS priceDeltaCents,recipe_product_id AS recipeProductId FROM pizza_flavors WHERE product_id=? AND active=1 ORDER BY name,id').all(p.id),
      crusts:db.prepare('SELECT id,name,price_delta_cents AS priceDeltaCents,recipe_product_id AS recipeProductId FROM pizza_crusts WHERE product_id=? AND active=1 ORDER BY name,id').all(p.id)
    };
  }

  function getPublicProfile(productId){
    const profile=getProfile(productId);if(!profile)return null;
    return{
      pricingPolicy:profile.pricingPolicy,
      sizes:profile.sizes.map(({id,name,maxFlavors,priceDeltaCents})=>({id,name,maxFlavors,priceDeltaCents})),
      flavors:profile.flavors.map(({id,name,priceDeltaCents})=>({id,name,priceDeltaCents})),
      crusts:profile.crusts.map(({id,name,priceDeltaCents})=>({id,name,priceDeltaCents}))
    };
  }

  function pricePizza(input={}){
    gate();const p=product(input.productId);const profile=getProfile(p.id);if(!profile)throw new Error('Perfil de pizzaria nao configurado para o produto.');
    const size=db.prepare('SELECT * FROM pizza_sizes WHERE id=? AND product_id=? AND active=1').get(String(input.sizeId||''),p.id);if(!size)throw new Error('Tamanho de pizza invalido.');
    const ids=(input.flavorIds||[]).map(String);if(!ids.length)throw new Error('Selecione ao menos um sabor.');if(ids.length>size.max_flavors)throw new Error(`Tamanho permite no maximo ${size.max_flavors} sabores.`);
    const flavors=ids.map(id=>{const row=db.prepare('SELECT * FROM pizza_flavors WHERE id=? AND product_id=? AND active=1').get(id,p.id);if(!row)throw new Error(`Sabor de pizza invalido: ${id}.`);return{id:row.id,name:row.name,priceDeltaCents:row.price_delta_cents,recipeProductId:row.recipe_product_id||null,fraction:1/ids.length};});
    let flavorDelta=0;if(profile.pricingPolicy==='HIGHEST_FLAVOR')flavorDelta=Math.max(...flavors.map(f=>f.priceDeltaCents));else flavorDelta=Math.round(flavors.reduce((sum,f)=>sum+f.priceDeltaCents,0)/flavors.length);
    let crust=null;if(input.crustId){const row=db.prepare('SELECT * FROM pizza_crusts WHERE id=? AND product_id=? AND active=1').get(String(input.crustId),p.id);if(!row)throw new Error('Borda de pizza invalida.');crust={id:row.id,name:row.name,priceDeltaCents:row.price_delta_cents,recipeProductId:row.recipe_product_id||null};}
    let additionsDelta=0;let extras=null;
    if(catalogCustomization&&((Array.isArray(input.selections)&&input.selections.length)||(Array.isArray(input.comboSelections)&&input.comboSelections.length))){
      const configured=catalogCustomization.priceConfiguredItem({
        productId:p.id,
        selections:Array.isArray(input.selections)?input.selections:[],
        comboSelections:Array.isArray(input.comboSelections)?input.comboSelections:[]
      });
      extras=configured.configurationSnapshot;
      additionsDelta=configured.unitPriceCents-p.sale_price_cents;
    }
    const unitPriceCents=p.sale_price_cents+size.price_delta_cents+flavorDelta+(crust?.priceDeltaCents||0)+additionsDelta;if(unitPriceCents<0||!Number.isSafeInteger(unitPriceCents))throw new Error('Preco da pizza invalido.');

    const recipeMultiplier=Number(size.recipe_multiplier||1);const stock=new Map();
    expandRecipe(stock,p.id,recipeMultiplier);
    for(const flavor of flavors)if(flavor.recipeProductId)expandRecipe(stock,flavor.recipeProductId,recipeMultiplier*flavor.fraction);
    if(crust?.recipeProductId)expandRecipe(stock,crust.recipeProductId,recipeMultiplier);
    const stockItems=[...stock].sort(([a],[b])=>a.localeCompare(b)).map(([productId,quantity])=>({productId,quantity}));

    return{unitPriceCents,configurationSnapshot:{version:2,productId:p.id,pizza:{
      pricingPolicy:profile.pricingPolicy,
      size:{id:size.id,name:size.name,priceDeltaCents:size.price_delta_cents,maxFlavors:size.max_flavors,recipeMultiplier},
      flavors:flavors.map(({recipeProductId,...safe})=>safe),
      crust:crust?(({recipeProductId,...safe})=>safe)(crust):null,
      extras,
      stockItems
    }}};
  }

  return{upsertProfile,upsertSize,upsertFlavor,upsertCrust,getProfile,getPublicProfile,pricePizza};
}
module.exports={createPizzeriaService};
