'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const adminActor={userId:'admin1',role:'admin',terminalId:'PDV-01'};

function runtimeFixture(){
  let seq=0;
  const runtime=createPdvRuntime({dbPath:':memory:',now:()=> '2026-09-29T12:00:00.000Z',idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.createUser({id:'admin1',username:'admin',name:'Administrador',role:'admin',password:'senha-admin-123'},adminActor);
  return runtime;
}

test('catalog soft delete hides records by default and preserves historical references',()=>{
  const runtime=runtimeFixture();
  try{
    runtime.catalog.createUser({id:'cashier1',username:'caixa',name:'Caixa',role:'cashier',password:'senha-caixa-123'},adminActor);
    runtime.catalog.upsertCategory({id:'cat1',name:'Bebidas'},adminActor);
    runtime.catalog.upsertProduct({id:'p1',name:'Agua',sku:'AGUA',categoryId:'cat1',salePriceCents:500,costCents:200,trackStock:true},adminActor);
    runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:10},adminActor);
    runtime.catalog.upsertCustomer({id:'c1',name:'Cliente Historico'},adminActor);
    runtime.catalog.upsertSupplier({id:'sup1',name:'Fornecedor Historico'},adminActor);
    const sale=runtime.sales.openSale({id:'sale1',saleNumber:'S-1',terminalId:'PDV-01',operatorId:'cashier1',sellerId:'cashier1',customerId:'c1'},adminActor);
    runtime.sales.addItem(sale.id,{productId:'p1',quantity:2});

    runtime.catalog.removeCategory('cat1',adminActor);
    runtime.catalog.removeCustomer('c1',adminActor);
    runtime.catalog.removeSupplier('sup1',adminActor);
    runtime.catalog.removeUser('cashier1',adminActor);

    assert.equal(runtime.catalog.listCategories().some(x=>x.id==='cat1'),false);
    assert.equal(runtime.catalog.listCustomers().some(x=>x.id==='c1'),false);
    assert.equal(runtime.catalog.listSuppliers().some(x=>x.id==='sup1'),false);
    assert.equal(runtime.catalog.listUsers().some(x=>x.id==='cashier1'),false);
    assert.equal(runtime.catalog.listCategories({includeInactive:true}).find(x=>x.id==='cat1').active,false);
    assert.equal(runtime.catalog.listCustomers({includeInactive:true}).find(x=>x.id==='c1').active,false);
    assert.equal(runtime.catalog.listSuppliers({includeInactive:true}).find(x=>x.id==='sup1').active,false);
    assert.equal(runtime.catalog.listUsers({includeInactive:true}).find(x=>x.id==='cashier1').active,false);

    assert.equal(runtime.db.prepare('SELECT category_id FROM products WHERE id=?').get('p1').category_id,'cat1');
    assert.equal(runtime.sales.getSale('sale1').customerId,'c1');
    assert.equal(runtime.sales.getSale('sale1').operatorId,'cashier1');
    assert.equal(runtime.inventory.getBalance('p1'),10);
    assert.equal(runtime.db.prepare('SELECT id FROM suppliers WHERE id=?').get('sup1').id,'sup1');
    const actions=new Set(runtime.db.prepare("SELECT action FROM audit_log WHERE action LIKE '%.remove'").all().map(row=>row.action));
    for(const action of ['category.remove','customer.remove','supplier.remove','user.remove'])assert.equal(actions.has(action),true,action);
  }finally{runtime.close();}
});

test('user password reset works and self or last-admin deactivation is blocked',()=>{
  const runtime=runtimeFixture();
  try{
    runtime.catalog.createUser({id:'cashier1',username:'caixa',name:'Caixa',role:'cashier',password:'senha-antiga-123'},adminActor);
    runtime.catalog.upsertUser({id:'cashier1',username:'caixa',name:'Caixa Atualizado',role:'cashier',password:'senha-nova-456',active:true},adminActor);
    assert.equal(runtime.catalog.verifyUserPassword('caixa','senha-antiga-123').ok,false);
    assert.equal(runtime.catalog.verifyUserPassword('caixa','senha-nova-456').ok,true);
    assert.throws(()=>runtime.catalog.removeUser('admin1',adminActor),/proprio usuario|próprio usuário/i);
    assert.throws(()=>runtime.catalog.removeUser('admin1',{userId:'root-external',role:'admin'}),/ultimo administrador|último administrador/i);
  }finally{runtime.close();}
});


test('installation owner cannot be demoted or deactivated even when another admin exists',()=>{
  const runtime=runtimeFixture();
  try{
    runtime.db.prepare("INSERT INTO installation_activation(installation_id,account_email,license_id,activated_at,activation_source,metadata_json,owner_user_id) VALUES(?,?,?,?,?,?,?)")
      .run('local','owner@example.com','lic-owner','2026-09-29T12:00:00.000Z','test','{}','admin1');
    runtime.catalog.upsertUser({id:'admin1',username:'admin',name:'Administrador',role:'admin',email:'owner@example.com',active:true},adminActor);
    runtime.catalog.createUser({id:'admin2',username:'admin2',name:'Administrador 2',role:'admin',password:'senha-admin2-123'},adminActor);
    assert.throws(()=>runtime.catalog.saveManagedUser({id:'admin1',username:'admin',name:'Administrador',role:'manager',email:'owner@example.com',active:true},adminActor),/proprietario/i);
    assert.throws(()=>runtime.catalog.removeUser('admin1',{userId:'admin2',role:'admin'}),/proprietario/i);
    assert.equal(runtime.catalog.getUser('admin1').role,'admin');
    assert.equal(runtime.catalog.getUser('admin1').active,true);
  }finally{runtime.close();}
});

async function httpFixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-catalog-users-'));
  let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',role:'admin',password:'senha-admin-123'},adminActor);
  runtime.catalog.createUser({id:'manager1',username:'manager',name:'Gerente',role:'manager',password:'senha-manager-123'},adminActor);
  runtime.catalog.createUser({id:'cashier1',username:'cashier',name:'Operador',role:'cashier',password:'senha-cashier-123'},adminActor);
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install-secret'});
  const address=await server.start();
  return{runtime,server,dir,base:`http://${address.host}:${address.port}`,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function login(ctx,username,password){
  const response=await fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'install-secret'},body:JSON.stringify({username,password,terminalId:'PDV-01'})});
  assert.equal(response.status,200);
  return(await response.json()).sessionToken;
}
async function api(ctx,token,pathname,{method='GET',body}={}){
  const headers={authorization:`Bearer ${token}`};if(body!==undefined)headers['content-type']='application/json';
  return fetch(`${ctx.base}${pathname}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
}

test('HTTP RBAC reserves admin promotion and user deactivation to admins',async()=>{
  const ctx=await httpFixture();
  try{
    const admin=await login(ctx,'admin','senha-admin-123');
    const manager=await login(ctx,'manager','senha-manager-123');
    const cashier=await login(ctx,'cashier','senha-cashier-123');

    assert.equal((await api(ctx,manager,'/api/v1/users',{method:'POST',body:{username:'novo-admin',name:'Novo Admin',role:'admin',password:'senha-forte-123'}})).status,403);
    let response=await api(ctx,manager,'/api/v1/users',{method:'POST',body:{id:'cashier2',username:'cashier2',name:'Caixa 2',role:'cashier',password:'senha-forte-123',active:true}});
    assert.equal(response.status,201);
    response=await api(ctx,manager,'/api/v1/users',{method:'POST',body:{id:'cashier2',username:'cashier2',name:'Caixa 2',role:'cashier',active:false}});
    assert.equal(response.status,403);

    response=await api(ctx,admin,'/api/v1/users/cashier2',{method:'DELETE'});
    assert.equal(response.status,200);
    response=await api(ctx,admin,'/api/v1/users?includeInactive=true');
    assert.equal((await response.json()).find(user=>user.id==='cashier2').active,false);

    assert.equal((await api(ctx,cashier,'/api/v1/customers',{method:'POST',body:{name:'Nao pode'}})).status,403);
    response=await api(ctx,manager,'/api/v1/customers',{method:'POST',body:{id:'c2',name:'Cliente 2'}});assert.equal(response.status,201);
    response=await api(ctx,manager,'/api/v1/customers/c2',{method:'DELETE'});assert.equal(response.status,200);
    response=await api(ctx,manager,'/api/v1/categories',{method:'POST',body:{id:'cat2',name:'Categoria 2'}});assert.equal(response.status,201);
    response=await api(ctx,manager,'/api/v1/categories/cat2',{method:'DELETE'});assert.equal(response.status,200);
    response=await api(ctx,manager,'/api/v1/suppliers',{method:'POST',body:{id:'sup2',name:'Fornecedor 2'}});assert.equal(response.status,201);
    response=await api(ctx,manager,'/api/v1/suppliers/sup2',{method:'DELETE'});assert.equal(response.status,200);

    const cashierSession=await login(ctx,'cashier','senha-cashier-123');
    response=await api(ctx,admin,'/api/v1/users/cashier1',{method:'DELETE'});assert.equal(response.status,200);
    assert.equal((await api(ctx,cashierSession,'/api/v1/products')).status,401);
  }finally{await ctx.close();}
});

test('desktop wiring exposes the native Access Center and preserves logical deletion APIs',()=>{
  const read=rel=>fs.readFileSync(path.join(__dirname,'..',rel),'utf8');
  const managementApi=read('desktop/renderer/catalog-user-management-api.js');
  const html=read('desktop/renderer/index.html');
  const accessUi=read('desktop/renderer/access-center-ui.js');
  for(const marker of ['removeCategory','removeCustomer','removeSupplier','removeUser'])assert.match(managementApi,new RegExp(`p\\.${marker}=`));
  assert.match(html,/catalog-user-management-api\.js/);
  assert.match(html,/access-center-ui\.js/);
  assert.doesNotMatch(html,/catalog-user-management-ui\.js/);
  assert.match(accessUi,/Acessos e equipe/);
  for(const label of ['Pessoas','Perfis','Dispositivos','Segurança'])assert.match(accessUi,new RegExp(label));
  assert.doesNotMatch(accessUi,/Comiss[oõ]es/i);
  assert.match(accessUi,/PdvRouteRegistry/);
  assert.match(accessUi,/register\('access'/);
  assert.doesNotThrow(()=>new Function(managementApi));
  assert.doesNotThrow(()=>new Function(accessUi));
});
