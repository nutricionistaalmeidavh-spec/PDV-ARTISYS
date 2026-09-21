'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {renderDanfeNfce}=require('../js/domains/fiscal/danfe-nfce-renderer');

const manager={userId:'mgr',role:'manager',terminalId:'PDV-01'};

function seed(runtime){
  runtime.db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('mgr','gerente','Gerente','manager','hash','salt',1,'2026-09-20T12:00:00Z','2026-09-20T12:00:00Z');
  runtime.catalog.upsertCategory({id:'cat1',name:'Geral'});
  runtime.catalog.upsertProduct({id:'p1',sku:'SKU-B5',name:'Produto Fiscal',salePriceCents:1000,costCents:500,trackStock:true,minimumStock:1});
  runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:5,reason:'saldo inicial'});
  runtime.cash.openSession({id:'cash1',terminalId:'PDV-01',operatorId:'mgr',initialCashCents:0,actor:manager});
}
function completeSale(runtime,id='sale1'){
  const sale=runtime.sales.openSale({id,saleNumber:`S-${id}`,terminalId:'PDV-01',operatorId:'mgr'},manager);
  runtime.sales.addItem(sale.id,{productId:'p1',quantity:2});
  return runtime.sales.completeSale(sale.id,{payments:[{method:'CASH',amountCents:2000}],actor:manager});
}
function payload(){return{
  documentType:'nfce',environment:'homologation',reference:'S-sale1',
  issuer:{cnpj:'12345678000195',legalName:'Empresa Teste',tradeName:'Empresa Teste',stateRegistration:'123',crt:'1',address:{street:'Rua A',number:'1',district:'Centro',cityCode:'3543402',city:'Ribeirao Preto',state:'SP',zip:'14010000'}},
  identification:{model:'65',series:'1',number:'41',issuedAt:'2026-09-20T18:00:00-03:00',operationNature:'VENDA',numericCode:'12345678'},
  items:[{code:'SKU-B5',description:'Produto Fiscal',quantity:2,unit:'UN',unitPriceCents:1000,grossCents:2000,discountCents:0,totalCents:2000,tax:{ncm:'61091000',cfop:'5102',origin:'0',csosn:'102',pisCst:'49',cofinsCst:'49'}}],
  totals:{subtotalCents:2000,discountCents:0,totalCents:2000,changeCents:0},payments:[{method:'CASH',amountCents:2000}]
};}
async function drain(runtime,max=8){for(let i=0;i<max;i+=1){const result=await runtime.dispatchPending();if(result.attempted===0)break;}}
function invariant(runtime){assert.equal(runtime.sales.getSale('sale1').status,'COMPLETED');assert.equal(runtime.inventory.getBalance('p1'),3);const session=runtime.cash.getOpenSession('PDV-01');assert.equal(runtime.cash.listSessionMovements(session.id).filter(item=>item.type==='SALE'&&item.saleId==='sale1').length,1);}

async function authorizedRuntime({dir,provider}){
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),fiscalArchiveDir:path.join(dir,'fiscal-archive'),fiscalProviderResolver:async()=>provider});
  seed(runtime);completeSale(runtime);
  const doc=runtime.fiscal.requestIssue({saleId:'sale1',provider:'acbr-local',environment:'homologation',documentType:'nfce',reference:'S-sale1',payload:payload(),actor:manager});
  await drain(runtime);return{runtime,doc:runtime.fiscal.getDocument(doc.id)};
}

test('P10/P12 schema v15 is additive and fiscal monitor exposes events and artifact metadata',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-b5-'));
  try{
    const provider={issue:async()=>({ok:true,status:200,data:{cStat:100,chave:'35260912345678000123650010000000411234567890',protocolo:'135260000000041',numero:'41',serie:'1',xml:'<nfeProc><NFe>autorizada</NFe></nfeProc>'}})};
    const {runtime,doc}=await authorizedRuntime({dir,provider});
    const version=Number(runtime.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version);assert.equal(version,15);
    for(const name of ['cancellation_protocol','cancellation_xml_path','cancellation_reason','danfe_print_job_id']) assert.ok(runtime.db.prepare("SELECT 1 FROM pragma_table_info('fiscal_documents') WHERE name=?").get(name),name);
    assert.equal(doc.lifecycleStatus,'AUTHORIZED');assert.ok(doc.xmlPath);assert.equal(fs.existsSync(doc.xmlPath),true);
    const details=runtime.fiscal.getMonitorDocument(doc.id);assert.equal(details.document.id,doc.id);assert.ok(details.events.some(event=>event.status==='AUTHORIZED'));assert.equal(details.sale.id,'sale1');
    runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P11 authorized NFC-e cancels once, persists protocol/event XML and never mutates sale stock or cash',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-b5-cancel-'));let cancelCalls=0;
  try{
    const provider={
      issue:async()=>({ok:true,status:200,data:{cStat:100,chave:'35260912345678000123650010000000411234567890',protocolo:'135260000000041',numero:'41',serie:'1',xml:'<nfeProc>autorizada</nfeProc>'}}),
      cancel:async(_reference,reason,_type,options)=>{cancelCalls+=1;assert.match(reason,/erro de digitacao/i);assert.equal(options.accessKey,'35260912345678000123650010000000411234567890');return{ok:true,status:200,data:{cStat:135,xMotivo:'Evento registrado e vinculado a NF-e',protocolo:'135260000009999',xml:'<procEventoNFe>cancelada</procEventoNFe>'}};}
    };
    const {runtime,doc}=await authorizedRuntime({dir,provider});
    runtime.fiscal.requestCancel(doc.id,{reason:'Erro de digitacao identificado no documento',actor:manager});await drain(runtime);
    const cancelled=runtime.fiscal.getDocument(doc.id);assert.equal(cancelled.lifecycleStatus,'CANCELLED');assert.equal(cancelled.cancellationProtocol,'135260000009999');assert.match(cancelled.cancellationReason,/digitacao/i);assert.ok(cancelled.cancellationXmlPath);assert.equal(fs.existsSync(cancelled.cancellationXmlPath),true);assert.equal(cancelCalls,1);
    assert.throws(()=>runtime.fiscal.requestCancel(doc.id,{reason:'Outra justificativa suficientemente longa',actor:manager}),/cancelado|autorizado/i);assert.equal(cancelCalls,1);invariant(runtime);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P11 requires manager/admin and failed cancellation preserves AUTHORIZED state',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-b5-cancel-fail-'));
  try{
    const provider={issue:async()=>({ok:true,status:200,data:{cStat:100,chave:'35260912345678000123650010000000411234567890',protocolo:'135260000000041',numero:'41',serie:'1'}}),cancel:async()=>({ok:false,status:422,data:{cStat:420,xMotivo:'Rejeicao: evento invalido'},error:'evento invalido'})};
    const {runtime,doc}=await authorizedRuntime({dir,provider});
    assert.throws(()=>runtime.fiscal.requestCancel(doc.id,{reason:'Justificativa valida para cancelamento',actor:{userId:'cash',role:'cashier'}}),/permissao/i);
    runtime.fiscal.requestCancel(doc.id,{reason:'Justificativa valida para cancelamento',actor:manager});await drain(runtime);
    const current=runtime.fiscal.getDocument(doc.id);assert.equal(current.lifecycleStatus,'AUTHORIZED');assert.equal(current.cancellationProtocol,null);assert.ok(runtime.fiscal.listEvents(doc.id).some(event=>event.eventType==='CANCEL_FAILED'));invariant(runtime);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P12 authorized XML survives runtime restart and can be read only through fiscal artifact service',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-b5-restart-'));const dbPath=path.join(dir,'pdv.sqlite');const archive=path.join(dir,'fiscal-archive');
  try{
    const first=await authorizedRuntime({dir,provider:{issue:async()=>({ok:true,status:200,data:{cStat:100,chave:'35260912345678000123650010000000411234567890',protocolo:'135260000000041',numero:'41',serie:'1',xml:'<nfeProc id="persistente" />'}})}});const id=first.doc.id;const stored=first.doc.xmlPath;first.runtime.close();
    const second=createPdvRuntime({dbPath,fiscalArchiveDir:archive});const restored=second.fiscal.getDocument(id);assert.equal(restored.xmlPath,stored);assert.match(second.fiscal.readXml(id,'authorized'),/persistente/);second.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P13 renders and queues a DANFE NFC-e from the authorized canonical document',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-b5-danfe-'));
  try{
    const {runtime,doc}=await authorizedRuntime({dir,provider:{issue:async()=>({ok:true,status:200,data:{cStat:100,chave:'35260912345678000123650010000000411234567890',protocolo:'135260000000041',numero:'41',serie:'1'}})}});
    const text=renderDanfeNfce({document:runtime.fiscal.getDocument(doc.id)});assert.match(text,/DANFE NFC-e/);assert.match(text,/3526 0912/);assert.match(text,/135260000000041/);assert.match(text,/Produto Fiscal/);
    const queued=runtime.fiscal.queueDanfe(doc.id,{actor:manager,width:42});assert.equal(queued.type,'DANFE_NFCE');assert.equal(queued.entityType,'fiscal-document');assert.match(queued.payload.text,/DANFE NFC-e/);assert.equal(runtime.fiscal.getDocument(doc.id).danfePrintJobId,queued.id);
    const reprint=runtime.printing.reprint(queued.id);assert.equal(reprint.type,'REPRINT');assert.equal(reprint.entityId,doc.id);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
