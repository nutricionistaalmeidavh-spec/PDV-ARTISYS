'use strict';

const {withTransaction}=require('../../core/database/sqlite-database');
const {assertCents}=require('../shared/money');

const PAYMENT_METHODS=new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT','OTHER']);

function optionalCents(value,field){
  if(value===undefined||value===null)return null;
  const cents=assertCents(Number(value),field);
  if(cents<0)throw new Error(`${field} nao pode ser negativo.`);
  return cents;
}

function optionalInstallment(value,field){
  if(value===undefined||value===null)return null;
  const number=Number(value);
  if(!Number.isInteger(number))throw new Error(`${field} de parcela invalido.`);
  return number;
}

function createFinanceReceivableService({db,baseFinance,now=()=>new Date().toISOString()}={}){
  if(!db)throw new TypeError('Database is required.');
  if(!baseFinance)throw new TypeError('Base finance service is required.');

  function extension(id){
    return db.prepare(`SELECT source_line_key,payment_method,gross_amount_cents,fee_amount_cents,net_amount_cents,
      original_entry_id,installment_number,installment_count FROM financial_entries WHERE id=?`).get(String(id));
  }

  function enhance(entry){
    if(!entry)return entry;
    const row=extension(entry.id)||{};
    return {...entry,
      sourceLineKey:row.source_line_key??null,
      paymentMethod:row.payment_method??null,
      grossAmountCents:row.gross_amount_cents??null,
      feeAmountCents:row.fee_amount_cents??null,
      netAmountCents:row.net_amount_cents??null,
      originalEntryId:row.original_entry_id??null,
      installmentNumber:row.installment_number??null,
      installmentCount:row.installment_count??null
    };
  }

  function validateExtended(input){
    const gross=optionalCents(input.grossAmountCents,'grossAmountCents');
    const fee=optionalCents(input.feeAmountCents,'feeAmountCents');
    const net=input.netAmountCents==null?null:optionalCents(input.netAmountCents,'netAmountCents');
    if(gross!==null&&fee!==null&&net!==null&&gross-fee!==net)throw new Error('Valores bruto, taxa e liquido inconsistentes.');
    if(net!==null&&Number(input.amountCents)!==net)throw new Error('amountCents deve corresponder ao valor liquido do recebivel.');
    const installmentNumber=optionalInstallment(input.installmentNumber,'Numero');
    const installmentCount=optionalInstallment(input.installmentCount,'Quantidade');
    if((installmentNumber===null)!==(installmentCount===null))throw new Error('Numero e quantidade de parcelas devem ser informados juntos.');
    if(installmentCount!==null&&(installmentCount<1||installmentCount>24))throw new Error('Quantidade de parcelas deve ficar entre 1 e 24.');
    if(installmentNumber!==null&&(installmentNumber<1||installmentNumber>installmentCount))throw new Error('Numero de parcela invalido.');
    const paymentMethod=input.paymentMethod==null?null:String(input.paymentMethod).trim().toUpperCase();
    if(paymentMethod&&!PAYMENT_METHODS.has(paymentMethod))throw new Error('Forma de pagamento financeira invalida.');
    const sourceLineKey=input.sourceLineKey==null?null:String(input.sourceLineKey).trim();
    if(input.sourceLineKey!=null&&!sourceLineKey)throw new Error('Chave da linha de origem financeira invalida.');
    return{gross,fee,net,paymentMethod,sourceLineKey,installmentNumber,installmentCount};
  }

  function createEntry(input={},actor=null){
    const ext=validateExtended(input);
    return withTransaction(db,()=>{
      const created=baseFinance.createEntry(input,actor);
      db.prepare(`UPDATE financial_entries SET source_line_key=?,payment_method=?,gross_amount_cents=?,fee_amount_cents=?,net_amount_cents=?,
        original_entry_id=?,installment_number=?,installment_count=?,updated_at=? WHERE id=?`)
        .run(ext.sourceLineKey,ext.paymentMethod,ext.gross,ext.fee,ext.net,input.originalEntryId||null,ext.installmentNumber,ext.installmentCount,now(),created.id);
      return enhance(baseFinance.getEntry(created.id));
    });
  }

  function getEntry(id,options){return enhance(baseFinance.getEntry(id,options));}
  function listEntries(filters={}){return baseFinance.listEntries(filters).map(enhance);}
  function findBySourceLine(sourceType,sourceId,sourceLineKey){
    const row=db.prepare('SELECT id FROM financial_entries WHERE source_type=? AND source_id=? AND source_line_key=?')
      .get(String(sourceType),String(sourceId),String(sourceLineKey));
    return row?getEntry(row.id):null;
  }
  function settleEntry(id,input={},actor=null){
    const result=baseFinance.settleEntry(id,input,actor);
    return {...result,entry:getEntry(id)};
  }
  function reverseSettlement(id,input={}){
    const result=baseFinance.reverseSettlement(id,input);
    return {...result,entry:getEntry(result.entry.id)};
  }
  function cancelEntry(id,input={}){baseFinance.cancelEntry(id,input);return getEntry(id);}

  return {...baseFinance,createEntry,getEntry,listEntries,findBySourceLine,settleEntry,reverseSettlement,cancelEntry};
}

module.exports={createFinanceReceivableService,PAYMENT_METHODS};
