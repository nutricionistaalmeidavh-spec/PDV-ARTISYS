import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const out=path.join(root,'qa-artifacts','missing-desktop-rest');
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
const manifest={generatedAt:new Date().toISOString(),screens:[],errors:[]};
const app=await electron.launch({
  args:[path.join(root,'desktop/main.cjs'),'--no-sandbox'],
  executablePath:path.join(root,'node_modules/electron/dist/electron'),
  cwd:root,
  env:{...process.env,NODE_ENV:'test',ARTISYS_QA:'1',ARTISYS_QA_AUTO_ADMIN:'1',ARTISYS_QA_AUTO_LOCAL:'1',ARTISYS_QA_SIMULATE_PRINTER:'1',ARTISYS_QA_NO_PRINTERS:'1',PDV_AUTO_PRINT:'false'},
  timeout:30000
});
const page=await app.firstWindow();await page.setViewportSize({width:1440,height:900}).catch(()=>{});page.setDefaultTimeout(3000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function shot(name){const file=path.join(out,String(manifest.screens.length+1).padStart(2,'0')+'-'+name+'.png');await page.screenshot({path:file,fullPage:false});manifest.screens.push({name,file:path.basename(file)});console.log('[shot]',name);}
async function capture(name,fn){try{await fn();await sleep(450);await shot(name);}catch(e){manifest.errors.push({name,error:String(e?.message||e)});console.error('[error]',name,e?.message||e);}}
async function click(sel){const l=page.locator(sel);const n=await l.count();for(let i=0;i<n;i++){if(await l.nth(i).isVisible().catch(()=>false)){await l.nth(i).click();return true;}}return false;}
async function api(p,method='GET',body){const r=await page.evaluate(async input=>{const token=sessionStorage.getItem('artisys.sessionToken')||null;return window.artisysDesktop.apiRequest({path:input.p,method:input.method,body:input.body,sessionToken:token});},{p,method,body});if(!r?.ok)throw new Error((r?.payload?.error)||('HTTP '+r?.status+' '+p));return r.payload;}
async function safeApi(...args){try{return await api(...args);}catch(e){console.log('[seed skip]',args[0],e.message);return null;}}
async function sidebar(route){if(!await click("#sidebar-nav [data-route='"+route+"']"))throw new Error('sidebar '+route);}
async function hub(h,target){await sidebar(h);await sleep(150);if(!await click("[data-flow-route='"+target+"']"))throw new Error('hub '+h+' -> '+target);}
async function route(r){if(['products','inventory'].includes(r))return hub('catalog',r);if(['sales','returns'].includes(r))return hub('post-sale',r);if(['management','finance','reports'].includes(r))return hub('financial-management',r);return sidebar(r);}

await page.locator('#auth-overlay').waitFor({state:'visible'});
await page.locator("#login-form input[name='username']").fill('qaadmin');
await page.locator("#login-form input[name='password']").fill('QaLocalOnly-12345!');
await page.locator("#login-form button[type='submit']").click();
await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});await sleep(700);

for(const [id,name,price,cost] of [['qa-x-tudo','X-Tudo',2790,842],['qa-batata','Batata frita',1490,430]])await safeApi('/api/v1/products','POST',{id,sku:id.toUpperCase(),name,salePriceCents:price,costCents:cost,trackStock:false,active:true});
for(const id of ['RESTAURANT','PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY','RETAIL','SERVICES','SELF_SERVICE'])await safeApi('/api/v1/settings/modules.'+id+'.enabled','PUT',{value:true,scope:'global'});
const table=await safeApi('/api/v1/restaurant/tables','POST',{id:'qa-table-01',label:'Mesa 01',seats:4});
let session=null;if(table?.id)session=await safeApi('/api/v1/restaurant/tables/'+encodeURIComponent(table.id)+'/open','POST',{operatorId:'qa-admin'});
if(session?.id)await safeApi('/api/v1/restaurant/sessions/'+encodeURIComponent(session.id)+'/orders','POST',{operatorId:'qa-admin',items:[{productId:'qa-x-tudo',quantity:1,note:'Sem cebola'}]});

await page.reload({waitUntil:'domcontentloaded'});await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000}).catch(()=>{});await sleep(600);
const area={id:'FOOD',label:'Alimentação',description:'Salão, produção, pedidos e retirada',icon:'pizza',routeId:'FOOD',navigation:'group'};
const catalog=[
{id:'RESTAURANT',name:'Restaurante',description:'Mesas, comandas e cozinha',enabled:true,routeId:'RESTAURANT',icon:'store',accessRoles:['admin','manager'],manageRoles:['admin'],area},
{id:'PIZZERIA',name:'Pizzaria',description:'Tamanhos, sabores, bordas e preços',enabled:true,routeId:'PIZZERIA',icon:'pizza',accessRoles:['admin','manager'],manageRoles:['admin'],area},
{id:'DELIVERY',name:'Delivery',description:'Entregas, retiradas e pedidos',enabled:true,routeId:'DELIVERY',icon:'cart',accessRoles:['admin','manager'],manageRoles:['admin'],area},
{id:'FAST_FOOD',name:'Fast-food / Lanchonete',description:'Senhas, fila e retirada',enabled:true,routeId:'FAST_FOOD',icon:'cash',accessRoles:['admin','manager'],manageRoles:['admin'],area},
{id:'MARKET_BAKERY',name:'Mercado / Conveniência / Padaria',description:'Venda por peso, balança e encomendas',enabled:true,routeId:'MARKET_BAKERY',icon:'store',accessRoles:['admin','manager'],manageRoles:['admin'],area},
{id:'SELF_SERVICE',name:'Autoatendimento',description:'Pedidos iniciados em tablet ou totem',enabled:true,routeId:'SELF_SERVICE',icon:'terminal',accessRoles:['admin','manager'],manageRoles:['admin'],area},
{id:'RETAIL',name:'Varejo',description:'Variantes de cor e tamanho',enabled:true,routeId:'RETAIL',icon:'box',accessRoles:['admin','manager'],manageRoles:['admin'],area:{id:'RETAIL',label:'Varejo',description:'Produtos e variações de loja',icon:'box',routeId:'RETAIL',navigation:'module'}},
{id:'SERVICES',name:'Serviços',description:'Agenda, profissionais e comissão',enabled:true,routeId:'SERVICES',icon:'users',accessRoles:['admin','manager'],manageRoles:['admin'],area:{id:'SERVICES',label:'Serviços',description:'Agenda, profissionais e comissões',icon:'users',routeId:'SERVICES',navigation:'module'}}
];
await page.evaluate(c=>window.dispatchEvent(new CustomEvent('artisys:modules-state-changed',{detail:{catalog:c}})),catalog);await sleep(250);

async function renderEnterprise(method,ready){await page.evaluate(m=>{const fn=window.PdvEnterpriseDepthUi?.[m];if(!fn)throw new Error('PdvEnterpriseDepthUi.'+m+' indisponível');void fn();},method);if(ready)await page.locator(ready).waitFor({state:'visible',timeout:3000});else await sleep(500);}
await capture('estoque-compras',()=>renderEnterprise('renderPurchases','#enterprise-purchase-form'));
await capture('estoque-logistica',()=>renderEnterprise('renderLogistics','#enterprise-location-form'));
await capture('estoque-pedidos',()=>renderEnterprise('renderOrders','#enterprise-order-form'));
await capture('caixa',()=>route('cash'));

async function openModule(id,ready){await page.evaluate(id=>{if(!window.PdvVerticalModules?.openWorkspace)throw new Error('PdvVerticalModules indisponível');void window.PdvVerticalModules.openWorkspace(id);},id);if(ready)await page.locator(ready).waitFor({state:'visible',timeout:3000});else await sleep(600);}
await capture('alimentacao-hub',()=>openModule('FOOD','[data-module-area="FOOD"]'));
await capture('restaurante',()=>openModule('RESTAURANT','.restaurant-page'));
await capture('restaurante-comanda',async()=>{await openModule('RESTAURANT','.restaurant-page');const t=page.locator('.restaurant-table').filter({hasText:'Mesa 01'}).first();await t.click();await page.locator('#restaurant-detail .restaurant-card').waitFor({state:'visible',timeout:3000});});
await capture('restaurante-nova-mesa',async()=>{await openModule('RESTAURANT','.restaurant-page');await page.locator('[data-new-table]').click();await page.locator('#restaurant-new-table-form').waitFor({state:'visible'});});await click('[data-close-new-table]');
for(const [id,name,ready] of [['PIZZERIA','pizzaria','#pizza-profile-form'],['DELIVERY','delivery','#delivery-form'],['FAST_FOOD','fast-food','#fast-new'],['MARKET_BAKERY','mercado-padaria','#weight-price-form'],['SELF_SERVICE','autoatendimento','#self-create'],['RETAIL','varejo','#retail-search'],['SERVICES','servicos','#service-form']])await capture(name,()=>openModule(id,ready));

await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));process.exit(manifest.errors.length?2:0);
