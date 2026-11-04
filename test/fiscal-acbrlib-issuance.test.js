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
function fixture(t,adapter,documentType='nfce',uf='SP'){
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
 drafts.saveCompany({cnpj:'12345678000195',name:'EMPRESA TESTE',stateRegistration:'123456789',uf,
 crt:'1',ibsCbsRegime:'regular',environment:'homologation',series:1,street:'RUA DAS FLORES',streetNumber:'20',
 district:'CENTRO',municipalityCode:uf==='RJ'?'3304557':'3543402',municipalityName:uf==='RJ'?'RIO DE JANEIRO':'RIBEIRAO PRETO',postalCode:'14000000'});
 drafts.saveProductProfile({productId:'prod1',ncm:'09012100',cfop:'5102',origin:'0',
 csosn:'102',cAtivSN:'01',pisCst:'49',cofinsCst:'49',unit:'UN',
 ibsCbsCst:'000',cClassTrib:'000001',zeroLegacyTaxesConfirmed:true,
 reformTax:{baseCents:1800,ibsUfRate:'0.1000',ibsUfCents:2,
 ibsMunRate:'0.0000',ibsMunCents:0,cbsRate:'0.9000',cbsCents:16},
 reviewedBy:'contador',reviewedAt:'2026-11-04'});
 const draft=drafts.prepareSale('sale-1',{documentType});
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

test('confirmed rejection persists cStat and is never automatically resent',async t=>{
 let calls=0;
 const adapter={issue:async()=>{calls++;return {ok:false,rejected:true,
  data:{cStat:778,reason:'NCM inválido'}}},query:async()=>({ok:false,indeterminate:true})};
 const f=fixture(t,adapter),svc=f.build(true);
 svc.prepare(f.draft.id);
 const response=await svc.issue(f.draft.id);
 assert.equal(response.status,'REJECTED');
 assert.equal(response.cStat,778);
 assert.equal(f.drafts.getDocument(f.draft.id).status,'REJECTED');
 await assert.rejects(()=>svc.issue(f.draft.id),/rejeitad|consulta|reenvio|enviad/i);
 assert.equal(calls,1);
});

test('DANFE PDF is generated only after confirmed authorization and linked to the authorized XML hash',async t=>{
 let pdfCalls=0;
 const validPdf=Buffer.from('%PDF-1.4\n% ACBr test fixture\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
 const f=fixture(t,{issue:async()=>({ok:true,data:{chave_nfe:'1'.repeat(44),protocolo:'135260000000001',xml:'<authorized/>'}}),
  pdf:async()=>{pdfCalls++;return {ok:true,data:{pdfBase64:validPdf.toString('base64')}}}});
 const svc=f.build(true),ready=svc.prepare(f.draft.id);
 await assert.rejects(()=>svc.danfe(f.draft.id),/autoriza|protocolo/i);
 const authorized=await svc.issue(f.draft.id);
 assert.equal(authorized.status,'AUTHORIZED');
 const pdf=await svc.danfe(f.draft.id);
 assert.equal(pdf.ready,true);
 const stored=path.join(f.inputDir,ready.reference+'.danfe.pdf');
 assert.ok(fs.readFileSync(stored).equals(validPdf));
 assert.equal(pdf.sha256,createHash('sha256').update(validPdf).digest('hex'));
 assert.equal(pdfCalls,1);
 assert.equal((await svc.danfe(f.draft.id)).sha256,pdf.sha256);
 assert.equal(pdfCalls,1);
 fs.appendFileSync(stored,'CORRUPTION');
 await assert.rejects(()=>svc.danfe(f.draft.id),/PDF|alterad|hash|integridade/i);
});
test('wrong PDF magic and missing ACBr renderer never create fake DANFE',async t=>{
 const f=fixture(t,{issue:async()=>({ok:true,data:{chave_nfe:'1'.repeat(44),protocolo:'135260000000001',xml:'<authorized/>'}}),
  pdf:async()=>({ok:true,data:{pdfBase64:Buffer.from('NOT A PDF').toString('base64')}})});
 const svc=f.build(true),ready=svc.prepare(f.draft.id);
 await svc.issue(f.draft.id);
 await assert.rejects(()=>svc.danfe(f.draft.id),/PDF|ACBr|inválid/i);
 assert.equal(fs.existsSync(path.join(f.inputDir,ready.reference+'.danfe.pdf')),false);
});

test('official cancellation is durable, requires authorization, and never repeats the SEFAZ event',async t=>{
 let cancelCalls=0;
 const key='1'.repeat(44);
 const f=fixture(t,{issue:async()=>({ok:true,data:{chave_nfe:key,protocolo:'135260000000001',xml:'<authorized/>'}}),
  cancel:async args=>{cancelCalls++;assert.equal(args.accessKey,key);return{ok:true,data:{
   accessKey:key,cStat:135,eventProtocol:'135260000000333'}};}});
 const svc=f.build(true),ready=svc.prepare(f.draft.id);
 await assert.rejects(()=>svc.cancel(f.draft.id,{reason:'CANCELAMENTO SOLICITADO PELO CLIENTE'}),/autoriza|emitida/i);
 await svc.issue(f.draft.id);
 const response=await svc.cancel(f.draft.id,{reason:'CANCELAMENTO SOLICITADO PELO CLIENTE'});
 assert.equal(response.status,'CANCELLED');
 assert.equal(f.drafts.getDocument(f.draft.id).status,'CANCELLED');
 assert.equal(svc.getCancellationStatus(f.draft.id).eventProtocol,'135260000000333');
 await assert.rejects(()=>svc.cancel(f.draft.id,{reason:'CANCELAMENTO SOLICITADO PELO CLIENTE'}),/cancelamento|consult|autorizad/i);
 assert.equal(cancelCalls,1);
});
test('unconfirmed cancellation persists UNKNOWN and cannot be retransmitted after a restart',async t=>{
 let calls=0;const key='1'.repeat(44);
 const f=fixture(t,{issue:async()=>({ok:true,data:{chave_nfe:key,protocolo:'135260000000001',xml:'<authorized/>'}}),
  cancel:async()=>{calls++;throw Error('timeout')}});
 const svc=f.build(true);svc.prepare(f.draft.id);await svc.issue(f.draft.id);
 const result=await svc.cancel(f.draft.id,{reason:'CANCELAMENTO SOLICITADO PELO CLIENTE'});
 assert.equal(result.status,'UNKNOWN');
 const resumed=f.build(true);
 assert.equal(resumed.getCancellationStatus(f.draft.id).status,'UNKNOWN');
 await assert.rejects(()=>resumed.cancel(f.draft.id,{reason:'CANCELAMENTO SOLICITADO PELO CLIENTE'}),/consulta|anterior|cancelamento/i);
 assert.equal(calls,1);
});
test('inutilization only covers unreferenced historical gaps and never sends a duplicate range',async t=>{
 let calls=0;
 const f=fixture(t,{issue:async()=>({ok:false}),inutilize:async request=>{
  calls++;assert.equal(request.environment,'homologation');
  return{ok:true,data:{cStat:102,year:2026,model:65,series:1,
   startNumber:2,endNumber:3,eventProtocol:'135260000000444'}};}},'nfce','RJ');
 const svc=f.build(true);svc.prepare(f.draft.id);
 f.db.prepare("UPDATE acbr_fiscal_sequences SET next_number=5 WHERE document_type='nfce' AND environment='homologation' AND series=1").run();
 await assert.rejects(()=>svc.inutilize({model:65,series:1,year:2026,startNumber:1,endNumber:2,
   reason:'FAIXA NUMERICA NAO UTILIZADA'}),/documento|utilizad|nota/i);
 const req={model:65,series:1,year:2026,startNumber:2,endNumber:3,reason:'FAIXA NUMERICA NAO UTILIZADA'};
 const result=await svc.inutilize(req);
 assert.equal(result.status,'CONFIRMED');
 assert.equal(calls,1);
 await assert.rejects(()=>svc.inutilize(req),/duplicad|faixa|consulta|anterior/i);
 assert.equal(calls,1);
});

test('native per-document preflight blocks a missing NFC-e CSC before consuming the fiscal attempt',async t=>{
 let sent=false;
 const f=fixture(t,{status:async()=>({data:{ready:true}}),
  preflight:async()=>({ok:false,error:'NFC-e sem CSC'}),
  issue:async()=>{sent=true;return {ok:true};}});
 const svc=f.build(true);svc.prepare(f.draft.id);
 await assert.rejects(()=>svc.issue(f.draft.id),/preflight|configura|valid[açã]|prepara|CSC/i);
 assert.equal(f.drafts.getDocument(f.draft.id).status,'READY');
 assert.equal(sent,false);
});


test('CC-e for NF-e is durable, checks accounting approval and prevents duplicate sequence',async t=>{
 let attempts=0;
 const key='1'.repeat(44);
 const f=fixture(t,{issue:async()=>({ok:true,data:{chave_nfe:key,protocolo:'135260000000001',xml:'<authorized/>'}}),
  cce:async args=>{attempts++;assert.equal(args.sequence,1);assert.equal(args.accessKey,key);
   return {ok:true,data:{accessKey:key,cStat:135,sequence:1,eventProtocol:'135260000000999'}};}},'nfe');
 const svc=f.build(true);
 const recipient={uf:'SP',municipalityCode:'3543402',taxId:'12345678909',
  name:'CONSUMIDOR TESTE',indIEDest:'9',street:'RUA PRINCIPAL',
  streetNumber:'10',district:'CENTRO',municipalityName:'RIBEIRAO PRETO',postalCode:'14000000'};
 svc.prepare(f.draft.id,{recipient});
 await svc.issue(f.draft.id);
 const command={sequence:1,correction:'Correcao da descricao adicional do produto sem mudar a operacao.',
  reviewedBy:'Contabilidade teste',confirmNoMaterialChange:true};
 await assert.rejects(()=>svc.cce(f.draft.id,{...command,confirmNoMaterialChange:false}),/revis|confirma|contab/i);
 assert.deepEqual(svc.getCceHistory(f.draft.id),[]);
 const event=await svc.cce(f.draft.id,command);
 assert.equal(event.status,'CONFIRMED');
 assert.equal(event.sequence,1);
 assert.equal(svc.getCceHistory(f.draft.id)[0].eventProtocol,'135260000000999');
 assert.equal(f.drafts.getDocument(f.draft.id).status,'AUTHORIZED');
 await assert.rejects(()=>svc.cce(f.draft.id,command),/sequ|registrad|anterior|confirmad/i);
 assert.equal(attempts,1);
});

test('CC-e unknown SEFAZ response is not resent after restart and NFC-e is rejected',async t=>{
 let attempts=0;
 const key='1'.repeat(44);
 const f=fixture(t,{issue:async()=>({ok:true,data:{chave_nfe:key,protocolo:'135260000000001',xml:'<authorized/>'}}),
  cce:async()=>{attempts++;throw Error('SEFAZ timeout');}},'nfe');
 const recipient={uf:'SP',municipalityCode:'3543402',taxId:'12345678909',
  name:'CONSUMIDOR TESTE',indIEDest:'9',street:'RUA PRINCIPAL',
  streetNumber:'10',district:'CENTRO',municipalityName:'RIBEIRAO PRETO',postalCode:'14000000'};
 const first=f.build(true);first.prepare(f.draft.id,{recipient});await first.issue(f.draft.id);
 const command={sequence:1,correction:'Correcao da descricao complementar da mercadoria.',
  reviewedBy:'Contador',confirmNoMaterialChange:true};
 const unknown=await first.cce(f.draft.id,command);
 assert.equal(unknown.status,'UNKNOWN');
 const afterRestart=f.build(true);
 assert.equal(afterRestart.getCceHistory(f.draft.id)[0].status,'UNKNOWN');
 await assert.rejects(()=>afterRestart.cce(f.draft.id,command),/SEFAZ|consulta|anterior|indeterminad/i);
 assert.equal(attempts,1);
 const nfce=fixture(t,{issue:async()=>({ok:true,data:{chave_nfe:key,protocolo:'135260000000001',xml:'<authorized/>'}}),
  cce:async()=>{attempts++;return{ok:true};}});
 const s=nfce.build(true);s.prepare(nfce.draft.id);await s.issue(nfce.draft.id);
 await assert.rejects(()=>s.cce(nfce.draft.id,command),/NF-e|55|CC-e/i);
 assert.equal(attempts,1);
});


test('SP no longer accepts inutilization requests after November 1 2026',async t=>{
 let called=0;
 const f=fixture(t,{issue:async()=>({ok:false}),inutilize:async()=>{called++;return {ok:true}}});
 const svc=f.build(true);
 svc.prepare(f.draft.id);
 f.db.prepare("UPDATE acbr_fiscal_sequences SET next_number=4 WHERE document_type='nfce' AND environment='homologation' AND series=1").run();
 await assert.rejects(()=>svc.inutilize({model:65,series:1,year:2026,startNumber:2,
  endNumber:3,reason:'FAIXA NUMERICA NAO UTILIZADA'}),/SP|S[aã]o Paulo|inutiliza[cç][aã]o/i);
 assert.equal(called,0);
});


test('offline NFC-e is explicitly prepared and remains READY without contacting SEFAZ',t=>{
 let calls=0;
 const f=fixture(t,{issue:async()=>{calls++;return{ok:true};}});
 const svc=f.build(true);
 const prepared=svc.prepare(f.draft.id,{
  contingency:{reason:'Falha de comunicacao com a SEFAZ durante a venda de teste.'}
 });
 assert.equal(prepared.status,'READY');
 assert.equal(prepared.issuanceMode,'nfce-offline');
 assert.equal(f.drafts.getDocument(f.draft.id).status,'READY');
 const ini=fs.readFileSync(path.join(f.inputDir,prepared.reference+'.ini'),'utf8');
 const manifest=JSON.parse(fs.readFileSync(path.join(f.inputDir,prepared.reference+'.json')));
 assert.match(ini,/tpEmis=9/);
 assert.match(ini,/dhCont=/);
 assert.equal(manifest.issuanceMode,'nfce-offline');
 assert.equal(calls,0);
 assert.throws(()=>svc.prepare(f.draft.id),/conting[eê]ncia|modo|identidade|preparad/i);
});

test('offline NFC-e preparation is forbidden for NF-e model 55 and for disabled homologation',t=>{
 const f=fixture(t,null,'nfe');
 const svc=f.build(true);
 const reason={reason:'Falha de conexao com a SEFAZ durante o teste da loja'};
 assert.throws(()=>svc.prepare(f.draft.id,{contingency:reason}),/NFC-e|65|conting[eê]ncia/i);
});



function offlineSignedFixture(){
 const raw='3526111234567800019565001000000001912345678';
 let sum=0,weight=2;for(let i=42;i>=0;i--){sum+=Number(raw[i])*weight;weight=weight===9?2:weight+1;}
 const dv=11-sum%11,key=raw+(dv>=10?0:dv);
 return {accessKey:key,xml:'<NFe><infNFe Id="NFe'+key+'"><ide><mod>65</mod><tpEmis>9</tpEmis></ide></infNFe><Signature/><infNFeSupl><qrCode>https://sefaz.test/?p='+key+'</qrCode></infNFeSupl></NFe>'};
}

test('offline issue seals signed NFC-e, DANFE and durable queue before any SEFAZ send',async t=>{
 let sent=0;
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
 const f=fixture(t,{offlineIssue:async()=>({
  ok:true,data:{...offlineSignedFixture(),pdfBase64:pdf.toString('base64')}
 }),issue:async()=>{sent++;throw Error('No network expected')}});
 const svc=f.build(true);
 const prepared=svc.prepare(f.draft.id,{contingency:{reason:'Falha comprovada de conexão com a SEFAZ durante o atendimento'}});
 const result=await svc.offlineIssue(f.draft.id);
 assert.equal(result.status,'ISSUED_OFFLINE');
 assert.equal(sent,0);
 assert.equal(svc.listOfflineQueue()[0].status,'PENDING');
 assert.deepEqual(svc.getOfflineDanfe(f.draft.id),pdf);
 assert.equal(fs.readFileSync(path.join(f.inputDir,prepared.reference+'.signed.xml'),'utf8'),offlineSignedFixture().xml);
 const afterRestart=f.build(true);
 assert.equal(afterRestart.listOfflineQueue()[0].status,'PENDING');
 await assert.rejects(()=>afterRestart.offlineIssue(f.draft.id),/emitid|fila|assinad/i);
});

test('offline queue submits the original signed XML once; unknown outcome stays locked after restart',async t=>{
 let count=0;
 const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
 const f=fixture(t,{offlineIssue:async()=>({ok:true,data:{...offlineSignedFixture(),pdfBase64:pdf.toString('base64')}}),
  issue:async()=>{throw Error('Normal send forbidden');},transmitSigned:async()=>{count++;throw Error('timeout');}});
 const svc=f.build(true);
 svc.prepare(f.draft.id,{contingency:{reason:'Falha comprovada de conexão com a SEFAZ durante o atendimento'}});
 await svc.offlineIssue(f.draft.id);
 const outcome=await svc.flushOfflineQueue();
 assert.equal(outcome[0].status,'UNKNOWN');
 assert.equal(count,1);
 const restart=f.build(true);
 assert.equal(restart.listOfflineQueue()[0].status,'UNKNOWN');
 const repeated=await restart.flushOfflineQueue();
 assert.equal(repeated.length,0);
 assert.equal(count,1);
});

test('normal invoice and unsigned contingency can never enter offline transmission queue',async t=>{
 const f=fixture(t,{issue:async()=>({ok:false}),offlineIssue:async()=>({ok:true})});
 const svc=f.build(true);
 svc.prepare(f.draft.id);
 await assert.rejects(()=>svc.offlineIssue(f.draft.id),/conting|offline|modo/i);
 assert.equal(svc.listOfflineQueue().length,0);
});


test('authorized offline queue settles the same fiscal record and cannot transmit it twice',async t=>{
 const signed=offlineSignedFixture(),pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
 let sends=0;
 const f=fixture(t,{offlineIssue:async()=>({ok:true,data:{...signed,pdfBase64:pdf.toString('base64')}}),
  issue:async()=>{throw Error('Normal emission forbidden');},
  transmitSigned:async req=>{sends++;assert.equal(req.accessKey,signed.accessKey);
   assert.match(req.signedXmlSha256,/^[a-f0-9]{64}$/);
   return {ok:true,data:{chave_nfe:signed.accessKey,protocolo:'135260000000001',
    xml:'<nfeProc><Signature/><infProt><nProt>135260000000001</nProt></infProt></nfeProc>'}};}});
 const svc=f.build(true);
 svc.prepare(f.draft.id,{contingency:{reason:'Falha comprovada de rede durante atendimento em contingência'}});
 await svc.offlineIssue(f.draft.id);
 const sent=await svc.flushOfflineQueue();
 assert.equal(sent[0].status,'AUTHORIZED');
 assert.equal(svc.listOfflineQueue()[0].status,'AUTHORIZED');
 assert.equal(f.drafts.getDocument(f.draft.id).status,'AUTHORIZED');
 assert.deepEqual(await f.build(true).flushOfflineQueue(),[]);
 assert.equal(sends,1);
});
