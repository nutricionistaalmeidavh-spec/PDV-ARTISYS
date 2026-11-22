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
  assert.match(menu,/openTableQr/);
  assert.match(mobile,/api\/v1\/mobile\/pair\/redeem/);
});
