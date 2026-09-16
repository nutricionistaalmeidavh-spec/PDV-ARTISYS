'use strict';

const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { assertCents } = require('../shared/money');

function createCreditService({db,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db)throw new TypeError('Database is required.');

  function hashCode(code){return createHash('sha256').update(String(code||'').trim().toUpperCase(),'utf8').digest('hex');}
  function generateCode(){return `ARTI-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}`;}
  function assertManager(actor){if(!['manager','admin'].includes(String(actor?.role||'')))throw new Error('Autorizacao de gerente necessaria para operar credito.');}
  function mapAccount(row){return row&&{id:row.id,type:row.type,customerId:row.customer_id,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at};}
  function getAccount(id){return mapAccount(db.prepare('SELECT * FROM credit_accounts WHERE id=?').get(String(id)));}
  function getBalance(accountId){const row=db.prepare(`SELECT COALESCE(SUM(CASE direction WHEN 'CREDIT' THEN amount_cents ELSE -amount_cents END),0) AS balance FROM credit_ledger WHERE account_id=?`).get(String(accountId));return Number(row?.balance||0);}
  function mapEntry(row){return row&&{id:row.id,accountId:row.account_id,direction:row.direction,amountCents:row.amount_cents,sourceType:row.source_type,sourceId:row.source_id,note:row.note,actorId:row.actor_id,createdAt:row.created_at,reversedEntryId:row.reversed_entry_id};}
  function getEntry(id){return mapEntry(db.prepare('SELECT * FROM credit_ledger WHERE id=?').get(String(id)));}
  function listLedger(accountId){return db.prepare('SELECT * FROM credit_ledger WHERE account_id=? ORDER BY created_at,id').all(String(accountId)).map(mapEntry);}

  function ensureCustomerAccount(customerId){
    const id=String(customerId||'').trim();if(!db.prepare('SELECT 1 FROM customers WHERE id=? AND active=1').get(id))throw new Error('Cliente nao encontrado ou inativo.');
    const existing=db.prepare("SELECT * FROM credit_accounts WHERE type='CUSTOMER' AND customer_id=?").get(id);if(existing)return mapAccount(existing);
    const accountId=idFactory('credit');const timestamp=now();db.prepare(`INSERT INTO credit_accounts(id,type,customer_id,active,created_at,updated_at) VALUES(?,'CUSTOMER',?,1,?,?)`).run(accountId,id,timestamp,timestamp);return getAccount(accountId);
  }

  function existingSource(accountId,direction,sourceType,sourceId){return mapEntry(db.prepare(`SELECT * FROM credit_ledger WHERE account_id=? AND direction=? AND source_type=? AND source_id=? AND reversed_entry_id IS NULL`).get(String(accountId),direction,String(sourceType),String(sourceId)));}
  function addEntry({accountId,direction,amountCents,sourceType,sourceId,note=null,reversedEntryId=null},actor=null){
    const account=getAccount(accountId);if(!account||!account.active)throw new Error('Conta de credito nao encontrada ou inativa.');
    const amount=assertCents(Number(amountCents),'amountCents');if(amount<=0)throw new Error('Valor de credito deve ser maior que zero.');
    const type=String(sourceType||'').trim();const source=String(sourceId||'').trim();if(!type||!source)throw new Error('Origem do lancamento de credito obrigatoria.');
    if(!reversedEntryId){const previous=existingSource(account.id,direction,type,source);if(previous)return previous;}
    const id=idFactory('credit-entry');const timestamp=now();db.prepare(`INSERT INTO credit_ledger(id,account_id,direction,amount_cents,source_type,source_id,note,actor_id,created_at,reversed_entry_id) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(id,account.id,direction,amount,type,source,note||null,actor?.userId||null,timestamp,reversedEntryId||null);return getEntry(id);
  }

  function issueCustomerCredit(input={},actor=null){
    assertManager(actor);return withTransaction(db,()=>{const account=ensureCustomerAccount(input.customerId);const entry=addEntry({accountId:account.id,direction:'CREDIT',amountCents:input.amountCents,sourceType:input.sourceType||'manual',sourceId:input.sourceId||idFactory('manual-credit'),note:input.note||null},actor);writeAudit(db,{action:'credit.issue',entity:'credit-account',entityId:account.id,actor,context:{customerId:account.customerId,amountCents:entry.amountCents,sourceType:entry.sourceType,sourceId:entry.sourceId}},now);return{account:{...account,balanceCents:getBalance(account.id)},entry};});
  }

  function createGiftCard(input={},actor=null){
    assertManager(actor);const amount=assertCents(Number(input.amountCents),'amountCents');if(amount<=0)throw new Error('Valor do vale-presente deve ser maior que zero.');
    return withTransaction(db,()=>{let code;let codeHash;do{code=generateCode();codeHash=hashCode(code);}while(db.prepare('SELECT 1 FROM credit_accounts WHERE code_hash=?').get(codeHash));const id=idFactory('gift');const timestamp=now();db.prepare(`INSERT INTO credit_accounts(id,type,code_hash,active,created_at,updated_at) VALUES(?,'GIFT_CARD',?,1,?,?)`).run(id,codeHash,timestamp,timestamp);const entry=addEntry({accountId:id,direction:'CREDIT',amountCents:amount,sourceType:input.sourceType||'gift-card-issue',sourceId:input.sourceId||id,note:input.note||null},actor);writeAudit(db,{action:'credit.gift-card.create',entity:'credit-account',entityId:id,actor,context:{amountCents:amount,sourceType:entry.sourceType,sourceId:entry.sourceId}},now);return{account:{...getAccount(id),balanceCents:getBalance(id)},entry,code};});
  }

  function findGiftCard(code){const row=db.prepare("SELECT * FROM credit_accounts WHERE type='GIFT_CARD' AND code_hash=? AND active=1").get(hashCode(code));return mapAccount(row);}

  function redeem(input={},actor=null){
    const accountId=input.accountId||(input.giftCardCode?findGiftCard(input.giftCardCode)?.id:null);if(!accountId)throw new Error('Conta de credito nao encontrada.');const amount=assertCents(Number(input.amountCents),'amountCents');if(amount<=0)throw new Error('Valor de resgate deve ser maior que zero.');
    return withTransaction(db,()=>{const previous=existingSource(accountId,'DEBIT',input.sourceType||'sale',input.sourceId);if(previous)return{account:getAccount(accountId),entry:previous,balanceCents:getBalance(accountId),idempotent:true};const balance=getBalance(accountId);if(amount>balance)throw new Error(`Saldo de credito insuficiente. Disponivel: ${balance} centavos.`);const entry=addEntry({accountId,direction:'DEBIT',amountCents:amount,sourceType:input.sourceType||'sale',sourceId:input.sourceId,note:input.note||null},actor);writeAudit(db,{action:'credit.redeem',entity:'credit-account',entityId:String(accountId),actor,context:{amountCents:amount,sourceType:entry.sourceType,sourceId:entry.sourceId}},now);return{account:getAccount(accountId),entry,balanceCents:getBalance(accountId),idempotent:false};});
  }

  function refund(input={},actor=null){
    assertManager(actor);const accountId=String(input.accountId||'').trim();return withTransaction(db,()=>{const entry=addEntry({accountId,direction:'CREDIT',amountCents:input.amountCents,sourceType:input.sourceType||'return',sourceId:input.sourceId,note:input.note||null},actor);writeAudit(db,{action:'credit.refund',entity:'credit-account',entityId:accountId,actor,context:{amountCents:entry.amountCents,sourceType:entry.sourceType,sourceId:entry.sourceId}},now);return{account:getAccount(accountId),entry,balanceCents:getBalance(accountId)};});
  }

  function reverse(entryId,{reason='',actor=null}={}){
    assertManager(actor);const text=String(reason||'').trim();if(!text)throw new Error('Informe o motivo do estorno de credito.');
    return withTransaction(db,()=>{const original=getEntry(entryId);if(!original)throw new Error('Lancamento de credito nao encontrado.');if(original.reversedEntryId)throw new Error('Lancamento de estorno nao pode ser estornado novamente.');if(db.prepare('SELECT 1 FROM credit_ledger WHERE reversed_entry_id=?').get(String(entryId)))throw new Error('Lancamento de credito ja foi estornado/revertido.');const direction=original.direction==='CREDIT'?'DEBIT':'CREDIT';if(direction==='DEBIT'&&original.amountCents>getBalance(original.accountId))throw new Error('Saldo insuficiente para estornar este credito.');const reversal=addEntry({accountId:original.accountId,direction,amountCents:original.amountCents,sourceType:'reversal',sourceId:original.id,note:`ESTORNO: ${text}`,reversedEntryId:original.id},actor);writeAudit(db,{action:'credit.reverse',entity:'credit-entry',entityId:original.id,actor,context:{reversalId:reversal.id,reason:text}},now);return{original,reversal,balanceCents:getBalance(original.accountId)};});
  }

  return{ensureCustomerAccount,issueCustomerCredit,createGiftCard,findGiftCard,redeem,refund,reverse,getAccount,getEntry,getBalance,listLedger,hashCode};
}

module.exports={createCreditService};
