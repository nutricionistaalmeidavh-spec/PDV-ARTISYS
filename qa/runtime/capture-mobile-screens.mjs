import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const { createServerFromEnvironment }=require('../../server/start.js');
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const out=path.join(root,'qa-artifacts','all-screens-mobile');
await fs.rm(out,{recursive:true,force:true});
await fs.mkdir(out,{recursive:true});
const dbPath=path.join(out,'mobile-capture.sqlite');
const service=createServerFromEnvironment({
  ...process.env,
  PDV_HOST:'127.0.0.1',
  PDV_PORT:'4174',
  PDV_DB_PATH:dbPath,
  PDV_APP_VERSION:'1.4.23'
},root);
await service.start();

const actor={userId:'qa-admin',role:'admin'};
service.runtime.catalog.createUser({id:'qa-admin',username:'qaadmin',name:'QA Administrador',role:'admin',password:'QaLocalOnly-12345!',active:true});

const base='http://127.0.0.1:4174';
const loginRes=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'qaadmin',password:'QaLocalOnly-12345!',terminalId:'PDV-01'})});
if(!loginRes.ok)throw new Error('Login QA falhou: '+loginRes.status+' '+await loginRes.text());
const login=await loginRes.json();
const token=login.token||login.sessionToken;
if(!token)throw new Error('Token de sessão não retornado.');
let seq=0;
const headers=()=>({'content-type':'application/json','authorization':'Bearer '+token,'x-mutation-id':'qa-mobile-'+(++seq)});
async function api(p,{method='GET',body}={}){
  const opts={method,headers:headers()};if(body!==undefined)opts.body=JSON.stringify(body);
  const res=await fetch(base+p,opts);let data={};try{data=await res.json();}catch{}
  if(!res.ok)throw new Error(method+' '+p+' -> '+res.status+' '+JSON.stringify(data));
  return data;
}
for(const [id,name,price] of [
  ['qa-x-tudo','X-Tudo',2790],
  ['qa-batata','Batata frita',1490],
  ['qa-coca','Coca-Cola 350 ml',600]
])await api('/api/v1/products',{method:'POST',body:{id,sku:id.toUpperCase(),name,salePriceCents:price,costCents:Math.round(price*.3),trackStock:false,active:true}});
for(const moduleId of ['RESTAURANT','SELF_SERVICE'])await api('/api/v1/settings/modules.'+moduleId+'.enabled',{method:'PUT',body:{value:true,scope:'global'}});
const table=await api('/api/v1/restaurant/tables',{method:'POST',body:{id:'qa-table-01',label:'Mesa 01',seats:4}});
const station=await api('/api/v1/restaurant/kitchen/stations',{method:'POST',body:{id:'qa-kitchen',name:'Cozinha'}});
await api('/api/v1/restaurant/kitchen/assignments',{method:'POST',body:{productId:'qa-x-tudo',stationId:station.id}});
const session=await api('/api/v1/restaurant/tables/'+encodeURIComponent(table.id)+'/open',{method:'POST',body:{operatorId:'qa-admin'}});
await api('/api/v1/restaurant/sessions/'+encodeURIComponent(session.id)+'/orders',{method:'POST',body:{operatorId:'qa-admin',items:[{productId:'qa-x-tudo',quantity:1,note:'Sem cebola'}]}});
await api('/api/v1/vertical/self-service/public-ordering/menu/qa-x-tudo',{method:'PATCH',body:{description:'Pão, carne, queijo, bacon, ovo, alface e tomate.',visible:true,sortOrder:1}});
await api('/api/v1/vertical/self-service/public-ordering/menu/qa-batata',{method:'PATCH',body:{description:'Batatas crocantes, porção individual.',visible:true,sortOrder:2}});
await api('/api/v1/vertical/self-service/public-ordering/menu/qa-coca',{method:'PATCH',body:{description:'Lata 350 ml gelada.',visible:true,sortOrder:3}});
const waiter=await api('/api/v1/restaurant/devices',{method:'POST',body:{name:'Garçom QA',deviceType:'WAITER',userId:'qa-admin'}});
const kitchen=await api('/api/v1/restaurant/devices',{method:'POST',body:{name:'Cozinha QA',deviceType:'KITCHEN'}});
const tablet=await api('/api/v1/restaurant/devices',{method:'POST',body:{name:'Tablet Mesa 01',deviceType:'TABLET',tableId:table.id}});
const selfDevice=await api('/api/v1/restaurant/devices',{method:'POST',body:{name:'Autoatendimento QA',deviceType:'SELF_SERVICE'}});
await api('/api/v1/vertical/self-service/devices/'+encodeURIComponent(selfDevice.id),{method:'PUT',body:{mode:'PICKUP',operatorId:'qa-admin'}});
const qr=await api('/api/v1/vertical/self-service/public-ordering/tables/'+encodeURIComponent(table.id)+'/qr?host=127.0.0.1&port=4174');

const manifest={generatedAt:new Date().toISOString(),screens:[],errors:[]};
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
async function shot(p,name){
  const file=path.join(out,String(manifest.screens.length+1).padStart(2,'0')+'-'+name+'.png');
  await p.screenshot({path:file,fullPage:true});manifest.screens.push({name,file:path.basename(file)});
}
async function device(name,cred){
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();
  await p.goto(base+'/mobile',{waitUntil:'domcontentloaded'});
  await p.evaluate(d=>{localStorage.setItem('artisys.deviceId',d.id);localStorage.setItem('artisys.deviceKey',d.credential);},cred);
  await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForSelector('.staff-head',{timeout:15000});
  await p.waitForTimeout(400);await shot(p,name);await ctx.close();
}
{
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();await p.goto(base+'/mobile',{waitUntil:'domcontentloaded'});
  await p.waitForSelector('.login-shell',{timeout:15000});await shot(p,'equipe-login');await ctx.close();
}
{
  const ctx=await browser.newContext({viewport:{width:390,height:844}});
  const p=await ctx.newPage();await p.goto(qr.url,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#products',{timeout:15000});await p.waitForTimeout(400);await shot(p,'cliente-cardapio-mesa');
  const add=p.locator('.add-button').first();
  if(await add.isVisible().catch(()=>false)){
    await add.click();await p.waitForTimeout(250);await shot(p,'cliente-cardapio-carrinho');
    await p.locator('#review-cart').click();await p.locator('#cart-dialog').waitFor({state:'visible'});await shot(p,'cliente-revisar-pedido');
    await p.locator('#send-order').click();await p.waitForTimeout(700);await shot(p,'cliente-pedido-enviado');
  }
  await ctx.close();
}
await device('garcom',waiter);
await device('cozinha-kds',kitchen);
await device('tablet-mesa',tablet);
await device('autoatendimento-dispositivo',selfDevice);
await browser.close();
await service.stop();
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify(manifest,null,2));
