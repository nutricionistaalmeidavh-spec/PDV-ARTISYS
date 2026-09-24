'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createReceiptRouter}=require('../server/receipt-router');

function settings(values={}) {
  return {
    get:(key,{defaultValue})=>Object.hasOwn(values,key)?values[key]:defaultValue,
    set(){}
  };
}

function responseCapture(){
  return {
    headersSent:false,statusCode:null,headers:null,body:'',
    writeHead(statusCode,headers){this.statusCode=statusCode;this.headers=headers;this.headersSent=true;},
    end(chunk=''){this.body+=String(chunk||'');}
  };
}

function request(url){return {method:'GET',url,headers:{authorization:'Bearer session-1'},async *[Symbol.asyncIterator](){}};}

function completedSale(){return {
  id:'sale-1',saleNumber:'V-001',status:'COMPLETED',completedAt:'2026-09-24T12:00:00.000Z',
  operatorName:'Operador',sellerName:'Vendedor',customerName:'Cliente',
  subtotalCents:1000,discountCents:0,totalCents:1000,changeCents:0,
  items:[{productName:'Produto',quantity:1,unitPriceCents:1000,totalCents:1000}],
  payments:[{method:'CASH',amountCents:1000}]
};}

test('receipt endpoint prefers the immutable original queued snapshot over current settings',async()=>{
  const original={
    id:'print-original',type:'SALE_RECEIPT',entityType:'sale',entityId:'sale-1',width:32,
    payload:{text:'RECIBO ORIGINAL 58MM',paperMm:58,logoDataUrl:null,saleNumber:'V-001'}
  };
  const runtime={
    sales:{getSaleDetails:()=>completedSale()},
    settings:settings({'printing.paperMm':80,'printing.columnsMode':'auto','store.name':'Loja Alterada'}),
    printing:{getOriginalSaleReceipt:saleId=>saleId==='sale-1'?original:null}
  };
  const sessions=new Map([['session-1',{userId:'cashier-1',role:'cashier',expiresAt:Date.now()+60_000}]]);
  const route=createReceiptRouter({runtime,sessionStore:sessions,env:{}});
  const res=responseCapture();
  assert.equal(await route(request('/api/v1/sales/sale-1/receipt'),res),true);
  assert.equal(res.statusCode,200);
  const payload=JSON.parse(res.body);
  assert.deepEqual(payload,{saleId:'sale-1',saleNumber:'V-001',width:32,paperMm:58,text:'RECIBO ORIGINAL 58MM',logoDataUrl:null});
});

test('receipt endpoint falls back to live projection before the print side effect is drained',async()=>{
  const runtime={
    sales:{getSaleDetails:()=>completedSale()},
    settings:settings({'printing.paperMm':80,'printing.columnsMode':'auto','store.name':'Loja Atual'}),
    printing:{getOriginalSaleReceipt:()=>null}
  };
  const sessions=new Map([['session-1',{userId:'cashier-1',role:'cashier',expiresAt:Date.now()+60_000}]]);
  const route=createReceiptRouter({runtime,sessionStore:sessions,env:{}});
  const res=responseCapture();
  await route(request('/api/v1/sales/sale-1/receipt'),res);
  assert.equal(res.statusCode,200);
  const payload=JSON.parse(res.body);
  assert.equal(payload.saleId,'sale-1');
  assert.equal(payload.paperMm,80);
  assert.equal(payload.width,48);
  assert.match(payload.text,/Loja Atual/);
});
