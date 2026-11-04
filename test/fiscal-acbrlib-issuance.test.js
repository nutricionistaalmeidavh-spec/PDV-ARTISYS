'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createFiscalDraftService}=require('../server/acbrlib/fiscal-draft-service');
const {createFiscalIssuanceService}=require('../server/acbrlib/fiscal-issuance-service');
function fixture(t,adapter){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acbr-issue-tdd-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const db=openDatabase(':memory:');t.after(()=>db.close());runMigrations(db);
 let saleStatus='COMPLETED';
 const sales={getSaleDetails:()=>({id:'sale-1',saleNumber:'100',status:saleStatus,
 subtotalCents:2000,discountCents:200,totalCents:1800,changeCents:200,completedAt:'2026-11-04T13:45:00-03:00',
 items:[{id:'i1',productId:'prod1',productName:'CAFÉ',sku:'CAF-01',quantity:2,unitPriceCents:1000,
 totalCents:2000,allocatedDiscountCents:200,netTotalCents:1800}],
 payments:[{method:'CASH',amountCents:2000}]})};
 const drafts=createFiscalDraftService({db,sales,now:()=> '2026-11-04T15:00:00-03:00'});
 drafts.saveCompany({cnpj:'12345678000195',name:'EMPRESA TESTE',stateRegistration:'123456789',uf:'SP',
 crt:'1',ibsCbsRegime:'regular',environment:'homologation',series:1,street:'RUA DAS FLORES',streetNumber:'20',
 district:'CENTRO',municipalityCode:'3543402',municipalityName:'RIBEIRAO PRETO',postalCode:'14000000'});
 drafts.saveProductProfile({productId:'prod1',ncm:'09012100',cfop:'5102',origin:'0',
 csosn:'102',cAtivSN:'01',pisCst:'49',cofinsCst:'49',unit:'UN',
 ibsCbsCst:'000',cClassTrib:'000001',zeroLegacyTaxesConfirmed:true,
 reformTax:{baseCents:1800,ibsUfRate:'0.1000',ibsUfCents:2,
 ibsMunRate:'0.0000',ibsMunCents:0,cbsRate:'0.9000',cbsCents:16},
 reviewedBy:'contador',reviewedAt:'2026-11-04'});
 const draft=drafts.prepareSale('sale-1');
 const inputDir=path.join(dir,'inputs');
 function build(allowHomologation=false){
  return createFiscalIssuanceService({db,drafts,inputDir,
   sales,adapter:adapter||{issue:async()=>({ok:true,status:200,data:{chave_nfe:'1'.repeat(44),protocolo:'135260000000001',xml:'<authorized/>'}}),
    query:async()=>({ok:false,indeterminate:true})},
   allowHomologation,randomCNF:()=> '12345678',now:()=> '2026-11-04T15:00:00-03:00'});
 }
 return {db,dir,inputDir,draft,drafts,build,setSaleStatus(value){saleStatus=value;}};
}
test('only reviewed canonical drafts can be staged with matching manifest SHA and private files',t=>{
 const f=fixture(t);
 const issue=f.build();
 const ready=issue.prepare(f.draft.id);
 assert.equal(ready.status,'READY');
 assert.ok(ready.reference.startsWith('acbr-'));
 const iniFile=path.join(f.inputDir,ready.reference+'.ini');
 const manifest=JSON.parse(fs.readFileSync(path.join(f.inputDir,ready.reference+'.json'),'utf8'));
 assert.equal(manifest.snapshotHash,f.draft.snapshotHash);
 assert.equal(manifest.iniSha256,createHash('sha256').update(fs.readFileSync(iniFile)).digest('hex'));
 assert.match(fs.readFileSync(iniFile,'utf8'),/\[IBSCBS001\]/);
 assert.equal(issue.prepare(f.draft.id).reference,ready.reference);
});
test('no real transmission unless manually enabled in homologation mode',async t=>{
 const f=fixture(t);const issue=f.build();
 issue.prepare(f.draft.id);
 await assert.rejects(()=>issue.issue(f.draft.id),/homologa|desabilitad|bloquead/i);
 assert.equal(f.drafts.getDocument(f.draft.id).status,'READY');
});
test('successful authorization stores key and protocol, never retries same fiscal number',async t=>{
 let calls=0;
 const f=fixture(t,{issue:async()=>{calls++;return {ok:true,data:{chave_nfe:'1'.repeat(44),protocolo:'135260000000001',xml:'<authorized/>'}}},query:async()=>{calls++;return {ok:false,indeterminate:true};}});
 const issue=f.build(true);issue.prepare(f.draft.id);
 const result=await issue.issue(f.draft.id);
 assert.equal(result.status,'AUTHORIZED');
 assert.equal(result.protocol,'135260000000001');
 assert.equal(f.drafts.getDocument(f.draft.id).status,'AUTHORIZED');
 await assert.rejects(()=>issue.issue(f.draft.id),/autorizad|enviad|reenvio|consulta/i);
 assert.equal(calls,1);
});
test('uncertain worker result permanently blocks blind resend even after service recreation',async t=>{
 let calls=0;const adapter={issue:async()=>{calls++;throw Error('timeout');},query:async()=>({ok:false,indeterminate:true})};
 const f=fixture(t,adapter),issue=f.build(true);
 issue.prepare(f.draft.id);
 const result=await issue.issue(f.draft.id);
 assert.equal(result.status,'UNKNOWN');
 assert.equal(f.drafts.getDocument(f.draft.id).status,'UNKNOWN');
 const next=f.build(true);
 await assert.rejects(()=>next.issue(f.draft.id),/consulta|reenvio|indeterminad/i);
 assert.equal(calls,1);
});
test('corrupted INI is rejected before marking any operation as sent',async t=>{
 const f=fixture(t);const issue=f.build(true),ready=issue.prepare(f.draft.id);
 fs.appendFileSync(path.join(f.inputDir,ready.reference+'.ini'),'\nMUDANCA=1');
 await assert.rejects(()=>issue.issue(f.draft.id),/hash|SHA-256|diverge|alterad|manifesto|arquivo/i);
 assert.equal(f.drafts.getDocument(f.draft.id).status,'READY');
});

test('sale voided after drafting can never be sent to SEFAZ',async t=>{
 let sent=false;
 const adapter={issue:async()=>{sent=true;return {ok:true}},query:async()=>({ok:false})};
 const f=fixture(t,adapter),issue=f.build(true);
 issue.prepare(f.draft.id);
 f.setSaleStatus('CANCELLED');
 await assert.rejects(()=>issue.issue(f.draft.id),/cancelad|concluíd|venda/i);
 assert.equal(sent,false);
 assert.equal(f.drafts.getDocument(f.draft.id).status,'READY');
});

test('missing local ACBr DLL or certificate config cannot consume invoice attempt state',async t=>{
 let sent=false;
 const f=fixture(t,{status:async()=>({ok:true,data:{configured:true,ready:false}}),issue:async()=>{sent=true;}});
 const service=f.build(true);
 service.prepare(f.draft.id);
 await assert.rejects(()=>service.issue(f.draft.id),/biblioteca|configura|ACBr|ausent/i);
 assert.equal(sent,false);
 assert.equal(f.drafts.getDocument(f.draft.id).status,'READY');
});
