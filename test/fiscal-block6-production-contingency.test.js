'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createFiscalProductionService}=require('../js/domains/fiscal/fiscal-production-service');
const {renderNfceIni}=require('../server/fiscal-sidecar/acbr-monitor-protocol');

const admin={userId:'admin',role:'admin',terminalId:'PDV-01'};

function setupRuntime(dir,provider=null){
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),backupDir:path.join(dir,'backups'),fiscalArchiveDir:path.join(dir,'fiscal-archive'),fiscalProviderResolver:provider?async()=>provider:async()=>null});
  runtime.catalog.upsertCategory({id:'cat',name:'Geral'});
  runtime.catalog.upsertProduct({id:'p1',sku:'SKU-B6',name:'Produto Fiscal',salePriceCents:1000,costCents:500,trackStock:true,minimumStock:0});
  runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:5,reason:'saldo'});
  runtime.cash.openSession({id:'cash',terminalId:'PDV-01',operatorId:'admin',initialCashCents:0,actor:admin});
  return runtime;
}
function configureHomologation(runtime){
  runtime.fiscalConfiguration.saveCompanySettings({provider:'acbr-local',documentType:'nfce',environment:'homologation',autoIssue:false,cnpj:'12345678000195',stateRegistration:'123456789',legalName:'Empresa Teste LTDA',tradeName:'Empresa Teste',crt:'1',series:'1',operationNature:'VENDA',cscId:'1',address:{street:'Rua A',number:'1',district:'Centro',cityCode:'3543402',city:'Ribeirao Preto',state:'SP',zip:'14010000'}},admin);
  runtime.fiscalConfiguration.upsertProfile({id:'perfil',name:'Perfil',ncm:'61091000',cfop:'5102',origin:'0',csosn:'102',pisCst:'49',cofinsCst:'49',unit:'UN'},admin);
  runtime.fiscalConfiguration.assignProductProfile({productId:'p1',profileId:'perfil'},admin);
  runtime.fiscalConfiguration.initializeSequence({documentType:'nfce',environment:'homologation',series:'1',nextNumber:1},admin);
  runtime.fiscalConfiguration.initializeSequence({documentType:'nfce',environment:'production',series:'1',nextNumber:1},admin);
}
function createPending(runtime){
  const sale=runtime.sales.openSale({id:'sale-b6',saleNumber:'S-B6',terminalId:'PDV-01',operatorId:'admin'},admin);runtime.sales.addItem(sale.id,{productId:'p1',quantity:1});runtime.sales.completeSale(sale.id,{payments:[{method:'CASH',amountCents:1000}],actor:admin});
  const context=runtime.fiscalConfiguration.buildFiscalContextForSale(runtime.sales.getSale(sale.id));
  const payload=require('../js/domains/fiscal/fiscal-document-builder').buildFiscalDocument({sale:runtime.sales.getSale(sale.id),fiscalContext:context,documentType:'nfce',environment:'homologation'});
  const doc=runtime.fiscal.requestIssue({saleId:sale.id,provider:'acbr-local',environment:'homologation',documentType:'nfce',reference:'S-B6',payload,actor:admin});return {saleId:sale.id,doc,payload};
}

test('P14-P15 schema v16 is additive and production is blocked until readiness activation',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-production-'));
  try{
    const runtime=setupRuntime(dir);configureHomologation(runtime);
    const version=Number(runtime.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version);assert.equal(version,16);
    assert.ok(runtime.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fiscal_production_activation'").get());
    assert.ok(runtime.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fiscal_contingency'").get());
    assert.throws(()=>runtime.fiscalConfiguration.saveCompanySettings({...runtime.fiscalConfiguration.getCompanySettings(),environment:'production'},admin),/producao.*bloquead|ativacao/i);
    const readiness=runtime.fiscalProduction.getReadiness();assert.equal(readiness.ready,false);assert.ok(readiness.checks.some(item=>item.key==='certificate'&&!item.passed));assert.ok(readiness.checks.some(item=>item.key==='homologation_authorized'&&!item.passed));
    runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P15 activation is admin-only and requires every blocking readiness check',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-activation-'));
  try{
    const runtime=setupRuntime(dir);configureHomologation(runtime);
    assert.throws(()=>runtime.fiscalProduction.activateProduction({userId:'mgr',role:'manager'}),/admin/i);
    assert.throws(()=>runtime.fiscalProduction.activateProduction(admin),/bloquead|pendenc/i);
    const required=['certificate','csc','sidecar','sefaz','homologation_authorized','homologation_cancelled','danfe_print','backup'];
    for(const key of required) runtime.fiscalProduction.recordEvidence(key,{passed:true,message:'evidencia de teste'},admin);
    const result=runtime.fiscalProduction.activateProduction(admin);assert.equal(result.enabled,true);assert.equal(runtime.fiscalConfiguration.getCompanySettings().environment,'production');assert.equal(runtime.fiscalConfiguration.getCompanySettings().autoIssue,false);
    runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P16 contingency snapshot uses tpEmis=9, dhCont/xJust and preserves cNF across restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-cont-'));const dbPath=path.join(dir,'pdv.sqlite');
  try{
    let runtime=setupRuntime(dir);configureHomologation(runtime);const {doc,payload}=createPending(runtime);const originalCode=payload.identification.numericCode;
    const entry=runtime.fiscalProduction.enterContingency(doc.id,{reason:'Indisponibilidade temporaria da autorizacao SEFAZ',actor:admin});assert.equal(entry.status,'ISSUED');assert.equal(entry.document.identification.numericCode,originalCode);assert.equal(entry.document.contingency.type,'offline');assert.equal(entry.document.contingency.tpEmis,'9');assert.ok(entry.document.contingency.enteredAt);assert.match(entry.document.contingency.reason,/Indisponibilidade/);
    const ini=renderNfceIni(entry.document);assert.match(ini,/tpEmis=9/);assert.match(ini,/dhCont=/);assert.match(ini,/xJust=Indisponibilidade temporaria/);assert.equal(runtime.fiscal.getDocument(doc.id).lifecycleStatus,'PENDING');
    runtime.close();runtime=createPdvRuntime({dbPath,backupDir:path.join(dir,'backups'),fiscalArchiveDir:path.join(dir,'fiscal-archive')});const restored=runtime.fiscalProduction.getContingency(doc.id);assert.equal(restored.status,'ISSUED');assert.equal(restored.document.identification.numericCode,originalCode);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P16 never enters contingency after an ambiguous transmission attempt',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-guard-'));
  try{
    const runtime=setupRuntime(dir);configureHomologation(runtime);const {doc}=createPending(runtime);runtime.fiscal.markProcessing(doc.id,admin);runtime.fiscal.markUnknown(doc.id,{indeterminate:true,error:'timeout'},admin);
    assert.throws(()=>runtime.fiscalProduction.enterContingency(doc.id,{reason:'Falha de comunicacao exige contingencia segura',actor:admin}),/UNKNOWN|reconcili/i);assert.equal(runtime.fiscalProduction.getContingency(doc.id),null);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P16 crash during transmission restarts as RECONCILING, never blind retry',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-crash-'));const dbPath=path.join(dir,'pdv.sqlite');
  try{
    let runtime=setupRuntime(dir);configureHomologation(runtime);const {doc}=createPending(runtime);runtime.fiscalProduction.enterContingency(doc.id,{reason:'SEFAZ indisponivel no momento da venda',actor:admin});runtime.db.prepare("UPDATE fiscal_contingency SET status='TRANSMITTING' WHERE fiscal_document_id=?").run(doc.id);runtime.close();
    runtime=createPdvRuntime({dbPath,backupDir:path.join(dir,'backups'),fiscalArchiveDir:path.join(dir,'fiscal-archive')});assert.equal(runtime.fiscalProduction.getContingency(doc.id).status,'RECONCILING');assert.equal(runtime.fiscal.getDocument(doc.id).lifecycleStatus,'PENDING');runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
