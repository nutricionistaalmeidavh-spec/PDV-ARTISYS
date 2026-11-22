'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');
const {createMobilePairing}=require('../server/mobile-pairing');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};
const install={'x-pdv-token':'local-qr-token','content-type':'application/json'};
async function login(base,username,password){
  const res=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:install,body:JSON.stringify({username,password,terminalId:'PDV-01'})});
  assert.equal(res.status,200);return(await res.json()).sessionToken;
}
async function call(base,token,url,{method='GET',body}={}){
  return fetch(base+url,{method,headers:{...install,authorization:'Bearer '+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
}
test('P0: QR por mesa preserva token, identifica mesa e nega alterações a caixa/sem login',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-qr-p0-'));
  const dbPath=path.join(dir,'pdv.sqlite');
  const rt=createPdvRuntime({dbPath});
  const server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'local-qr-token',requireTerminalAuth:false});
  try{
    rt.catalog.createUser({id:'admin',username:'qr-admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-forte-123'});
    rt.catalog.createUser({id:'cash',username:'qr-caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-caixa-forte-123'});
    rt.modules.setEnabled('FOOD',true,admin);
    rt.restaurant.upsertTable({id:'qr-mesa-01',label:'Mesa 01',seats:4},admin);
    rt.restaurant.upsertTable({id:'qr-mesa-02',label:'Mesa 02',seats:2},admin);
    const address=await server.start(),base='http://127.0.0.1:'+address.port;
    const owner=await login(base,'qr-admin','senha-admin-forte-123');
    const cash=await login(base,'qr-caixa','senha-caixa-forte-123');
    const url=id=>'/api/v1/restaurant/public-ordering/tables/'+id+'/qr';
    const first=await call(base,owner,url('qr-mesa-01'));assert.equal(first.status,200);
    const q1=await first.json();const again=await(await call(base,owner,url('qr-mesa-01'))).json();
    assert.equal(q1.url,again.url,'Ver QR nao altera o token');
    const q2=await(await call(base,owner,url('qr-mesa-02'))).json();
    assert.notEqual(q1.url,q2.url,'Cada mesa recebe seu token');
    const cashRead=await call(base,cash,url('qr-mesa-01'));
    assert.equal(cashRead.status,200,'Caixa pode visualizar QR sem permissao administrativa');
    assert.equal((await cashRead.json()).url,q1.url,'consulta do Caixa reutiliza token existente');
    assert.equal((await call(base,cash,'/api/v1/restaurant/public-ordering/config',{method:'PUT',body:{autoOpenTable:false}})).status,403);
    assert.equal((await call(base,cash,url('qr-mesa-01')+'/rotate',{method:'POST',body:{}})).status,403);
    const anonymous=await fetch(base+'/api/v1/restaurant/public-ordering/config',{method:'PUT',headers:install,body:'{"autoOpenTable":false}'});
    assert.equal(anonymous.status,401);
    const before=await fetch(q1.url.replace('127.0.0.1:4174','127.0.0.1:'+address.port));
    assert.equal(before.status,200);
    const rotate=await call(base,owner,url('qr-mesa-01')+'/rotate',{method:'POST',body:{}});
    assert.equal(rotate.status,200);
    const changed=await rotate.json();assert.notEqual(changed.url,q1.url);
    assert.equal((await fetch(base+'/api/v1/public/menu/'+q1.url.split('/').at(-1))).status,404);
    assert.equal((await fetch(base+'/api/v1/public/menu/'+changed.url.split('/').at(-1))).status,200);
    const stored=rt.db.prepare('SELECT access_token FROM restaurant_table_qr_access WHERE table_id=?').get('qr-mesa-02').access_token;
    assert.equal(stored,q2.url.split('/').at(-1));
  }finally{await server.stop();rt.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('P0 E2E: QR da mesa abre comanda pelo primeiro pedido e sobrevive reinicio local',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-qr-persist-'));
  const dbPath=path.join(dir,'pdv.sqlite');
  let runtime=createPdvRuntime({dbPath});
  try{
    runtime.catalog.createUser({id:'admin',username:'qr-persist-admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-forte-123'},admin);
    runtime.modules.setEnabled('FOOD',true,admin);
    runtime.catalog.upsertProduct({id:'suco-qr',name:'Suco pelo QR',salePriceCents:1300,menuEnabled:true,active:true,trackStock:false,usageType:'DIRECT'},admin);
    runtime.kitchen.configureProductRoute('suco-qr',{mode:'DIRECT'},admin);
    runtime.restaurant.upsertTable({id:'mesa-reinicia',label:'Mesa Reinicio',seats:4},admin);
    const token=runtime.publicOrdering.issueTableAccess('mesa-reinicia',admin).token;
    assert.equal(runtime.publicOrdering.publicContext(token).table.label,'Mesa Reinicio');
    const initial=runtime.restaurant.currentSession('mesa-reinicia');
    assert.equal(initial,null);
    const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'local-qr-token',requireTerminalAuth:false});
    try{
      const address=await server.start(),base='http://127.0.0.1:'+address.port;
      const context=await fetch(base+'/api/v1/public/menu/'+token);
      assert.equal(context.status,200);
      const placed=await fetch(base+'/api/v1/public/menu/'+token+'/orders',{method:'POST',headers:{'content-type':'application/json','x-mutation-id':'qr-persist-order-01'},body:JSON.stringify({items:[{productId:'suco-qr',quantity:2}]})});
      assert.equal(placed.status,201);
      const order=await placed.json();
      assert.equal(order.order.totalCents,2600);
      assert.equal(runtime.restaurant.currentSession('mesa-reinicia').totalCents,2600);
      assert.equal(runtime.restaurant.currentSession('mesa-reinicia').orders.length,1);
    }finally{await server.stop();}
    runtime.close();runtime=null;
    runtime=createPdvRuntime({dbPath});
    assert.equal(runtime.publicOrdering.issueTableAccess('mesa-reinicia',admin).token,token,'o QR deve ser preservado apos reinicio');
    assert.equal(runtime.publicOrdering.publicContext(token).session.totalCents,2600);
  }finally{runtime?.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('P2: pareamento QR nao carrega credencial permanente no link e so pode ser resgatado uma vez',()=>{
  let now=1000;const pairing=createMobilePairing({now:()=>now,ttlMs:120000});
  const issued=pairing.issue({deviceId:'phone-1',credential:'secret-device-key'});
  assert.match(issued.token,/^[A-Za-z0-9_-]{32,}$/);
  assert.equal(issued.token.includes('secret-device-key'),false);
  assert.deepEqual(pairing.redeem(issued.token),{id:'phone-1',key:'secret-device-key'});
  assert.equal(pairing.redeem(issued.token),null,'token consumido nao pode ser reutilizado');
  const pending=pairing.issue({deviceId:'phone-2',credential:'key-2'});
  now+=120001;assert.equal(pairing.redeem(pending.token),null,'expirou');
  const a=pairing.issue({deviceId:'phone-3',credential:'old-key'});
  const b=pairing.issue({deviceId:'phone-3',credential:'new-key'});
  assert.equal(pairing.redeem(a.token),null,'novo pareamento invalida QR anterior do mesmo dispositivo');
  assert.deepEqual(pairing.redeem(b.token),{id:'phone-3',key:'new-key'});
});

test('P1/P2: controles de quantidade, QR operacional e mobile one-time ligados ao renderer',()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
  const app=read('desktop/renderer/app.js');
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  const menu=read('desktop/renderer/restaurant-public-ordering-ui.js');
  const mobile=read('server/mobile/app.js');
  assert.match(app,/data-configured-qty-input/);
  assert.match(app,/updateConfiguredSaleItemQuantity/);
  assert.match(restaurant,/data-open-table-qr/);
  assert.ok(restaurant.includes('PdvRestaurantPublicOrderingUi?.openTableQr?.(table.id,table.label)'), 'botao QR chama modulo publico operacional');
  assert.ok(!restaurant.includes('.mount?.openTableQr'), 'nao encadear QR no mount de configuracoes');
  assert.match(restaurant,/settings:select/,'atalho usa evento semantico de categoria');
  assert.ok(!restaurant.includes('PdvSettingsHub?.mount?.selectCategory'), 'mount nao tem selectCategory');
  assert.ok(read('desktop/renderer/settings-hub-ui.js').includes("lifecycle.on('settings:select'"), 'atalho usa evento do hub');
  assert.match(menu,/openTableQr/);
  assert.match(mobile,/api\/v1\/mobile\/pair\/redeem/);
});

test('P2 HTTP: QR faz pareamento real de garcom na LAN, sem credencial no codigo e sem reutilizacao',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});
  const server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'local-qr-token',requireTerminalAuth:false});
  try{
    rt.catalog.createUser({id:'admin',username:'pair-admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-forte-123'},admin);
    rt.catalog.createUser({id:'cash',username:'pair-cash',name:'Caixa',profileId:'profile-cashier',password:'senha-caixa-forte-123'},admin);
    rt.modules.setEnabled('FOOD',true,admin);
    const address=await server.start(),base='http://127.0.0.1:'+address.port;
    const owner=await login(base,'pair-admin','senha-admin-forte-123');
    const cash=await login(base,'pair-cash','senha-caixa-forte-123');
    let response=await call(base,owner,'/api/v1/restaurant/devices',{method:'POST',body:{name:'iPhone QA',deviceType:'WAITER'}});
    assert.equal(response.status,201);
    const device=await response.json();
    const path='/api/v1/restaurant/devices/pairing-qr';
    const input={deviceId:device.id,credential:device.credential,host:'127.0.0.1',port:address.port};
    response=await call(base,cash,path,{method:'POST',body:input});
    assert.equal(response.status,403);
    response=await call(base,owner,path,{method:'POST',body:input});
    assert.equal(response.status,201);
    const qr=await response.json();
    assert.match(qr.url,/\/mobile#pair=/);
    assert.equal(qr.url.includes(device.credential),false);
    assert.equal(qr.qrSvg.includes(device.credential),false);
    const token=new URL(qr.url).hash.replace(/^#pair=/,'');
    response=await fetch(base+'/api/v1/mobile/pair/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{id:device.id,key:device.credential});
    response=await fetch(base+'/api/v1/mobile/context',{headers:{'x-device-id':device.id,'x-device-key':device.credential}});
    assert.equal(response.status,200);
    response=await fetch(base+'/api/v1/mobile/pair/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
    assert.equal(response.status,410);
    const next=await call(base,owner,path,{method:'POST',body:input});
    assert.equal(next.status,201);
    const oldToken=new URL((await next.json()).url).hash.slice(6);
    response=await call(base,owner,'/api/v1/restaurant/devices/'+device.id+'/rotate',{method:'POST',body:{}});
    assert.equal(response.status,200);
    response=await fetch(base+'/api/v1/mobile/pair/redeem',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:oldToken})});
    assert.equal(response.status,410);
  }finally{await server.stop();rt.close();}
});
