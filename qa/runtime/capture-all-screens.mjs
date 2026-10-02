import { _electron as electron, chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const out=path.join(root,'qa-artifacts','all-screens');
const desktopDir=path.join(out,'desktop');
const mobileDir=path.join(out,'mobile');
await fs.rm(out,{recursive:true,force:true});
await fs.mkdir(desktopDir,{recursive:true});
await fs.mkdir(mobileDir,{recursive:true});

const manifest={generatedAt:new Date().toISOString(),source:'main + temporary QA-only capture script',desktop:[],mobile:[],errors:[]};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const safeName=value=>String(value).replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'');

const app=await electron.launch({
  args:[path.join(root,'desktop/main.cjs'),'--no-sandbox'],
  executablePath:path.join(root,'node_modules/electron/dist/electron'),
  cwd:root,
  env:{
    ...process.env,
    NODE_ENV:'test',
    ARTISYS_QA:'1',
    ARTISYS_QA_AUTO_ADMIN:'1',
    ARTISYS_QA_AUTO_LOCAL:'1',
    ARTISYS_QA_SIMULATE_PRINTER:'1',
    ARTISYS_QA_NO_PRINTERS:'1',
    PDV_ENABLE_LAN:'true',
    PDV_LAN_HOST:'127.0.0.1',
    PDV_LAN_PORT:'4174',
    PDV_AUTO_PRINT:'false'
  },
  timeout:30000
});
const page=await app.firstWindow();
await page.setViewportSize({width:1440,height:900}).catch(()=>{});
page.setDefaultTimeout(15000);

async function shotDesktop(name){
  const file=path.join(desktopDir,Math.max(1,manifest.desktop.length+1).toString().padStart(2,'0')+'-'+safeName(name)+'.png');
  await page.screenshot({path:file,fullPage:true});
  manifest.desktop.push({name,file:path.relative(out,file)});
}
async function shotMobile(p,name){
  const file=path.join(mobileDir,Math.max(1,manifest.mobile.length+1).toString().padStart(2,'0')+'-'+safeName(name)+'.png');
  await p.screenshot({path:file,fullPage:true});
  manifest.mobile.push({name,file:path.relative(out,file)});
}
async function visibleClick(selector){
  const list=page.locator(selector);
  const count=await list.count();
  for(let i=0;i<count;i++){const item=list.nth(i);if(await item.isVisible().catch(()=>false)){await item.click();return true;}}
  return false;
}
async function captureDesktop(name,fn){
  try{if(fn)await fn();await sleep(450);await shotDesktop(name);}
  catch(error){manifest.errors.push({screen:name,error:String(error?.message||error)});try{await shotDesktop(name+'-erro');}catch{}}
}
async function desktopApi(apiPath,method='GET',body=undefined){
  const result=await page.evaluate(async input=>{
    const token=sessionStorage.getItem('artisys.sessionToken')||null;
    return window.artisysDesktop.apiRequest({path:input.path,method:input.method,body:input.body,sessionToken:token});
  },{path:apiPath,method,body});
  if(!result?.ok)throw new Error((result?.payload&&result.payload.error)||('HTTP '+result?.status+' em '+apiPath));
  return result.payload;
}
async function tryApi(apiPath,method='GET',body=undefined){
  try{return await desktopApi(apiPath,method,body);}catch(error){manifest.errors.push({api:apiPath,error:String(error.message||error)});return null;}
}
async function goHome(){
  if(!await visibleClick("#sidebar-nav [data-route='home']"))await visibleClick("[data-route='home']");
  await sleep(250);
}
async function goHomeTile(route){
  await goHome();
  if(!await visibleClick("[data-home-route='"+route+"']"))throw new Error('Home tile não encontrado: '+route);
}
async function goSidebar(route){
  if(!await visibleClick("#sidebar-nav [data-route='"+route+"']")&&!await visibleClick("[data-route='"+route+"']"))throw new Error('Rota não encontrada: '+route);
}
async function goHub(hub,target){
  await goSidebar(hub);await sleep(250);
  if(!await visibleClick("[data-flow-route='"+target+"']"))throw new Error('Subrota não encontrada: '+target);
}
async function closeModal(){await visibleClick('#modal-root [data-close-modal]');await sleep(150);}

await page.locator('#auth-overlay').waitFor({state:'visible'});
await shotDesktop('login');
await page.locator("#login-form input[name='username']").fill('qaadmin');
await page.locator("#login-form input[name='password']").fill('QaLocalOnly-12345!');
await page.locator("#login-form button[type='submit']").click();
await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});
await sleep(1300);

if(await page.locator('#onboarding-form').isVisible().catch(()=>false)){
  await shotDesktop('configuracao-inicial');
  await page.locator("#onboarding-form input[name='businessName']").fill('ArtiSys Restaurante Demo');
  const toggles=page.locator("#onboarding-form input[name='moduleIds']");
  for(let i=0;i<await toggles.count();i++){const t=toggles.nth(i);if(!await t.isChecked())await t.check();}
  await page.locator("#onboarding-form button[type='submit']").click();
  await page.locator('.home-grid').waitFor({state:'visible',timeout:15000});
}

for(const [id,name,price,cost] of [
  ['qa-x-tudo','X-Tudo',2790,842],
  ['qa-batata','Batata frita',1490,430],
  ['qa-coca','Coca-Cola 350 ml',600,280]
]){
  await tryApi('/api/v1/products','POST',{id,sku:id.toUpperCase(),name,salePriceCents:price,costCents:cost,trackStock:false,active:true});
}
await tryApi('/api/v1/customers','POST',{id:'qa-cliente',name:'Cliente Demonstração',phone:'16999999999',active:true});

for(const moduleId of ['RESTAURANT','PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY','RETAIL','SERVICES','SELF_SERVICE']){
  await tryApi('/api/v1/settings/modules.'+moduleId+'.enabled','PUT',{value:true,scope:'global'});
}

const table=await tryApi('/api/v1/restaurant/tables','POST',{id:'qa-table-01',label:'Mesa 01',seats:4});
const station=await tryApi('/api/v1/restaurant/kitchen/stations','POST',{id:'qa-kitchen',name:'Cozinha'});
if(station?.id)await tryApi('/api/v1/restaurant/kitchen/assignments','POST',{productId:'qa-x-tudo',stationId:station.id});
let session=null;
if(table?.id)session=await tryApi('/api/v1/restaurant/tables/'+encodeURIComponent(table.id)+'/open','POST',{operatorId:'qa-admin'});
if(session?.id)await tryApi('/api/v1/restaurant/sessions/'+encodeURIComponent(session.id)+'/orders','POST',{operatorId:'qa-admin',items:[{productId:'qa-x-tudo',quantity:1,note:'Sem cebola'}]});
await tryApi('/api/v1/vertical/self-service/public-ordering/menu/qa-x-tudo','PATCH',{description:'Pão, carne, queijo, bacon, ovo, alface e tomate.',visible:true,sortOrder:1});
await tryApi('/api/v1/vertical/self-service/public-ordering/menu/qa-batata','PATCH',{description:'Batatas crocantes, porção individual.',visible:true,sortOrder:2});
await tryApi('/api/v1/vertical/self-service/public-ordering/menu/qa-coca','PATCH',{description:'Lata 350 ml gelada.',visible:true,sortOrder:3});

const waiter=await tryApi('/api/v1/restaurant/devices','POST',{name:'Garçom QA',deviceType:'WAITER',userId:'qa-admin'});
const kitchen=await tryApi('/api/v1/restaurant/devices','POST',{name:'Cozinha QA',deviceType:'KITCHEN'});
const tablet=await tryApi('/api/v1/restaurant/devices','POST',{name:'Tablet Mesa 01',deviceType:'TABLET',tableId:table?.id||null});
const selfDevice=await tryApi('/api/v1/restaurant/devices','POST',{name:'Autoatendimento QA',deviceType:'SELF_SERVICE'});
if(selfDevice?.id)await tryApi('/api/v1/vertical/self-service/devices/'+encodeURIComponent(selfDevice.id),'PUT',{mode:'PICKUP',operatorId:'qa-admin'});

let qr=null;
if(table?.id)qr=await tryApi('/api/v1/vertical/self-service/public-ordering/tables/'+encodeURIComponent(table.id)+'/qr?host=127.0.0.1&port=4174');

await page.reload({waitUntil:'domcontentloaded'});
await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000}).catch(()=>{});
await sleep(1400);

await captureDesktop('inicio',goHome);
await captureDesktop('balcao',()=>goHomeTile('checkout'));
await captureDesktop('clientes',()=>goHomeTile('customers'));
await captureDesktop('cliente-novo',async()=>{await goHomeTile('customers');await visibleClick('#new-customer');await page.locator('#customer-form').waitFor({state:'visible'});});
await closeModal();
await captureDesktop('cardapio',()=>goHomeTile('products'));
await captureDesktop('cardapio-novo-item',async()=>{await goHomeTile('products');await visibleClick('#new-product');await page.locator('#product-form').waitFor({state:'visible'});});
await closeModal();
await captureDesktop('cardapio-nova-categoria',async()=>{await goHomeTile('products');await visibleClick('#new-category');await page.locator('#category-form').waitFor({state:'visible'});});
await closeModal();
await captureDesktop('estoque',()=>goHomeTile('inventory'));
for(const [key,name] of [['purchases','estoque-compras'],['logistics','estoque-logistica'],['orders','estoque-pedidos']]){
  await captureDesktop(name,async()=>{await goHomeTile('inventory');await page.locator('#enterprise-depth-entry').waitFor({state:'visible'});await visibleClick("#enterprise-depth-entry [data-open='"+key+"']");});
}
await captureDesktop('caixa',()=>goHomeTile('cash'));
await captureDesktop('hub-vendas-devolucoes',()=>goSidebar('post-sale'));
await captureDesktop('ultimas-vendas',()=>goHub('post-sale','sales'));
await captureDesktop('devolucoes',()=>goHub('post-sale','returns'));
await captureDesktop('hub-cardapio-estoque',()=>goSidebar('catalog'));
await captureDesktop('hub-gestao-financeira',()=>goSidebar('financial-management'));
await captureDesktop('gestao-dre',()=>goHub('financial-management','management'));
await captureDesktop('financeiro',()=>goHub('financial-management','finance'));
await captureDesktop('relatorios',()=>goHub('financial-management','reports'));
await captureDesktop('equipe-acessos',()=>goSidebar('sellers'));

await captureDesktop('configuracoes-empresa',async()=>{await goSidebar('settings');await page.locator("[data-settings-category='company']").click();});
for(const [cat,name] of [['team','configuracoes-equipe'],['units','configuracoes-unidades-dispositivos'],['printing','configuracoes-impressao-perifericos'],['fiscal','configuracoes-fiscal'],['modules','configuracoes-modulos'],['privacy','configuracoes-privacidade-telemetria'],['diagnostics','configuracoes-diagnostico-backup']]){
  await captureDesktop(name,async()=>{await goSidebar('settings');await page.locator("[data-settings-category='"+cat+"']").click();});
}
await captureDesktop('configuracoes-modulos-expandido',async()=>{await goSidebar('settings');await page.locator("[data-settings-category='modules']").click();await page.locator('#ops-load-establishment-modules').click();await page.locator('[data-module-toggle]').first().waitFor({state:'visible'});});
await captureDesktop('acesso-mobile-qr',async()=>{await goSidebar('settings');await page.locator("[data-settings-category='modules']").click();if(await page.locator('#ops-load-establishment-modules').isVisible())await page.locator('#ops-load-establishment-modules').click();await page.locator('#e53-access-card').click();});
await captureDesktop('perifericos-diagnostico',async()=>{await goSidebar('settings');await page.locator("[data-settings-category='modules']").click();if(await page.locator('#ops-load-establishment-modules').isVisible())await page.locator('#ops-load-establishment-modules').click();await page.locator('#e54-hardware-card').click();});

async function foodHub(){if(!await visibleClick("[data-module-nav='FOOD']"))throw new Error('Área Alimentação não encontrada');await page.locator('[data-module-area="FOOD"]').waitFor({state:'visible'});}
await captureDesktop('alimentacao-hub',foodHub);
for(const [moduleId,name] of [['RESTAURANT','restaurante'],['PIZZERIA','pizzaria'],['DELIVERY','delivery'],['FAST_FOOD','fast-food'],['MARKET_BAKERY','mercado-padaria'],['SELF_SERVICE','autoatendimento']]){
  await captureDesktop(name,async()=>{await foodHub();await page.locator("[data-food-open='"+moduleId+"']").click();});
  if(moduleId==='RESTAURANT'){
    await captureDesktop('restaurante-nova-mesa',async()=>{await foodHub();await page.locator("[data-food-open='RESTAURANT']").click();await page.locator('[data-new-table]').click();await page.locator('#restaurant-new-table-form').waitFor({state:'visible'});});
    await visibleClick('[data-close-new-table]');
  }
}
await captureDesktop('varejo',async()=>{if(!await visibleClick("[data-module-nav='RETAIL']"))throw new Error('Varejo não encontrado');});
await captureDesktop('servicos',async()=>{if(!await visibleClick("[data-module-nav='SERVICES']"))throw new Error('Serviços não encontrado');});

const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
async function deviceScreen(name,device){
  if(!device?.id||!device?.credential){manifest.errors.push({screen:name,error:'Credencial do dispositivo indisponível'});return;}
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const p=await context.newPage();
  await p.goto('http://127.0.0.1:4174/mobile',{waitUntil:'domcontentloaded'});
  await p.evaluate(d=>{localStorage.setItem('artisys.deviceId',d.id);localStorage.setItem('artisys.deviceKey',d.credential);},device);
  await p.reload({waitUntil:'domcontentloaded'});
  await p.waitForSelector('.staff-head',{timeout:15000});
  await sleep(700);
  await shotMobile(p,name);
  await context.close();
}
{
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const p=await context.newPage();
  await p.goto('http://127.0.0.1:4174/mobile',{waitUntil:'domcontentloaded'});
  await p.waitForSelector('.login-shell',{timeout:15000});
  await shotMobile(p,'equipe-login');
  await context.close();
}
if(qr?.url){
  const context=await browser.newContext({viewport:{width:390,height:844}});
  const p=await context.newPage();
  await p.goto(qr.url,{waitUntil:'domcontentloaded'});
  await p.waitForSelector('#products',{timeout:15000});
  await sleep(700);
  await shotMobile(p,'cliente-cardapio-mesa');
  const add=p.locator('.add-button').first();
  if(await add.isVisible().catch(()=>false)){
    await add.click();await sleep(300);await shotMobile(p,'cliente-cardapio-carrinho');
    if(await p.locator('#review-cart').isVisible().catch(()=>false)){await p.locator('#review-cart').click();await p.locator('#cart-dialog').waitFor({state:'visible'});await shotMobile(p,'cliente-revisar-pedido');}
    if(await p.locator('#send-order').isVisible().catch(()=>false)){await p.locator('#send-order').click();await sleep(900);await shotMobile(p,'cliente-pedido-enviado');}
  }
  await context.close();
}
await deviceScreen('garcom',waiter);
await deviceScreen('cozinha-kds',kitchen);
await deviceScreen('tablet-mesa',tablet);
await deviceScreen('autoatendimento-dispositivo',selfDevice);

await browser.close();
await app.close();
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({desktop:manifest.desktop.length,mobile:manifest.mobile.length,errors:manifest.errors},null,2));
