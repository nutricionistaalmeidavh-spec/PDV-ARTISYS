'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createAcbrLibAdapter}=require('../server/acbrlib/acbrlib-adapter');

const KEY='35261112345678000195650010000001231000001238';
const XML=`<nfeProc><NFe><infNFe Id="NFe${KEY}"><ide><mod>65</mod><tpAmb>2</tpAmb><serie>1</serie><nNF>123</nNF></ide><emit><CNPJ>12345678000195</CNPJ></emit><total><ICMSTot><vNF>12.50</vNF></ICMSTot></total><Signature/></NFe><protNFe><infProt><cStat>100</cStat><nProt>135260000000001</nProt><chNFe>${KEY}</chNFe></infProt></protNFe></nfeProc>`;
function fixture(t, overrides={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-acbrlib-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const ini=path.join(dir,'sale-123.ini'), lib=path.join(dir,'ACBrNFe64.dll'), conf=path.join(dir,'ACBrLibNFe.ini'), worker=path.join(dir,'acbrlib-worker.exe');
  fs.writeFileSync(ini,'[infNFe]\nversao=4.00\n[ide]\nmod=65\n');
  for(const file of [lib,worker])fs.writeFileSync(file,'fixture');
  const pfx=path.join(dir,'issuer-test.pfx');fs.writeFileSync(pfx,Buffer.alloc(1024,5));
  fs.writeFileSync(conf,'[NFe]\nAmbiente=1\nFormaEmissao=0\nCSC=TEST_CSC\nIdCSC=1\n[DFe]\nUF=SP\nArquivoPFX='+pfx+'\nSenha=test-local-only\nVerificarValidade=1\n');
  const snapshotHash='a'.repeat(64);
  const manifest={reference:'sale-123',documentType:'nfce',snapshotHash,amountCents:1250,issuerCnpj:'12345678000195',issuerUF:'SP',environment:'homologation',model:65,lot:123,number:123,series:1,cNF:'00000123',iniSha256:createHash('sha256').update(fs.readFileSync(ini)).digest('hex')};
  fs.writeFileSync(path.join(dir,'sale-123.json'),JSON.stringify({...manifest,...overrides}));
  const options={inputDir:dir,nfeLib:lib,nfeConfig:conf,workerExe:worker};
  return {dir,ini,manifest,options};
}
const request=(f,env='homologation')=>({type:'nfce',reference:'sale-123',environment:env,payload:{document:f.manifest}});
const authorized={status:'AUTORIZADA',environment:'HOMOLOGACAO',accessKey:KEY,protocol:'135260000000001',number:'123',series:'1',xml:XML};

test('ACBrLib requires explicit local binary/configuration; no SaaS or fallback is used',async()=>{
  const adapter=createAcbrLibAdapter({});
  const result=await adapter.issue({type:'nfce',reference:'sale-123',environment:'homologation',payload:{}});
  assert.equal(result.ok,false);
  assert.equal(result.indeterminate,undefined);
  assert.equal((await adapter.status()).data.configured,false);
});
test('ACBrLib sends only a manifest-matched verified invoice through the local worker',async t=>{
  const f=fixture(t);let sent;
  const adapter=createAcbrLibAdapter({...f.options,runner:async req=>{sent=req;return authorized;}});
  const result=await adapter.issue(request(f));
  assert.equal(result.ok,true);assert.equal(result.data.cStat,100);assert.equal(result.data.chave_nfce,KEY);
  assert.equal(sent.kind,'NFE');assert.equal(sent.model,65);assert.equal(sent.operation,'transmit');
  assert.equal(sent.iniPath,f.ini);assert.equal(sent.amountCents,1250);
  assert.equal(sent.environment,'HOMOLOGACAO');
});
test('ACBrLib fails closed for wrong sale total, mismatched snapshot, and modified INI',async t=>{
  const f=fixture(t);let called=false;
  const adapter=createAcbrLibAdapter({...f.options,runner:async()=>{called=true;return authorized;}});
  const tampered={...request(f),payload:{document:{...f.manifest,amountCents:1251}}};
  assert.equal((await adapter.issue(tampered)).ok,false);
  fs.appendFileSync(f.ini,'\n[det1]\nxProd=MUDOU\n');
  assert.equal((await adapter.issue(request(f))).ok,false);
  assert.equal(called,false);
});
test('ACBrLib refuses production by default and requires correct NF-e/NFC-e model',async t=>{
  const f=fixture(t,{environment:'production'});
  const adapter=createAcbrLibAdapter({...f.options,runner:async()=>authorized});
  const document={...f.manifest,environment:'production'};
  assert.equal((await adapter.issue({type:'nfce',reference:'sale-123',environment:'production',payload:{document}})).ok,false);
  assert.equal((await adapter.issue({type:'nfe',reference:'sale-123',environment:'production',payload:{document}})).ok,false);
});
test('ACBrLib timeout/unknown never authorizes, and signed invoice demands consultation before another transmission',async t=>{
  const f=fixture(t);
  const adapter=createAcbrLibAdapter({...f.options,runner:async()=>{throw Error('timeout');}});
  const result=await adapter.issue(request(f));
  assert.equal(result.ok,false);assert.equal(result.indeterminate,true);
  fs.writeFileSync(path.join(f.dir,'sale-123.signed.xml'),XML);
  assert.equal((await adapter.issue(request(f))).indeterminate,true);
});
test('ACBrLib query never sends a second emission and cancellation remains blocked',async t=>{
  const f=fixture(t);let sent;
  const adapter=createAcbrLibAdapter({...f.options,runner:async req=>{sent=req;return authorized;}});
  const result=await adapter.query({type:'nfce',reference:'sale-123',environment:'homologation',accessKey:KEY});
  assert.equal(result.ok,true);assert.equal(sent.operation,'consult');
  assert.equal((await adapter.cancel({type:'nfce',reference:'sale-123'})).ok,false);
});
test('ACBrLib rejects pseudo-authorization without an official 44-digit key, protocol, signed XML and matching environment',async t=>{
  const f=fixture(t);
  const adapter=createAcbrLibAdapter({...f.options,runner:async()=>({...authorized,xml:'<fake/>',accessKey:'fake'})});
  const result=await adapter.issue(request(f));
  assert.equal(result.ok,false);assert.equal(result.indeterminate,true);
});

test('ACBrLib cannot authorize a different invoice number, serie, issuer or key',async t=>{
 const f=fixture(t);
 for(const response of [
  {...authorized,number:'999'},
  {...authorized,series:'2'},
  {...authorized,xml:authorized.xml.replace('<nNF>123</nNF>','<nNF>124</nNF>')},
  {...authorized,xml:authorized.xml.replace('<CNPJ>12345678000195</CNPJ>','<CNPJ>99999999000199</CNPJ>')},
  {...authorized,accessKey:'35261112345678000195650010000001231000001236'}
 ]){
  const adapter=createAcbrLibAdapter({...f.options,runner:async()=>response});
  const result=await adapter.issue(request(f));
  assert.equal(result.ok,false);
  assert.equal(result.indeterminate,true);
 }
});

test('ACBr private production mode is refused before native worker even if manifest is homologation',async t=>{
  const f=fixture(t);
  const config=f.options.nfeConfig;
  const safe=fs.readFileSync(config,'utf8');
  fs.writeFileSync(config,safe.replace('Ambiente=1','Ambiente=0'));
  let invoked=false;
  const adapter=createAcbrLibAdapter({...f.options,runner:async()=>{invoked=true;return authorized;}});
  const result=await adapter.issue(request(f));
  assert.equal(result.ok,false);
  assert.equal(invoked,false);
});
test('ACBr private config cannot use mismatched issuer UF or missing CSC',async t=>{
 const f=fixture(t);
 const config=f.options.nfeConfig;
 const src=fs.readFileSync(config,'utf8');
 let invoked=false;
 const adapter=createAcbrLibAdapter({...f.options,runner:async()=>{invoked=true;return authorized;}});
 fs.writeFileSync(config,src.replace('UF=SP','UF=RJ'));
 assert.equal((await adapter.issue(request(f))).ok,false);
 fs.writeFileSync(config,src.replace('CSC=TEST_CSC','CSC='));
 assert.equal((await adapter.issue(request(f))).ok,false);
 assert.equal(invoked,false);
});
