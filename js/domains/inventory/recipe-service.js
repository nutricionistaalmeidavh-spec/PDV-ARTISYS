'use strict';

const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('./inventory-rules');

function createRecipeService({db,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db)throw new TypeError('Database is required.');

  function requireProduct(productId){const row=db.prepare('SELECT * FROM products WHERE id=?').get(String(productId));if(!row)throw new Error(`Produto ${productId} nao encontrado no catalogo.`);return row;}

  function getRecipe(productId){
    const recipe=db.prepare('SELECT * FROM product_recipes WHERE product_id=? AND active=1 ORDER BY version DESC LIMIT 1').get(String(productId));if(!recipe)return null;
    const components=db.prepare(`SELECT rc.id,rc.ingredient_product_id AS productId,p.name AS productName,rc.quantity,rc.unit,rc.conversion_factor AS conversionFactor,rc.loss_percent AS lossPercent,p.cost_cents AS costCents,p.track_stock AS trackStock
      FROM recipe_components rc JOIN products p ON p.id=rc.ingredient_product_id WHERE rc.recipe_id=? ORDER BY rc.id`).all(recipe.id);
    return{id:recipe.id,productId:recipe.product_id,version:recipe.version,createdBy:recipe.created_by,createdAt:recipe.created_at,components};
  }

  function setRecipe(productId,input={},actor=null){
    const product=requireProduct(productId);const components=Array.isArray(input.components)?input.components:[];if(!components.length)throw new Error('Ficha tecnica deve possuir ao menos um ingrediente.');
    const ts=now();return withTransaction(db,()=>{
      const last=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM product_recipes WHERE product_id=?').get(product.id)?.version||0);const version=last+1;
      db.prepare('UPDATE product_recipes SET active=0 WHERE product_id=? AND active=1').run(product.id);const id=String(input.id||idFactory('recipe'));
      db.prepare('INSERT INTO product_recipes(id,product_id,version,active,created_by,created_at) VALUES(?,?,?,1,?,?)').run(id,product.id,version,actor?.userId||null,ts);
      const insert=db.prepare('INSERT INTO recipe_components(id,recipe_id,ingredient_product_id,quantity,unit,conversion_factor,loss_percent) VALUES(?,?,?,?,?,?,?)');
      for(const component of components){const ingredient=requireProduct(component.productId);const quantity=Number(component.quantity);const conversion=Number(component.conversionFactor??1);const loss=Number(component.lossPercent??0);if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade de ingrediente invalida.');if(!Number.isFinite(conversion)||conversion<=0)throw new Error('Fator de conversao invalido.');if(!Number.isFinite(loss)||loss<0||loss>=100)throw new Error('Percentual de perda invalido.');insert.run(idFactory('recipe-component'),id,ingredient.id,roundQuantity(quantity),String(component.unit||ingredient.unit||'UN').toUpperCase(),conversion,loss);}
      writeAudit(db,{action:'recipe.set',entity:'product',entityId:product.id,actor,context:{recipeId:id,version,componentCount:components.length}},now);return getRecipe(product.id);
    });
  }

  function expandItems(items=[]){
    const totals=new Map();
    for(const item of items||[]){const quantity=roundQuantity(Number(item.quantity||0));if(quantity<=0)continue;const recipe=getRecipe(item.productId);if(!recipe){totals.set(String(item.productId),roundQuantity((totals.get(String(item.productId))||0)+quantity));continue;}
      for(const component of recipe.components){const multiplier=Number(component.conversionFactor||1)*(1+Number(component.lossPercent||0)/100);const used=roundQuantity(quantity*Number(component.quantity)*multiplier);totals.set(String(component.productId),roundQuantity((totals.get(String(component.productId))||0)+used));}
    }
    return[...totals].map(([productId,quantity])=>({productId,quantity}));
  }

  function theoreticalCostCents(productId){
    const recipe=getRecipe(productId);if(!recipe){return Number(requireProduct(productId).cost_cents||0);}let total=0;
    for(const c of recipe.components){const multiplier=Number(c.conversionFactor||1)*(1+Number(c.lossPercent||0)/100);total+=Number(c.costCents||0)*Number(c.quantity)*multiplier;}
    return Math.max(0,Math.round(total));
  }

  return{getRecipe,setRecipe,expandItems,theoreticalCostCents};
}

module.exports={createRecipeService};
