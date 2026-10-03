'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createCheckoutDocumentRouter}=require('../server/checkout-document-router');

function responseCapture(){
  return{
    statusCode:null,
    headers:null,
    body:'',
    writeHead(statusCode,headers){this.statusCode=statusCode;this.headers=headers;},
    end(chunk=''){this.body+=String(chunk||'');}
  };
}

function request(query){
  const req=Readable.from([]);
  req.url=`/api/v1/checkout/documents?query=${encodeURIComponent(query)}`;
  req.method='GET';
  req.headers={host:'localhost',authorization:'Bearer test-token'};
  return req;
}

async function search(router,query){
  const res=responseCapture();
  assert.equal(await router(request(query),res),true);
  assert.equal(res.statusCode,200);
  return JSON.parse(res.body);
}

function fixture(){
  const session={
    id:'session-1',
    status:'OPEN',
    totalCents:4200,
    checkoutSaleId:null,
    openedAt:'2026-10-03T12:00:00.000Z'
  };
  const order={
    id:'order-1',
    orderNumber:'ATC-0041',
    customerName:'Cliente Alfa',
    status:'CONFIRMED',
    createdAt:'2026-10-03T13:00:00.000Z',
    items:[{pendingQuantity:2,unitPriceCents:1500}]
  };
  const runtime={
    sales:{getSale:id=>({
      'sale-delivery':{id:'sale-delivery',status:'OPEN',totalCents:5400,items:[{productId:'p1',quantity:2}]},
      'sale-fast':{id:'sale-fast',status:'OPEN',totalCents:2300,items:[{productId:'p2',quantity:1}]}
    })[id]||null},
    modules:{isEnabled:name=>name==='FOOD'||name==='WHOLESALE'},
    restaurant:{
      listTables:()=>[{id:'table-1',label:'Setor A',sessionId:session.id}],
      getSession:id=>id===session.id?session:null
    },
    orders:{
      listOrders:({origin}={})=>origin==='WHOLESALE'?[order]:[],
      prepareCheckout(){throw new Error('not used by search tests');}
    },
    delivery:{
      list:()=>[{id:'delivery-1',saleId:'sale-delivery',customerName:'Cliente Beta',fulfillmentType:'DELIVERY',status:'PREPARING',createdAt:'2026-10-03T13:30:00.000Z'}],
      get:id=>id==='delivery-1'?{id:'delivery-1',saleId:'sale-delivery',customerName:'Cliente Beta',fulfillmentType:'DELIVERY',status:'PREPARING',createdAt:'2026-10-03T13:30:00.000Z'}:null
    },
    fastFood:{
      list:()=>[{id:'fast-1',saleId:'sale-fast',dailyNumber:27,status:'READY',createdAt:'2026-10-03T13:40:00.000Z'}],
      get:id=>id==='fast-1'?{id:'fast-1',saleId:'sale-fast',dailyNumber:27,status:'READY',createdAt:'2026-10-03T13:40:00.000Z'}:null
    }
  };
  const sessionStore=new Map([['test-token',{
    userId:'user-1',
    role:'cashier',
    terminalId:'terminal-1',
    expiresAt:Date.now()+60_000
  }]]);
  return createCheckoutDocumentRouter({runtime,sessionStore});
}

test('checkout document search accepts tolerant command type terms',async()=>{
  const router=fixture();

  for(const term of ['mesa','mesas','comanda','comandas']){
    const rows=await search(router,term);
    assert.equal(rows.length,1,term);
    assert.equal(rows[0].type,'COMMAND',term);
  }
});

test('checkout document search accepts tolerant wholesale type terms',async()=>{
  const router=fixture();

  for(const term of ['atacado','pedido','pedidos','pedido atacado','pedidos de atacado']){
    const rows=await search(router,term);
    assert.equal(rows.length,1,term);
    assert.equal(rows[0].type,'ORDER',term);
  }
});

test('checkout document search combines type aliases with free-text terms',async()=>{
  const router=fixture();

  assert.equal((await search(router,'comanda setor a'))[0]?.type,'COMMAND');
  assert.equal((await search(router,'atacado cliente alfa'))[0]?.type,'ORDER');
});

test('checkout document search keeps existing identifier and customer matching',async()=>{
  const router=fixture();

  assert.equal((await search(router,'ATC-0041'))[0]?.type,'ORDER');
  assert.equal((await search(router,'Cliente Alfa'))[0]?.type,'ORDER');
  assert.equal((await search(router,'Setor A'))[0]?.type,'COMMAND');
});

test('checkout document search includes delivery and fast-food aliases without stealing generic wholesale pedido terms',async()=>{
  const router=fixture();

  assert.equal((await search(router,'delivery cliente beta'))[0]?.type,'DELIVERY');
  assert.equal((await search(router,'retirada cliente beta')).length,0);
  assert.equal((await search(router,'senha 27'))[0]?.type,'FAST_FOOD');
  const generic=await search(router,'pedido');
  assert.equal(generic.length,1);
  assert.equal(generic[0].type,'ORDER');
});

test('checkout opens existing canonical delivery and fast-food sales',async()=>{
  const router=fixture();
  for(const [path,type,saleId] of [
    ['/api/v1/checkout/documents/delivery/delivery-1/open','DELIVERY','sale-delivery'],
    ['/api/v1/checkout/documents/fast-food/fast-1/open','FAST_FOOD','sale-fast']
  ]){
    const req=Readable.from([]);
    req.url=path;req.method='POST';req.headers={host:'localhost',authorization:'Bearer test-token'};
    const res=responseCapture();
    assert.equal(await router(req,res),true);
    assert.equal(res.statusCode,200);
    const payload=JSON.parse(res.body);
    assert.equal(payload.type,type);
    assert.equal(payload.sale.id,saleId);
    assert.equal(payload.sale.status,'OPEN');
  }
});
