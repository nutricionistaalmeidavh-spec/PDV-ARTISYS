'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runReleaseMigrations}=require('../js/core/database/release-migrations');
const {runVerticalMigrations}=require('../js/core/database/vertical-migrations');
const {runSalesEnhancementMigrations}=require('../js/core/database/sales-enhancement-migrations');
const {runCommercialMediaMigrations}=require('../js/core/database/commercial-media-migrations');
const {runFinanceReceivableMigrations,FINANCE_RECEIVABLE_SCHEMA_VERSION}=require('../js/core/database/finance-receivable-migrations');
const {createFinanceService}=require('../js/domains/finance/finance-service');
const {createFinanceReceivableService}=require('../js/domains/finance/finance-receivable-service');

function migrateBase(db){
  runMigrations(db,()=> '2026-09-17T12:00:00.000Z');
  runReleaseMigrations(db,()=> '2026-09-17T12:00:00.000Z');
  runVerticalMigrations(db,()=> '2026-09-17T12:00:00.000Z');
  runSalesEnhancementMigrations(db,()=> '2026-09-17T12:00:00.000Z');
  runCommercialMediaMigrations(db,()=> '2026-09-17T12:00:00.000Z');
}

function service(){
  const db=openDatabase(':memory:');
  migrateBase(db);
  runFinanceReceivableMigrations(db,()=> '2026-09-17T12:00:00.000Z');
  let seq=0;
  const base=createFinanceService({db,now:()=> '2026-09-17T12:00:00.000Z',idFactory:p=>`${p}-${++seq}`});
  return {db,finance:createFinanceReceivableService({db,baseFinance:base,now:()=> '2026-09-17T12:00:00.000Z'})};
}

test('finance receivable migration runs after existing v12 chain and preserves legacy entries',()=>{
  const db=openDatabase(':memory:');
  migrateBase(db);
  db.prepare(`INSERT INTO financial_entries
    (id,kind,description,amount_cents,due_at,status,source_type,source_id,created_at,updated_at)
    VALUES (?,?,?,?,?,'OPEN',?,?,?,?)`)
    .run('legacy','RECEIVABLE','Legado',5000,'2026-09-20T00:00:00.000Z',null,null,'2026-09-17T12:00:00.000Z','2026-09-17T12:00:00.000Z');

  const version=runFinanceReceivableMigrations(db,()=> '2026-09-17T13:00:00.000Z');
  assert.equal(version,FINANCE_RECEIVABLE_SCHEMA_VERSION);
  assert.equal(FINANCE_RECEIVABLE_SCHEMA_VERSION,13);
  const columns=new Set(db.prepare('PRAGMA table_info(financial_entries)').all().map(row=>row.name));
  for(const name of ['source_line_key','payment_method','gross_amount_cents','fee_amount_cents','net_amount_cents','original_entry_id','installment_number','installment_count']) assert.equal(columns.has(name),true,name);
  const legacy=db.prepare('SELECT * FROM financial_entries WHERE id=?').get('legacy');
  assert.equal(legacy.amount_cents,5000);
  assert.equal(legacy.source_line_key,null);
  assert.equal(legacy.gross_amount_cents,null);
  assert.equal(legacy.installment_count,null);
  runFinanceReceivableMigrations(db,()=> '2026-09-17T14:00:00.000Z');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=?').get(FINANCE_RECEIVABLE_SCHEMA_VERSION).count,1);
  db.close();
});

test('finance receivable migration is not skipped when a later unrelated schema version already exists',()=>{
  const db=openDatabase(':memory:');
  migrateBase(db);
  db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
    .run(14,'future_unrelated_module','2026-09-17T12:30:00.000Z');

  const version=runFinanceReceivableMigrations(db,()=> '2026-09-17T13:00:00.000Z');
  assert.equal(version,14,'migration runner must preserve the highest global schema version');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=?').get(FINANCE_RECEIVABLE_SCHEMA_VERSION).count,1);
  const columns=new Set(db.prepare('PRAGMA table_info(financial_entries)').all().map(row=>row.name));
  for(const name of ['source_line_key','payment_method','gross_amount_cents','fee_amount_cents','net_amount_cents','original_entry_id','installment_number','installment_count']) assert.equal(columns.has(name),true,name);
  const indexes=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='financial_entries'").all().map(row=>row.name));
  assert.equal(indexes.has('idx_financial_entries_source_line'),true);
  db.close();
});

test('sale finance origin is unique per source line',()=>{
  const {db,finance}=service();
  finance.createEntry({kind:'RECEIVABLE',description:'Venda 1',amountCents:1000,dueAt:'2026-09-17T12:00:00.000Z',sourceType:'SALE',sourceId:'sale-1',sourceLineKey:'pay-1',paymentMethod:'PIX',grossAmountCents:1000,feeAmountCents:0,netAmountCents:1000});
  assert.throws(()=>finance.createEntry({kind:'RECEIVABLE',description:'Venda 1 duplicada',amountCents:1000,dueAt:'2026-09-17T12:00:00.000Z',sourceType:'SALE',sourceId:'sale-1',sourceLineKey:'pay-1',paymentMethod:'PIX',grossAmountCents:1000,feeAmountCents:0,netAmountCents:1000}),/UNIQUE|origem.*financeira|duplic/i);
  db.close();
});

test('extended finance service exposes gross fee net payment and installment metadata',()=>{
  const {db,finance}=service();
  const entry=finance.createEntry({
    kind:'RECEIVABLE',description:'Venda cartão 2/3',amountCents:9700,dueAt:'2026-10-17T12:00:00.000Z',
    sourceType:'SALE',sourceId:'sale-2',sourceLineKey:'pay-2:2',paymentMethod:'CREDIT_CARD',grossAmountCents:10000,feeAmountCents:300,netAmountCents:9700,
    installmentNumber:2,installmentCount:3
  });
  assert.equal(entry.paymentMethod,'CREDIT_CARD');
  assert.equal(entry.grossAmountCents,10000);
  assert.equal(entry.feeAmountCents,300);
  assert.equal(entry.netAmountCents,9700);
  assert.equal(entry.installmentNumber,2);
  assert.equal(entry.installmentCount,3);
  assert.equal(entry.sourceLineKey,'pay-2:2');
  assert.equal(finance.getEntry(entry.id).sourceId,'sale-2');
  db.close();
});

test('extended finance service rejects inconsistent money and invalid installment metadata',()=>{
  const {db,finance}=service();
  const base={kind:'RECEIVABLE',description:'Inválido',amountCents:9800,dueAt:'2026-09-17T12:00:00.000Z',sourceType:'SALE',sourceId:'sale-x',sourceLineKey:'pay-x',paymentMethod:'CREDIT_CARD'};
  assert.throws(()=>finance.createEntry({...base,grossAmountCents:10000,feeAmountCents:300,netAmountCents:9800}),/bruto|taxa|liquido|inconsistente/i);
  assert.throws(()=>finance.createEntry({...base,sourceLineKey:'pay-y',amountCents:10000,grossAmountCents:10000,feeAmountCents:0,netAmountCents:10000,installmentNumber:25,installmentCount:25}),/parcela/i);
  db.close();
});
