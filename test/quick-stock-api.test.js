'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function fixture(){
  const runtime=createPdvRuntime({dbPath:':memory:'});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'quick-installation'});
  const address=await server.start();
  const url=`http://${address.host}:${address.port}`;
  const setup=await fetch(url+'/api/v1/setup/admin',{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'quick-installation'},body:JSON.stringify({username:'admin',name:'Admin',password:'senha-forte-123'})});
  assert.equal(setup.status,201);
  const login=await fetch(url+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'quick-installation'},body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-01'})});
  assert.equal(login.status,200);
  const session=(await login.json()).sessionToken;
  return {
    runtime,server,url,session,
    async post(body,id='quick-mutation-test'){
      const response=await fetch(url+'/api/v1/products/quick',{method:'POST',headers:{authorization:'Bearer '+session,'content-type':'application/json','x-mutation-id':id},body:JSON.stringify(body)});
      const data=await response.json();return{status:response.status,data};
    },
    async close(){await server.stop();runtime.close();}
  };
}

test('API cadastra item pronto em uma operação e repetir token não duplica movimento',async()=>{
  const f=await fixture();
  try{
    const body={name:'Água 500 ml',salePrice:'5,00',openingQuantity:'8',publish:true,kind:'READY'};
    const first=await f.post(body,'stock-mutation-1');
    assert.equal(first.status,201,JSON.stringify(first.data));
    assert.equal(first.data.availableForSale,true);
    assert.equal(first.data.stockQuantity,8);
    assert.equal(first.data.product.menuEnabled,true);
    const repeated=await f.post(body,'stock-mutation-1');
    assert.equal(repeated.status,201,JSON.stringify(repeated.data));
    assert.equal(repeated.data.product.id,first.data.product.id);
    assert.equal(f.runtime.inventory.listMovements({productId:first.data.product.id}).length,1);
    assert.equal(f.runtime.inventory.getBalance(first.data.product.id),8);
  }finally{await f.close();}
});

test('API não publica produto sem saldo e não cria cadastro de item preparado por engano',async()=>{
  const f=await fixture();
  try{
    const stored=await f.post({name:'Cigarro',salePrice:'13,50',openingQuantity:'0',publish:false,kind:'READY'},'zero-stock');
    assert.equal(stored.status,201,JSON.stringify(stored.data));
    assert.equal(stored.data.published,false);
    assert.equal(stored.data.availableForSale,false);
    const rejected=await f.post({name:'Sem saldo',salePrice:'2,00',openingQuantity:'0',publish:true},'invalid-zero');
    assert.ok(rejected.status>=400,JSON.stringify(rejected));
    const prepared=await f.post({name:'Porção frita',salePrice:'19,00',openingQuantity:'5',kind:'PREPARED',publish:true},'prepared');
    assert.ok(prepared.status>=400,JSON.stringify(prepared));
    assert.equal(f.runtime.catalog.listProducts().length,1);
  }finally{await f.close();}
});

test('falha no destino do KDS desfaz produto, movimento e publicação',async()=>{
  const f=await fixture();
  const original=f.runtime.kitchen.configureProductRoute;
  try{
    f.runtime.modules.setEnabled('FOOD',true,{kind:'system',id:'system'});
    f.runtime.kitchen.configureProductRoute=()=>{throw new Error('Falha de destino simulada');};
    const fail=await f.post({name:'Petisco pronto',salePrice:'10,00',openingQuantity:'3',publish:true,kind:'READY'},'route-failure');
    assert.ok(fail.status>=400,JSON.stringify(fail));
    assert.equal(f.runtime.catalog.listProducts().length,0);
    assert.equal(f.runtime.inventory.listMovements({}).length,0);
  }finally{f.runtime.kitchen.configureProductRoute=original;await f.close();}
});
