'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {renderSaleReceipt,weightedReceiptDetails}=require('../js/domains/printing/receipt-renderer');

test('weighted receipt details preserve measured weight and price per KG',()=>{
  const item={productName:'Tomate',quantity:0.742,unitPriceCents:899,totalCents:667,configuration:{weight:{grams:742,source:'SCALE',unit:'KG'}}};
  assert.deepEqual(weightedReceiptDetails(item),['Peso: 0,742 kg x R$ 8,99/kg']);
});

test('non-fiscal receipt prints weight and price basis for weighted item',()=>{
  const text=renderSaleReceipt({storeName:'ArtiSys',documentLabel:'CUPOM NAO FISCAL',sale:{
    id:'weighted-sale',saleNumber:'W-1',operatorId:'u1',subtotalCents:667,totalCents:667,discountCents:0,changeCents:0,
    items:[{productName:'Tomate',quantity:0.742,unitPriceCents:899,totalCents:667,configuration:{weight:{grams:742,source:'SCALE',unit:'KG'}}}],
    payments:[{method:'CASH',amountCents:667}]
  },width:42});
  assert.match(text,/Tomate/);
  assert.match(text,/Peso: 0,742 kg x R\$ 8,99\/kg/);
  assert.match(text,/CUPOM NAO FISCAL/);
});

test('weighted receipt supports products priced per gram',()=>{
  const item={productName:'Tempero',quantity:250,unitPriceCents:5,totalCents:1250,configuration:{weight:{grams:250,source:'MANUAL',unit:'G'}}};
  assert.deepEqual(weightedReceiptDetails(item),['Peso: 250 g x R$ 0,05/g']);
});
