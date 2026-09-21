'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const root=path.join(__dirname,'..');
const installToken='p0-p1-installation-secret';

function settings(overrides={}){return{
  provider:'acbr-local',documentType:'nfce',environment:'homologation',autoIssue:false,
  cnpj:'12345678000195',stateRegistration:'123456789',legalName:'Empresa P0 P1 LTDA',tradeName:'Empresa P0 P1',
  crt:'1',cnae:'4711302',series:'1',operationNature:'VENDA',cscId:'1',
  address:{street:'Rua Teste',number:'100',district:'Centro',cityCode:'3543402',city:'Ribeirao Preto',state:'SP',zip:'14010000'},
  ...overrides
};}
function profile(overrides={}){return{id:'perfil-p0-p1',name:'Revenda Simples Nacional',ncm:'61091000',cfop:'5102',origin:'0',csosn:'102',pisCst:'49',cofinsCst:'49',unit:'UN',...overrides};}

async function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-p0-p1-'));const dbPath=path.join(dir,'pdv.sqlite');let runtime=null;let server=null;let base=null;
  async function boot(){runtime=createPdvRuntime({dbPath});server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:installToken});const address=await server.start();base=`http://${address.host}:${address.port}`;}
  runtime=createPdvRuntime({dbPath});
  runtime.catalog.createUser({id:'admin-p0-p1',username:'adminp01',name:'Admin Fiscal',role:'admin',password:'senha-forte-admin-123'});
  runtime.catalog.createUser({id:'manager-p0-p1',username:'managerp01',name:'Gerente Fiscal',role:'manager',password:'senha-forte-manager-123'});
  runtime.catalog.createUser({id:'cashier-p0-p1',username:'cashierp01',name:'Caixa Fiscal',role:'cashier',password:'senha-forte-cashier-123'});
  runtime.catalog.upsertProduct({id:'produto-p0-p1',sku:'P0P1',name:'Produto P0 P1',salePriceCents:1000,costCents:500,trackStock:true});
  runtime.close();await boot();
  async function login(username,password){const response=await fetch(`${base}/api/v1/auth/login`,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':installToken},body:JSON.stringify({username,password,terminalId:'PDV-P0-P1'})});assert.equal(response.status,200);return(await response.json()).sessionToken;}
  function headers(token){return{authorization:`Bearer ${token}`,'content-type':'application/json'};}
  return{get base(){return base;},login,headers,async restart(){await server.stop();runtime.close();await boot();},async cleanup(){if(server)await server.stop();if(runtime)runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('P0 release E2E keeps core sale/stock/cash and fiscal settings in one critical baseline',()=>{
  const config=JSON.parse(fs.readFileSync(path.join(root,'qa/artisys-qa.config.json'),'utf8'));
  assert.equal(config.flows['fiscal-ui-parity-baseline'],'flows/fiscal-ui-parity-baseline.json');
  assert.ok(config.qaProfiles.release.flows.includes('fiscal-ui-parity-baseline'));
  assert.ok(config.qaProfiles.release.criticalFlows.includes('fiscal-ui-parity-baseline'));
  const flow=JSON.parse(fs.readFileSync(path.join(root,'qa/flows/fiscal-ui-parity-baseline.json'),'utf8'));
  assert.equal(flow.steps[0].uses,'core-business-e2e.json');const serialized=JSON.stringify(flow);
  assert.match(serialized,/fiscal-production-panel/);assert.match(serialized,/fiscal-monitor-panel/);assert.match(serialized,/Configuração e Produção/);
});

test('P1 settings API is authenticated, RBAC-protected, secret-safe, atomic and persistent',async()=>{
  const ctx=await fixture();try{
    const adminToken=await ctx.login('adminp01','senha-forte-admin-123');const managerToken=await ctx.login('managerp01','senha-forte-manager-123');const cashierToken=await ctx.login('cashierp01','senha-forte-cashier-123');
    let response=await fetch(`${ctx.base}/api/v1/fiscal/settings`);assert.equal(response.status,401);
    response=await fetch(`${ctx.base}/api/v1/fiscal/settings`,{headers:ctx.headers(cashierToken)});assert.equal(response.status,403);
    response=await fetch(`${ctx.base}/api/v1/fiscal/settings`,{headers:ctx.headers(managerToken)});assert.equal(response.status,200);
    const secretPayload=settings({pfxBase64:'PFX-SECRET-MUST-NOT-LEAK',password:'CERT-PASSWORD-MUST-NOT-LEAK',csc:'CSC-SECRET-MUST-NOT-LEAK',secretToken:'TOKEN-MUST-NOT-LEAK'});
    response=await fetch(`${ctx.base}/api/v1/fiscal/settings`,{method:'PUT',headers:ctx.headers(adminToken),body:JSON.stringify(secretPayload)});assert.equal(response.status,200);
    const saved=await response.json();assert.equal(saved.cnpj,'12345678000195');const savedText=JSON.stringify(saved);
    for(const secret of ['PFX-SECRET-MUST-NOT-LEAK','CERT-PASSWORD-MUST-NOT-LEAK','CSC-SECRET-MUST-NOT-LEAK','TOKEN-MUST-NOT-LEAK'])assert.doesNotMatch(savedText,new RegExp(secret));
    response=await fetch(`${ctx.base}/api/v1/fiscal/settings`,{headers:ctx.headers(adminToken)});assert.equal(response.status,200);assert.equal((await response.json()).cnpj,'12345678000195');
    response=await fetch(`${ctx.base}/api/v1/fiscal/settings`,{method:'PUT',headers:ctx.headers(adminToken),body:JSON.stringify(settings({cnpj:'123'}))});assert.equal(response.status,400);
    response=await fetch(`${ctx.base}/api/v1/fiscal/settings`,{headers:ctx.headers(adminToken)});assert.equal(response.status,200);assert.equal((await response.json()).cnpj,'12345678000195');
    await ctx.restart();const tokenAfterRestart=await ctx.login('adminp01','senha-forte-admin-123');response=await fetch(`${ctx.base}/api/v1/fiscal/settings`,{headers:ctx.headers(tokenAfterRestart)});assert.equal(response.status,200);assert.equal((await response.json()).legalName,'Empresa P0 P1 LTDA');
  }finally{await ctx.cleanup();}
});

test('P1 canonical profiles, product fiscal binding, coverage and sequences API stay compatible with legacy routes',async()=>{
  const ctx=await fixture();try{
    const token=await ctx.login('adminp01','senha-forte-admin-123');let response=await fetch(`${ctx.base}/api/v1/fiscal/profiles`,{method:'POST',headers:ctx.headers(token),body:JSON.stringify(profile())});assert.equal(response.status,201);
    response=await fetch(`${ctx.base}/api/v1/fiscal/profiles/perfil-p0-p1`,{headers:ctx.headers(token)});assert.equal(response.status,200);assert.equal((await response.json()).name,'Revenda Simples Nacional');
    response=await fetch(`${ctx.base}/api/v1/fiscal/profiles/perfil-p0-p1`,{method:'PUT',headers:ctx.headers(token),body:JSON.stringify(profile({name:'Revenda Atualizada'}))});assert.equal(response.status,200);assert.equal((await response.json()).name,'Revenda Atualizada');
    response=await fetch(`${ctx.base}/api/v1/products/produto-p0-p1/fiscal`,{method:'PUT',headers:ctx.headers(token),body:JSON.stringify({profileId:'perfil-p0-p1',gtin:'7891234567895'})});assert.equal(response.status,200);assert.equal((await response.json()).profileId,'perfil-p0-p1');
    response=await fetch(`${ctx.base}/api/v1/products/produto-p0-p1/fiscal`,{headers:ctx.headers(token)});assert.equal(response.status,200);assert.equal((await response.json()).gtin,'7891234567895');
    response=await fetch(`${ctx.base}/api/v1/fiscal/product-coverage`,{headers:ctx.headers(token)});assert.equal(response.status,200);assert.deepEqual(await response.json(),{totalProducts:1,configuredProducts:1,pendingProducts:0,coveragePercent:100});
    response=await fetch(`${ctx.base}/api/v1/fiscal/sequences`,{method:'PUT',headers:ctx.headers(token),body:JSON.stringify({documentType:'nfce',environment:'homologation',series:'1',nextNumber:10})});assert.equal(response.status,200);assert.equal((await response.json()).nextNumber,10);
    response=await fetch(`${ctx.base}/api/v1/fiscal/sequences?documentType=nfce&environment=homologation&series=1`,{headers:ctx.headers(token)});assert.equal(response.status,200);assert.equal((await response.json()).nextNumber,10);
    response=await fetch(`${ctx.base}/api/v1/fiscal/products/produto-p0-p1/profile`,{headers:ctx.headers(token)});assert.equal(response.status,200);assert.equal((await response.json()).profileId,'perfil-p0-p1');
    response=await fetch(`${ctx.base}/api/v1/fiscal/sequences`,{method:'POST',headers:ctx.headers(token),body:JSON.stringify({documentType:'nfce',environment:'homologation',series:'2',nextNumber:20})});assert.equal(response.status,201);
  }finally{await ctx.cleanup();}
});
