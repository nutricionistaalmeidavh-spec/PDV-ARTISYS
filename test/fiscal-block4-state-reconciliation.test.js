'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {FISCAL_STATES,assertFiscalTransition,classifyIssueResult,classifyReconcileResult}=require('../js/domains/fiscal/fiscal-state-machine');

function actor(){return{userId:'mgr',role:'manager',terminalId:'PDV-01'};}
function seed(runtime){
  runtime.db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run('mgr','gerente','Gerente','manager','hash','salt',1,'2026-09-20T12:00:00Z','2026-09-20T12:00:00Z');
  runtime.catalog.upsertCategory({id:'cat1',name:'Geral'});
  runtime.catalog.upsertProduct({id:'p1',sku:'SKU-B4',name:'Produto Fiscal',salePriceCents:1000,costCents:500,trackStock:true,minimumStock:1});
  runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:5,reason:'saldo inicial'});
  runtime.cash.openSession({id:'cash1',terminalId:'PDV-01',operatorId:'mgr',initialCashCents:0,actor:actor()});
}
function completeSale(runtime,id='sale1'){
  const sale=runtime.sales.openSale({id,saleNumber:`S-${id}`,terminalId:'PDV-01',operatorId:'mgr'},actor());
  runtime.sales.addItem(sale.id,{productId:'p1',quantity:2});
  return runtime.sales.completeSale(sale.id,{payments:[{method:'CASH',amountCents:2000}],actor:actor()});
}
function autoIssueResolver(){return async({sale})=>({configured:true,autoIssue:true,provider:'focus',environment:'homologation',documentType:'nfce',reference:sale.saleNumber||sale.id,payload:{natureza_operacao:'Venda'}});}
async function drain(runtime,max=8){for(let i=0;i<max;i+=1){const result=await runtime.dispatchPending();if(result.attempted===0)break;}}

function assertSaleInvariant(runtime,saleId='sale1'){
  assert.equal(runtime.sales.getSale(saleId).status,'COMPLETED');
  assert.equal(runtime.inventory.getBalance('p1'),3);
  const session=runtime.cash.getOpenSession('PDV-01');
  assert.equal(runtime.cash.listSessionMovements(session.id).filter(item=>item.type==='SALE'&&item.saleId===saleId).length,1);
}

test('P8 state machine allows only explicit fiscal transitions and classifies ambiguous responses',()=>{
  assert.equal(FISCAL_STATES.UNKNOWN,'UNKNOWN');
  assert.doesNotThrow(()=>assertFiscalTransition('PENDING','PROCESSING'));
  assert.doesNotThrow(()=>assertFiscalTransition('PROCESSING','UNKNOWN'));
  assert.doesNotThrow(()=>assertFiscalTransition('UNKNOWN','AUTHORIZED'));
  assert.throws(()=>assertFiscalTransition('AUTHORIZED','PROCESSING'),/Transicao fiscal invalida/);
  assert.equal(classifyIssueResult({ok:false,status:408,error:'timeout'}),'UNKNOWN');
  assert.equal(classifyIssueResult({ok:false,status:422,data:{cStat:225,xMotivo:'Rejeicao'}}),'REJECTED');
  assert.equal(classifyIssueResult({ok:false,status:503,error:'servico indisponivel'}),'FAILED');
  assert.equal(classifyReconcileResult({ok:false,status:422,data:{cStat:217}}),'NOT_FOUND');
  assert.equal(classifyReconcileResult({ok:true,status:200,data:{cStat:100}}),'AUTHORIZED');
});

test('P9 E2E: timeout becomes UNKNOWN, reconciliation authorizes, and issue is never duplicated',async()=>{
  let issueCalls=0;let queryCalls=0;
  const provider={
    issue:async()=>{issueCalls+=1;return{ok:false,status:408,error:'timeout apos envio'};},
    query:async()=>{queryCalls+=1;return{ok:true,status:200,data:{cStat:100,chave:'35260912345678000123650010000000011234567890',protocolo:'135260000000001',numero:'1',serie:'1'}};}
  };
  const runtime=createPdvRuntime({fiscalProviderResolver:async()=>provider,fiscalAutoIssueResolver:autoIssueResolver()});
  seed(runtime);completeSale(runtime);await drain(runtime);
  const [document]=runtime.fiscal.listDocuments({saleId:'sale1'});
  assert.equal(document.lifecycleStatus,'UNKNOWN');
  assert.equal(document.reconcileRequired,true);
  assert.equal(issueCalls,1);
  assert.throws(()=>runtime.fiscal.retryIssue(document.id,{actor:actor()}),/reconciliacao/i);
  runtime.fiscal.requestReconcile(document.id,{actor:actor()});
  await drain(runtime);
  const authorized=runtime.fiscal.getDocument(document.id);
  assert.equal(authorized.lifecycleStatus,'AUTHORIZED');
  assert.equal(authorized.status,'ISSUED');
  assert.equal(authorized.accessKey,'35260912345678000123650010000000011234567890');
  assert.equal(authorized.authorizationProtocol,'135260000000001');
  assert.equal(issueCalls,1);
  assert.equal(queryCalls,1);
  assert.equal(runtime.fiscal.listDocuments({saleId:'sale1'}).length,1);
  assertSaleInvariant(runtime);
  const events=runtime.fiscal.listEvents(document.id);
  assert.ok(events.some(event=>event.status==='PROCESSING'));
  assert.ok(events.some(event=>event.status==='UNKNOWN'));
  assert.ok(events.some(event=>event.status==='AUTHORIZED'));
  runtime.close();
});

test('P8 rejection is terminal for the same document and preserves sale stock and cash',async()=>{
  let calls=0;
  const runtime=createPdvRuntime({
    fiscalProviderResolver:async()=>({issue:async()=>{calls+=1;return{ok:false,status:422,data:{cStat:225,xMotivo:'Falha no schema XML'},error:'Falha no schema XML'};}}),
    fiscalAutoIssueResolver:autoIssueResolver()
  });
  seed(runtime);completeSale(runtime);await drain(runtime);
  const [document]=runtime.fiscal.listDocuments({saleId:'sale1'});
  assert.equal(document.lifecycleStatus,'REJECTED');
  assert.equal(document.sefazCode,'225');
  assert.match(document.sefazMessage,/schema/i);
  assert.equal(calls,1);
  assert.throws(()=>runtime.fiscal.retryIssue(document.id,{actor:actor()}),/rejeitado/i);
  assertSaleInvariant(runtime);
  runtime.close();
});

test('P9 UNKNOWN survives restart and NOT_FOUND reconciliation is required before controlled retry',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-b4-'));const dbPath=path.join(dir,'pdv.sqlite');
  let issueCalls=0;
  const first=createPdvRuntime({dbPath,fiscalProviderResolver:async()=>({issue:async()=>{issueCalls+=1;return{ok:false,status:408,error:'timeout'};}}),fiscalAutoIssueResolver:autoIssueResolver()});
  seed(first);completeSale(first);await drain(first);
  const [before]=first.fiscal.listDocuments({saleId:'sale1'});assert.equal(before.lifecycleStatus,'UNKNOWN');first.close();

  let queryCalls=0;
  const second=createPdvRuntime({dbPath,fiscalProviderResolver:async()=>({
    issue:async()=>{issueCalls+=1;return{ok:true,status:200,data:{chave:'KEY-RETRY',protocolo:'PROTO-RETRY',numero:'1',serie:'1'}};},
    query:async()=>{queryCalls+=1;return{ok:false,status:422,data:{cStat:217,xMotivo:'NF-e nao consta na base'},error:'NF-e nao consta na base'};}
  })});
  const restored=second.fiscal.getDocument(before.id);assert.equal(restored.lifecycleStatus,'UNKNOWN');assert.equal(restored.reconcileRequired,true);
  assert.throws(()=>second.fiscal.retryIssue(restored.id,{actor:actor()}),/reconciliacao/i);
  second.fiscal.requestReconcile(restored.id,{actor:actor()});await drain(second);
  const reconciled=second.fiscal.getDocument(restored.id);assert.equal(reconciled.lifecycleStatus,'UNKNOWN');assert.equal(reconciled.reconcileRequired,false);assert.ok(reconciled.lastReconciledAt);
  second.fiscal.retryIssue(restored.id,{actor:actor()});await drain(second);
  const final=second.fiscal.getDocument(restored.id);assert.equal(final.lifecycleStatus,'AUTHORIZED');assert.equal(issueCalls,2);assert.equal(queryCalls,1);assert.equal(second.fiscal.listDocuments({saleId:'sale1'}).length,1);
  assertSaleInvariant(second);second.close();fs.rmSync(dir,{recursive:true,force:true});
});
