'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');
async function setup({enabled=false,native=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-preview-api-'));
 const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite')});
 runtime.catalog.createUser({id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'});
 runtime.catalog.createUser({id:'cashier1',username:'cashier',name:'Caixa',profileId:'profile-cashier',password:'senha-caixa-123'});
 const nativeDir=path.join(dir,'fiscal');fs.mkdirSync(nativeDir,{recursive:true});
 const nfeLib=path.join(dir,'ACBrNFe64.dll'),nfeConfig=path.join(dir,'ACBrNFe.ini'),workerExe=path.join(dir,'acbrlib-worker.exe');
 for(const file of [nfeLib,nfeConfig,workerExe])fs.writeFileSync(file,'fixture for API contract');
 let nativeCalls=0;
 const localNative=native?{
  inputDir:nativeDir,nfeLib,nfeConfig,workerExe,allowHomologation:true,
  now:()=> '2026-11-04T15:00:00-03:00',randomCNF:()=> '00000011',
  runner:async req=>{
   nativeCalls++;
   const base='35261112345678000195650010000000011000000011';
   let sum=0,weight=2;for(let i=42;i>=0;i--){sum+=Number(base[i])*weight;weight=weight===9?2:weight+1;}
   const value=11-(sum%11),key=base.slice(0,43)+String(value>=10?0:value);
   const xml='<nfeProc><NFe><infNFe Id="NFe'+key+'"><ide><mod>65</mod><tpAmb>2</tpAmb><nNF>1</nNF><serie>1</serie></ide><emit><CNPJ>12345678000195</CNPJ></emit><total><ICMSTot><vNF>18.00</vNF></ICMSTot></total></infNFe><Signature/></NFe><protNFe><infProt><cStat>100</cStat><nProt>135260000000001</nProt><chNFe>'+key+'</chNFe></infProt></protNFe></nfeProc>';
   return {status:'AUTORIZADA',environment:'HOMOLOGACAO',accessKey:key,number:'1',series:'1',protocol:'135260000000001',xml};
  }
 }:null;
 const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install-test',fiscalPreviewEnabled:enabled,fiscalNativeOptions:localNative});
 const address=await server.start();
 return {dir,runtime,server,get nativeCalls(){return nativeCalls;},base:`http://${address.host}:${address.port}`,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
async function login(ctx,username,password){
 const response=await fetch(ctx.base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'install-test'},body:JSON.stringify({username,password,terminalId:'PDV-01'})});
 assert.equal(response.status,200);
 return(await response.json()).sessionToken;
}
function request(ctx,endpoint,token,{method='GET',body}={}){
 return fetch(ctx.base+'/api/v1/fiscal-preview'+endpoint,{method,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
}
test('commercial core has no fiscal API or fiscal schema when optional preview is disabled',async()=>{
 const ctx=await setup();try{
  const token=await login(ctx,'admin','senha-admin-123');
  assert.equal((await request(ctx,'/status',token)).status,404);
  assert.deepEqual(ctx.runtime.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'acbr_fiscal_%'").all(),[]);
 }finally{await ctx.close();}
});
test('explicit fiscal preview is authenticated, role-checked and does not enable transmission',async()=>{
 const ctx=await setup({enabled:true});
 try{
  const admin=await login(ctx,'admin','senha-admin-123');
  const cashier=await login(ctx,'cashier','senha-caixa-123');
  assert.equal((await fetch(ctx.base+'/api/v1/fiscal-preview/status')).status,401);
  assert.equal((await request(ctx,'/status',cashier)).status,403);
  const status=await request(ctx,'/status',admin);assert.equal(status.status,200);
  assert.equal((await status.json()).emissionEnabled,false);
  const company={name:'Loja',cnpj:'12345678000195',uf:'SP',stateRegistration:'123456789',crt:'1',environment:'homologation',series:1};
  const created=await request(ctx,'/company',admin,{method:'PUT',body:company});
  assert.equal(created.status,200);
  assert.equal((await created.json()).autoIssue,false);
  const profile=await request(ctx,'/products/SKU-123',admin,{method:'PUT',body:{ncm:'09012100',cfop:'5102',origin:'0',csosn:'102',pisCst:'49',cofinsCst:'49',unit:'UN',reviewedBy:'contabilidade',reviewedAt:'2026-11-04'}});
  assert.equal(profile.status,200);
  assert.equal((await profile.json()).productId,'SKU-123');
  assert.equal((await request(ctx,'/company',cashier,{method:'PUT',body:company})).status,403);
  const issue=await request(ctx,'/documents/missing/transmit',admin,{method:'POST',body:{}});
  assert.equal(issue.status,409);
  assert.equal((await request(ctx,'/documents',admin)).status,200);
  assert.equal(ctx.runtime.db.prepare('SELECT COUNT(*) n FROM acbr_fiscal_documents').get().n,0);
 }finally{await ctx.close();}
});

test('admin can compile and attempt one NFC-e homologation from a completed sale with an explicit local ACBr worker',async()=>{
 const ctx=await setup({enabled:true,native:true});
 try{
  ctx.runtime.sales.getSaleDetails=()=>({
   id:'sale-test',saleNumber:'CX-1',status:'COMPLETED',customerId:null,completedAt:'2026-11-04T12:00:00-03:00',
   subtotalCents:2000,discountCents:200,totalCents:1800,changeCents:200,
   items:[{id:'item-1',productId:'SKU-123',productName:'CAFE',sku:'CAFE',quantity:2,unitPriceCents:1000,totalCents:2000,allocatedDiscountCents:200,netTotalCents:1800}],
   payments:[{method:'CASH',amountCents:2000}]
  });
  const admin=await login(ctx,'admin','senha-admin-123');
  const cashier=await login(ctx,'cashier','senha-caixa-123');
  const status=await (await request(ctx,'/status',admin)).json();
  assert.equal(status.emissionEnabled,true);
  const company={name:'EMPRESA TESTE',cnpj:'12345678000195',uf:'SP',stateRegistration:'123456789',crt:'1',environment:'homologation',series:1,
    street:'RUA DAS FLORES',streetNumber:'10',district:'CENTRO',municipalityCode:'3543402',municipalityName:'RIBEIRAO PRETO',postalCode:'14000000'};
  assert.equal((await request(ctx,'/company',admin,{method:'PUT',body:company})).status,200);
  const profile={ncm:'09012100',cfop:'5102',origin:'0',csosn:'102',pisCst:'49',cofinsCst:'49',unit:'UN',
   reviewedBy:'contador',reviewedAt:'2026-11-04',zeroLegacyTaxesConfirmed:true,
   ibsCbsCst:'000',cClassTrib:'000001',reformTax:{ibsUfRate:'0.1000',ibsMunRate:'0.0000',cbsRate:'0.9000'}};
  assert.equal((await request(ctx,'/products/SKU-123',admin,{method:'PUT',body:profile})).status,200);
  const draftRequest=await request(ctx,'/sales/sale-test/prepare',admin,{method:'POST',body:{documentType:'nfce'}});
  assert.equal(draftRequest.status,201);
  const doc=await draftRequest.json();
  assert.equal(doc.status,'REVIEW_REQUIRED');
  assert.equal(doc.snapshot.items[0].taxProfile.reformTax.baseCents,1800);
  const compiled=await request(ctx,'/documents/'+doc.id+'/compile',admin,{method:'POST',body:{}});
  assert.equal(compiled.status,200);
  assert.equal((await compiled.json()).status,'READY');
  assert.equal((await request(ctx,'/documents/'+doc.id+'/transmit',cashier,{method:'POST',body:{}})).status,403);
  assert.equal(ctx.nativeCalls,0);
  const issued=await request(ctx,'/documents/'+doc.id+'/transmit',admin,{method:'POST',body:{}});
  assert.equal(issued.status,200);
  assert.equal((await issued.json()).status,'AUTHORIZED');
  assert.equal(ctx.nativeCalls,1);
  const retry=await request(ctx,'/documents/'+doc.id+'/transmit',admin,{method:'POST',body:{}});
  assert.equal(retry.status,400);
  assert.equal(ctx.nativeCalls,1);
 }finally{await ctx.close();}
});
