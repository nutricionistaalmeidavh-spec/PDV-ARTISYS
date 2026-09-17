'use strict';

const {withTransaction}=require('./sqlite-database');

const FINANCE_RECEIVABLE_SCHEMA_VERSION=13;
const FINANCE_RECEIVABLE_MIGRATION_NAME='sale_finance_receivables_p0_p2';

function columns(db,table){
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name));
}

function runFinanceReceivableMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  const current=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version||0);
  if(current>=FINANCE_RECEIVABLE_SCHEMA_VERSION)return current;

  withTransaction(db,()=>{
    const names=columns(db,'financial_entries');
    if(!names.has('source_line_key'))db.exec('ALTER TABLE financial_entries ADD COLUMN source_line_key TEXT');
    if(!names.has('payment_method'))db.exec('ALTER TABLE financial_entries ADD COLUMN payment_method TEXT');
    if(!names.has('gross_amount_cents'))db.exec('ALTER TABLE financial_entries ADD COLUMN gross_amount_cents INTEGER CHECK (gross_amount_cents IS NULL OR gross_amount_cents >= 0)');
    if(!names.has('fee_amount_cents'))db.exec('ALTER TABLE financial_entries ADD COLUMN fee_amount_cents INTEGER CHECK (fee_amount_cents IS NULL OR fee_amount_cents >= 0)');
    if(!names.has('net_amount_cents'))db.exec('ALTER TABLE financial_entries ADD COLUMN net_amount_cents INTEGER CHECK (net_amount_cents IS NULL OR net_amount_cents >= 0)');
    if(!names.has('original_entry_id'))db.exec('ALTER TABLE financial_entries ADD COLUMN original_entry_id TEXT');
    if(!names.has('installment_number'))db.exec('ALTER TABLE financial_entries ADD COLUMN installment_number INTEGER CHECK (installment_number IS NULL OR installment_number >= 1)');
    if(!names.has('installment_count'))db.exec('ALTER TABLE financial_entries ADD COLUMN installment_count INTEGER CHECK (installment_count IS NULL OR (installment_count >= 1 AND installment_count <= 24))');
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_entries_source_line
      ON financial_entries(source_type,source_id,source_line_key)
      WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND source_line_key IS NOT NULL;`);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(FINANCE_RECEIVABLE_SCHEMA_VERSION,FINANCE_RECEIVABLE_MIGRATION_NAME,now());
  });
  return FINANCE_RECEIVABLE_SCHEMA_VERSION;
}

module.exports={FINANCE_RECEIVABLE_SCHEMA_VERSION,FINANCE_RECEIVABLE_MIGRATION_NAME,runFinanceReceivableMigrations};
