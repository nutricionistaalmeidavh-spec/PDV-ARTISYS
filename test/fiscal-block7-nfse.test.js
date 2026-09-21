'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const zlib=require('node:zlib');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {buildNfseDps}=require('../js/domains/nfse/nfse-document-builder');
const {createNfseNationalProvider}=require('../js/domains/nfse/nfse-national-provider');

const actor={userId:'admin',role:'admin'};
const signedDps='<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse"><infDPS Id="DPS1"/><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">signed</Signature></DPS>';
const nfseXml='<?xml version="1.0" encoding="UTF-8"?><NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS1"/></NFSe>';
const key='31062002250516724000160000000000002126046985535602';

test('P18 canonical DPS is a separate service document and validates service/municipality data',()=>{
 const dps=buildNfseDps({reference:'SERV-1',environment:'homologation',issuer:{taxId:'12345678000195',municipalRegistration:'12345',municipalityCode:'3543402'},customer:{taxId:'12345678901',name:'Cliente'},service:{nationalTaxCode:'010101',description:'Consultoria de software',amountCents:15000,municipalityCode:'3543402'}});
 assert.equal(dps.documentType,'nfse');assert.equal(dps.provider,'nfse-national');assert.equal(dps.service.amountCents,15000);assert.equal(dps.issuer.municipalityCode,'3543402');
 assert.throws(()=>buildNfseDps({reference:'x',issuer:{},service:{}}),/municip|servi|valor/i);
});

test('P18 national provider follows official POST /nfse gzip+base64 contract and decodes authorized XML',async()=>{
 let request=null;const requestImpl=async input=>{request=input;return{status:201,body:{tipoAmbiente:2,idDps:'DPS1',chaveAcesso:key,nfseXmlGZipB64:zlib.gzipSync(Buffer.from(nfseXml)).toString('base64')}};};
 const provider=createNfseNationalProvider({environment:'homologation',baseUrl:'https://sefin.example.test',requestImpl,pfx:Buffer.from('fake'),passphrase:'secret'});const result=await provider.issue({reference:'SERV-1',signedDpsXml:signedDps});
 assert.equal(request.method,'POST');assert.equal(request.path,'/nfse');assert.equal(zlib.gunzipSync(Buffer.from(request.body.dpsXmlGZipB64,'base64')).toString(),signedDps);assert.equal(result.ok,true);assert.equal(result.data.accessKey,key);assert.equal(result.data.xml,nfseXml);
});

test('P18 national provider supports query and generic event endpoint without municipal-provider coupling',async()=>{
 const seen=[];const requestImpl=async input=>{seen.push(input);if(input.method==='GET')return{status:200,body:{chaveAcesso:key,nfseXmlGZipB64:zlib.gzipSync(Buffer.from(nfseXml)).toString('base64')}};return{status:200,body:{eventoXmlGZipB64:zlib.gzipSync(Buffer.from('<Evento/>')).toString('base64')}};};
 const provider=createNfseNationalProvider({environment:'homologation',baseUrl:'https://sefin.example.test',requestImpl,pfx:Buffer.from('fake'),passphrase:'secret'});assert.equal((await provider.query(key)).ok,true);assert.equal((await provider.registerEvent(key,{signedEventXml:'<pedRegEvento><Signature>signed</Signature></pedRegEvento>'})).ok,true);assert.equal(seen[0].path,`/nfse/${key}`);assert.equal(seen[1].path,`/nfse/${key}/eventos`);
});

test('P18 service has own durable tables, idempotency and UNKNOWN reconciliation state',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b7-nfse-'));const dbPath=path.join(dir,'pdv.sqlite');let issueCalls=0;
 try{
   let runtime=createPdvRuntime({dbPath,backupDir:path.join(dir,'backups'),nfseProviderResolver:async()=>({issue:async()=>{issueCalls++;return{ok:false,status:408,indeterminate:true,error:'timeout',data:null};},query:async()=>({ok:true,status:200,data:{accessKey:key,xml:nfseXml}})})});
   assert.ok(runtime.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='nfse_documents'").get());
   const doc=runtime.nfse.requestIssue({reference:'SERV-1',environment:'homologation',payload:{canonical:true},signedDpsXml:signedDps,actor});assert.equal(doc.status,'PENDING');await runtime.nfse.processIssue(doc.id,actor);assert.equal(runtime.nfse.getDocument(doc.id).status,'UNKNOWN');assert.equal(issueCalls,1);assert.throws(()=>runtime.nfse.retryIssue(doc.id,actor),/reconcil/i);runtime.close();
   runtime=createPdvRuntime({dbPath,backupDir:path.join(dir,'backups'),nfseProviderResolver:async()=>({query:async()=>({ok:true,status:200,data:{accessKey:key,xml:nfseXml}})})});assert.equal(runtime.nfse.getDocument(doc.id).status,'UNKNOWN');await runtime.nfse.reconcile(doc.id,actor);assert.equal(runtime.nfse.getDocument(doc.id).status,'AUTHORIZED');assert.equal(issueCalls,1);runtime.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
