'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

test('a product with active variants cannot be sold as the parent item',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-parent-sale-guard-'));let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  try{
    runtime.catalog.createUser({id:'admin',username:'parent-guard',name:'Admin',role:'admin',password:'senha-forte-123'});
    runtime.catalog.upsertProduct({id:'tang',name:'Tang',salePriceCents:399,costCents:150,trackStock:false});
    runtime.catalogCustomization.upsertVariant({id:'tang-limao',productId:'tang',name:'Limão',priceDeltaCents:0,costCents:150});
    runtime.retail.setProductVariantStock('tang-limao',5);
    runtime.sales.openSale({id:'sale-parent-guard',saleNumber:'G1',terminalId:'PDV-01',operatorId:'admin'});
    assert.throws(()=>runtime.sales.addItem('sale-parent-guard',{productId:'tang',quantity:1}),/possui variacoes/i);
    const sale=runtime.retail.addProductVariantToSale('sale-parent-guard',{variantId:'tang-limao',quantity:1});
    assert.equal(sale.items.length,1);
    assert.equal(sale.items[0].configuration.productVariant.id,'tang-limao');
  }finally{runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('existing parent stock must be resolved before enabling child-stock control',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-parent-stock-migration-'));let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  try{
    runtime.catalog.upsertProduct({id:'coke',name:'Coca-Cola',salePriceCents:500,costCents:250,trackStock:true});
    runtime.inventory.recordMovement({productId:'coke',type:'opening-balance',quantityDelta:4,reason:'fixture'});
    assert.throws(()=>runtime.retail.prepareProductForVariants('coke'),/possui estoque/i);
    assert.equal(runtime.catalog.getProduct('coke').trackStock,true);
  }finally{runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('variant UI observes only canonical route replacements and locks parent stock control',()=>{
  const script=fs.readFileSync(path.join(__dirname,'../desktop/renderer/product-variants-ui.js'),'utf8');
  assert.match(script,/MutationObserver\(scheduleEnhance\)\.observe\(content,\{childList:true\}\)/);
  assert.doesNotMatch(script,/subtree:true/);
  assert.match(script,/data-parent-has-variants/);
  assert.match(script,/checkbox\.disabled=true/);
});
