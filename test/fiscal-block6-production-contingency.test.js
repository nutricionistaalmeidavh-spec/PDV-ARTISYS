'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {renderNfceIni}=require('../server/fiscal-sidecar/acbr-monitor-protocol');

const admin={userId:'admin',role:'admin',terminalId:'PDV-01'};
const accessKey='35260912345678000195650010000000421000000420';

function provider({sendResult=null}={}){
  return {
    async createContingency(){return{ok:true,status:200,data:{xml:`<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe${accessKey}"></infNFe></NFe>`,chave:accessKey}};},
    async sendContingency(){return sendResult||{ok:true,status:200,data:{cStat:100,xMotivo:'Autorizado o uso da NF-e',chave:accessKey,protocolo:'135260000123456',numero:'1',serie:'1',xml:'<nfeProc />'}};}
  };
}

function setupRuntime(dir,fiscalProvider=null){
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),backupDir:path.join(dir,'backups'),fiscalArchiveDir:path.join(dir,'fiscal-archive'),fiscalProviderResolver:fiscalProvider?async()=>fiscalProvider:async()=>null});
  runtime.catalog.createUser({id:'admin',username:'admin-b6',name:'Administrador Fiscal',role:'admin',password:'senha-forte-123'},admin);
  runtime.catalog.upsertCategory({id:'cat',name:'Geral'},admin);
  runtime.catalog.upsertProduct({id:'p1',sku:'SKU-B6',name:'Produto Fiscal',salePriceCents:1000,costCents:500,trackStock:true,minimumStock:0},admin);
  runtime.inventory.move({productId:'p1',type:'opening',quantityDelta:5,reason:'saldo'},admin);
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
function createPending(runtime,id='sale-b6',reference='S-B6'){
  const sale=runtime.sales.openSale({id,saleNumber:reference,terminalId:'PDV-01',operatorId:'admin'},admin);runtime.sales.addItem(sale.id,{productId:'p1',quantity:1});runtime.sales.completeSale(sale.id,{payments:[{method:'CASH',amountCents:1000}],actor:admin});
  const context=runtime.fiscalConfiguration.buildFiscalContextForSale(runtime.sales.getSale(sale.id));
  const payload=require('../js/domains/fiscal/fiscal-document-builder').buildFiscalDocument({sale:runtime.sales.getSale(sale.id),fiscalContext:context,documentType:'nfce',environment:'homologation'});
  const doc=runtime.fiscal.requestIssue({saleId:sale.id,provider:'acbr-local',environment:'homologation',documentType:'nfce',reference,payload,actor:admin});return {saleId:sale.id,doc,payload};
}
function seedObjectiveProductionEvidence(runtime){
  runtime.fiscalConfiguration.saveCertificateMetadata({certificateName:'empresa.pfx',fingerprint:'AA:BB',subject:'CN=Empresa',serialNumber:'123',validFrom:'2026-01-01T00:00:00.000Z',validTo:'2035-01-01T00:00:00.000Z',cnpj:'12345678000195'});
  runtime.fiscalProduction.recordEvidence('csc',{passed:true,message:'CSC protegido configurado.'},admin);
  runtime.fiscalProduction.recordEvidence('sidecar',{passed:true,message:'Sidecar local respondeu.'},admin);
  runtime.fiscalProduction.recordEvidence('sefaz',{passed:true,message:'SEFAZ respondeu em homologacao.'},admin);
  const {doc}=createPending(runtime,'sale-gate','S-GATE');
  runtime.fiscal.markProcessing(doc.id,admin);
  runtime.fiscal.markAuthorized(doc.id,{status:200,data:{cStat:100,xMotivo:'Autorizado',chave:accessKey,protocolo:'135260000123456',numero:'1',serie:'1',xml:'<nfeProc />'}},admin);
  runtime.fiscal.queueDanfe(doc.id,{actor:admin,width:42});
  runtime.fiscal.markCancelled(doc.id,{status:200,data:{cStat:135,xMotivo:'Evento registrado',protocolo:'135260000999999',xml:'<procEventoNFe />'}},admin,'Cancelamento de homologacao para checklist');
  runtime.backups.createBackup('fiscal-production-readiness');
}

test('P14-P15 schema v17 is additive and production is blocked until readiness activation',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-production-'));
  try{
    const runtime=setupRuntime(dir);configureHomologation(runtime);
    const version=Number(runtime.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version);assert.equal(version,17);
    assert.ok(runtime.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fiscal_production_activation'").get());
    assert.ok(runtime.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='fiscal_contingency'").get());
    assert.throws(()=>runtime.fiscalConfiguration.saveCompanySettings({...runtime.fiscalConfiguration.getCompanySettings(),environment:'production'},admin),/producao.*bloquead|ativacao/i);
    const readiness=runtime.fiscalProduction.getReadiness();assert.equal(readiness.ready,false);assert.ok(readiness.checks.some(item=>item.key==='certificate'&&!item.passed));assert.ok(readiness.checks.some(item=>item.key==='homologation_authorized'&&!item.passed));
    assert.throws(()=>runtime.fiscalProduction.recordEvidence('homologation_authorized',{passed:true,message:'manual'},admin),/evidencia objetiva/i);
    runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P15 activation is admin-only and requires objective homologation, DANFE and backup evidence',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-activation-'));
  try{
    const runtime=setupRuntime(dir);configureHomologation(runtime);
    assert.throws(()=>runtime.fiscalProduction.activateProduction({userId:'mgr',role:'manager'}),/admin/i);
    assert.throws(()=>runtime.fiscalProduction.activateProduction(admin),/bloquead|pendenc/i);
    seedObjectiveProductionEvidence(runtime);
    const readiness=runtime.fiscalProduction.getReadiness();assert.equal(readiness.ready,true);assert.equal(readiness.blockers.length,0);
    for(const key of ['certificate','homologation_authorized','homologation_cancelled','danfe_print','backup'])assert.equal(readiness.checks.find(item=>item.key===key)?.source,'computed');
    const result=runtime.fiscalProduction.activateProduction(admin);assert.equal(result.enabled,true);assert.equal(runtime.fiscalConfiguration.getCompanySettings().environment,'production');assert.equal(runtime.fiscalConfiguration.getCompanySettings().autoIssue,false);
    runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P16 contingency starts pending, signs once, uses tpEmis=9 and preserves cNF/XML across restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-cont-'));const dbPath=path.join(dir,'pdv.sqlite');
  try{
    let runtime=setupRuntime(dir,provider());configureHomologation(runtime);const {doc,payload}=createPending(runtime);const originalCode=payload.identification.numericCode;
    const pending=runtime.fiscalProduction.enterContingency(doc.id,{reason:'Indisponibilidade temporaria da autorizacao SEFAZ',actor:admin});assert.equal(pending.status,'CONTINGENCY_PENDING');assert.equal(pending.document.identification.numericCode,originalCode);assert.equal(pending.document.contingency.type,'offline');assert.equal(pending.document.contingency.tpEmis,'9');assert.ok(pending.document.contingency.enteredAt);
    const ini=renderNfceIni(pending.document);assert.match(ini,/tpEmis=9/);assert.match(ini,/dhCont=/);assert.match(ini,/xJust=Indisponibilidade temporaria/);
    const issued=await runtime.fiscalProduction.prepareContingency(doc.id,{actor:admin});assert.equal(issued.status,'ISSUED');assert.equal(issued.hasGeneratedXml,true);assert.equal(issued.accessKey,accessKey);assert.equal(runtime.fiscal.getDocument(doc.id).lifecycleStatus,'PENDING');
    runtime.close();runtime=createPdvRuntime({dbPath,backupDir:path.join(dir,'backups'),fiscalArchiveDir:path.join(dir,'fiscal-archive')});const restored=runtime.fiscalProduction.getContingency(doc.id,{includeXml:true});assert.equal(restored.status,'ISSUED');assert.equal(restored.document.identification.numericCode,originalCode);assert.match(restored.generatedXml,/NFe/);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P16 SEFAZ return after restart transmits the same contingency and reaches AUTHORIZED without touching sale totals',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-return-'));const dbPath=path.join(dir,'pdv.sqlite');
  try{
    let runtime=setupRuntime(dir,provider());configureHomologation(runtime);const {doc,saleId}=createPending(runtime);runtime.fiscalProduction.enterContingency(doc.id,{reason:'SEFAZ indisponivel no momento da venda',actor:admin});await runtime.fiscalProduction.prepareContingency(doc.id,{actor:admin});const saleBefore=runtime.sales.getSale(saleId);runtime.close();
    runtime=createPdvRuntime({dbPath,backupDir:path.join(dir,'backups'),fiscalArchiveDir:path.join(dir,'fiscal-archive'),fiscalProviderResolver:async()=>provider()});const result=await runtime.fiscalProduction.transmitContingency(doc.id,{actor:admin});assert.equal(result.contingency.status,'RESOLVED');assert.equal(result.document.lifecycleStatus,'AUTHORIZED');assert.equal(result.document.accessKey,accessKey);const saleAfter=runtime.sales.getSale(saleId);assert.equal(saleAfter.status,'COMPLETED');assert.equal(saleAfter.totalCents,saleBefore.totalCents);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P16 never enters contingency after an ambiguous online transmission attempt',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-guard-'));
  try{
    const runtime=setupRuntime(dir);configureHomologation(runtime);const {doc}=createPending(runtime);runtime.fiscal.markProcessing(doc.id,admin);runtime.fiscal.markUnknown(doc.id,{indeterminate:true,error:'timeout'},admin);
    assert.throws(()=>runtime.fiscalProduction.enterContingency(doc.id,{reason:'Falha de comunicacao exige contingencia segura',actor:admin}),/UNKNOWN|reconcili/i);assert.equal(runtime.fiscalProduction.getContingency(doc.id),null);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P16 crash during TRANSMITTING restarts as RECONCILING, never blind retry',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-crash-'));const dbPath=path.join(dir,'pdv.sqlite');
  try{
    let runtime=setupRuntime(dir,provider());configureHomologation(runtime);const {doc}=createPending(runtime);runtime.fiscalProduction.enterContingency(doc.id,{reason:'SEFAZ indisponivel no momento da venda',actor:admin});await runtime.fiscalProduction.prepareContingency(doc.id,{actor:admin});runtime.db.prepare("UPDATE fiscal_contingency SET status='TRANSMITTING' WHERE fiscal_document_id=?").run(doc.id);runtime.close();
    runtime=createPdvRuntime({dbPath,backupDir:path.join(dir,'backups'),fiscalArchiveDir:path.join(dir,'fiscal-archive')});assert.equal(runtime.fiscalProduction.getContingency(doc.id).status,'RECONCILING');assert.equal(runtime.fiscal.getDocument(doc.id).lifecycleStatus,'PENDING');runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('P16 indeterminate contingency transmission becomes UNKNOWN plus RECONCILING',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-b6-timeout-'));
  try{
    const fiscalProvider=provider({sendResult:{ok:false,status:408,indeterminate:true,data:null,error:'Timeout aguardando resposta.'}});const runtime=setupRuntime(dir,fiscalProvider);configureHomologation(runtime);const {doc}=createPending(runtime);runtime.fiscalProduction.enterContingency(doc.id,{reason:'SEFAZ indisponivel no momento da venda',actor:admin});await runtime.fiscalProduction.prepareContingency(doc.id,{actor:admin});const result=await runtime.fiscalProduction.transmitContingency(doc.id,{actor:admin});assert.equal(result.contingency.status,'RECONCILING');assert.equal(result.document.lifecycleStatus,'UNKNOWN');assert.equal(result.document.reconcileRequired,true);assert.throws(()=>runtime.fiscal.retryIssue(doc.id,{actor:admin}),/reconciliacao/i);runtime.close();
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});