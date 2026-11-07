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
 for(const file of [nfeLib,workerExe])fs.writeFileSync(file,'fixture for API contract');
 const pfx=path.join(dir,'issuer-test.pfx');fs.writeFileSync(pfx,Buffer.alloc(1024,5));
 fs.writeFileSync(nfeConfig,'[NFe]\nAmbiente=1\nFormaEmissao=0\nCSC=TEST_CSC\nIdCSC=1\n[DFe]\nUF=SP\nArquivoPFX='+pfx+'\nSenha=test-local-only\nVerificarValidade=1\n');
 let nativeCalls=0;
 const localNative=native?{
  inputDir:nativeDir,nfeLib,nfeConfig,workerExe,allowHomologation:true,
  now:()=> '2026-11-04T15:00:00-03:00',randomCNF:()=> '00000011',
  runner:async req=>{
   nativeCalls++;
   if(req.operation==='cancel')return {status:'CANCELADA',environment:'HOMOLOGACAO',accessKey:req.accessKey,cStat:135,eventProtocol:'135260000000333'};
   if(req.operation==='inutilize')return {status:'INUTILIZADA',environment:'HOMOLOGACAO',issuerCnpj:req.issuerCnpj,cStat:102,
    model:req.model,series:req.series,startNumber:req.startNumber,endNumber:req.endNumber,eventProtocol:'135260000000444'};
   const base='35'+'2611'+'12345678000195'+'65'+'001'+'000000001'+'1'+'00000011';
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
test('fiscal routes are absent from the commercial server by default',async()=>{
 const ctx=await setup();
 try{
  const admin=await login(ctx,'admin','senha-admin-123');
  for(const endpoint of ['/status','/company','/products/SKU-123','/documents','/offline-queue','/offline-uf-policy','/inutilizations']){
   assert.equal((await request(ctx,endpoint,admin)).status,404,endpoint);
  }
  assert.deepEqual(ctx.runtime.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'acbr_fiscal_%'").all(),[]);
 }finally{await ctx.close();}
});

test('even explicit preview and native ACBr options cannot expose fiscal API or reach native worker',async()=>{
 const ctx=await setup({enabled:true,native:true});
 try{
  const admin=await login(ctx,'admin','senha-admin-123');
  const cashier=await login(ctx,'cashier','senha-caixa-123');
  for(const token of [admin,cashier]){
   for(const [endpoint,method,body] of [
    ['/status','GET'],['/company','PUT',{name:'test',cnpj:'12345678000195',uf:'SP'}],
    ['/products/SKU-123','PUT',{ncm:'09012100'}],
    ['/sales/sale-test/prepare','POST',{documentType:'nfce'}],
    ['/documents/no-document/compile','POST',{}],
    ['/documents/no-document/transmit','POST',{}],
    ['/documents/no-document/consult','POST',{}],
    ['/documents/no-document/offline-issue','POST',{}],
    ['/documents/no-document/offline-danfe.pdf','GET'],
    ['/documents/no-document/cce','POST',{}],
    ['/documents/no-document/cancel','POST',{}],
    ['/offline-queue/flush','POST',{}],
    ['/inutilizations','POST',{}]
   ]){
    assert.equal((await request(ctx,endpoint,token,{method,body})).status,404,method+' '+endpoint);
   }
  }
  assert.equal(ctx.nativeCalls,0);
  assert.deepEqual(ctx.runtime.db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'acbr_fiscal_%'").all(),[]);
 }finally{await ctx.close();}
});

test('commercial startup preserves pre-existing fiscal rows but cannot issue or alter them',async()=>{
 const ctx=await setup({enabled:true,native:true});
 try{
  ctx.runtime.db.exec('CREATE TABLE acbr_fiscal_company (id INTEGER PRIMARY KEY, public_json TEXT NOT NULL)');
  const original='{"archived":true,"issuer":"old-company"}';
  ctx.runtime.db.prepare('INSERT INTO acbr_fiscal_company(id,public_json) VALUES(1,?)').run(original);
  const admin=await login(ctx,'admin','senha-admin-123');
  assert.equal((await request(ctx,'/company',admin,{method:'PUT',body:{name:'mutated'}})).status,404);
  assert.equal((await request(ctx,'/documents/one/transmit',admin,{method:'POST',body:{}})).status,404);
  assert.equal(ctx.runtime.db.prepare('SELECT public_json FROM acbr_fiscal_company WHERE id=1').get().public_json,original);
  assert.equal(ctx.nativeCalls,0);
 }finally{await ctx.close();}
});
