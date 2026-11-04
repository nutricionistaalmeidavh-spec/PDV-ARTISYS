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

test('officially matched rejection is not mistaken for network failure, nor retried blindly',async t=>{
 const f=fixture(t),key=KEY;
 const adapter=createAcbrLibAdapter({...f.options,runner:async()=>({status:'REJEITADA',
  environment:'HOMOLOGACAO',accessKey:key,cStat:778,reason:'NFC-e rejeitada: NCM incorreto'})});
 const result=await adapter.issue(request(f));
 assert.equal(result.ok,false);
 assert.equal(result.rejected,true);
 assert.equal(result.data.cStat,778);
 const mismatched=createAcbrLibAdapter({...f.options,runner:async()=>({
  status:'REJEITADA',environment:'HOMOLOGACAO',accessKey:'0'.repeat(44),cStat:778,reason:'bad'})});
 assert.equal((await mismatched.issue(request(f))).indeterminate,true);
});

test('native ACBr uses an ephemeral credential configuration and removes it on success, failure and status checks',async t=>{
  const f=fixture(t),original=fs.readFileSync(f.options.nfeConfig);
  fs.rmSync(f.options.nfeConfig);
  let leases=0;
  const withConfig=async operation=>{
    leases++;
    fs.writeFileSync(f.options.nfeConfig,original);
    try{return await operation();}finally{fs.rmSync(f.options.nfeConfig,{force:true});}
  };
  const adapter=createAcbrLibAdapter({...f.options,issuerUF:'SP',withConfig,runner:async()=>{
    assert.equal(fs.existsSync(f.options.nfeConfig),true);
    return authorized;
  }});
  assert.equal((await adapter.status()).data.ready,true);
  assert.equal(fs.existsSync(f.options.nfeConfig),false);
  assert.equal((await adapter.issue(request(f))).ok,true);
  assert.equal(fs.existsSync(f.options.nfeConfig),false);
  assert.ok(leases>=2);
  const bad=createAcbrLibAdapter({...f.options,withConfig,runner:async()=>{throw Error('worker crashed')}});
  assert.equal((await bad.issue(request(f))).indeterminate,true);
  assert.equal(fs.existsSync(f.options.nfeConfig),false);
});

test('cancellation only accepts a matching SEFAZ event protocol and never guesses success',async t=>{
 const f=fixture(t),args={...request(f),accessKey:KEY,reason:'CANCELAMENTO SOLICITADO PELO CLIENTE'};
 let workerArgs;
 const official={status:'CANCELADA',environment:'HOMOLOGACAO',accessKey:KEY,eventProtocol:'135260000000111',cStat:135};
 const adapter=createAcbrLibAdapter({...f.options,runner:async command=>{workerArgs=command;return official;}});
 const result=await adapter.cancel(args);
 assert.equal(result.ok,true);
 assert.equal(result.data.cStat,135);
 assert.equal(workerArgs.operation,'cancel');
 assert.equal(workerArgs.accessKey,KEY);
 const wrong=createAcbrLibAdapter({...f.options,runner:async()=>({...official,accessKey:'0'.repeat(44)})});
 assert.equal((await wrong.cancel(args)).ok,false);
});
test('number-range invalidation is blocked for missing native configuration and production',async()=>{
 const adapter=createAcbrLibAdapter({});
 const result=await adapter.inutilize({environment:'production',issuerCnpj:'12345678000195',issuerUF:'SP',
  model:65,series:1,year:2026,startNumber:2,endNumber:3,reason:'NUMEROS NAO UTILIZADOS'});
 assert.equal(result.ok,false);
});

test('preflight validates the exact NF-e/NFC-e model without invoking the native worker or SEFAZ',async t=>{
 const f=fixture(t);let sent=0;
 const a=createAcbrLibAdapter({...f.options,runner:async()=>{sent++;return authorized;}});
 assert.equal((await a.preflight(request(f))).ok,true);
 let cfg=fs.readFileSync(f.options.nfeConfig,'utf8');
 fs.writeFileSync(f.options.nfeConfig,cfg.replace('CSC=TEST_CSC','CSC='));
 assert.equal((await a.preflight(request(f))).ok,false);
 assert.equal(sent,0);
});


test('CC-e is NF-e-only, checks SEFAZ event type/sequence/protocol and never trusts unlinked events',async t=>{
 const f=fixture(t,{documentType:'nfe',model:55});
 const manifest={...f.manifest,documentType:'nfe',model:55};
 const base='3526111234567800019555001000000123100000123';
 let sum=0,weight=2;for(let i=42;i>=0;i--){sum+=Number(base[i])*weight;weight=weight===9?2:weight+1;}
 const dv=11-(sum%11),key=base+(dv>=10?0:dv);
 let calls=0;let seen;
 const adapter=createAcbrLibAdapter({...f.options,runner:async cmd=>{calls++;seen=cmd;
  return {status:'CCE_REGISTERED',cStat:135,environment:'HOMOLOGACAO',
    accessKey:key,eventProtocol:'135260000000567',sequence:1};}});
 const request={type:'nfe',reference:'sale-123',environment:'homologation',
  accessKey:key,sequence:1,eventAt:'2026-11-04T15:40:00-03:00',
  correction:'Correcao da descricao adicional sem alterar valores ou dados cadastrais.'};
 const result=await adapter.cce(request);
 assert.equal(result.ok,true);
 assert.equal(result.data.eventProtocol,'135260000000567');
 assert.equal(seen.operation,'cce');assert.equal(seen.model,55);assert.equal(seen.sequence,1);
 assert.equal((await adapter.cce({...request,type:'nfce'})).ok,false);
 assert.equal((await adapter.cce({...request,environment:'production'})).ok,false);
 assert.equal((await adapter.cce({...request,correction:'Preco do produto alterado para 90 reais'})).ok,false);
 assert.equal(calls,1);
 const mismatched=createAcbrLibAdapter({...f.options,runner:async()=>({status:'CCE_REGISTERED',
  cStat:135,environment:'HOMOLOGACAO',accessKey:key,eventProtocol:'135260000000567',sequence:2})});
 assert.equal((await mismatched.cce(request)).indeterminate,true);
});
