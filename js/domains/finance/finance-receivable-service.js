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

  const saleColumns=new Set(db.prepare('PRAGMA table_info(sales)').all().map(row=>row.name));
  const sellerIdExpr=saleColumns.has('seller_id')?'COALESCE(s.seller_id,s.operator_id)':'s.operator_id';
  const sellerNameExpr=saleColumns.has('seller_name_snapshot')?'COALESCE(s.seller_name_snapshot,su.name,u.name)':'u.name';
  const sellerJoin=saleColumns.has('seller_id')?'LEFT JOIN users su ON su.id=s.seller_id':'';

  function extension(id){
    return db.prepare(`SELECT source_line_key,payment_method,gross_amount_cents,fee_amount_cents,net_amount_cents,
      original_entry_id,installment_number,installment_count FROM financial_entries WHERE id=?`).get(String(id));
  }

  function contextFor(entry){
    if(!entry)return{};
    const sourceType=String(entry.sourceType||'').toUpperCase();
    let row=null;
    if(sourceType==='SALE'){
      row=db.prepare(`SELECT s.id AS sale_id,s.sale_number,${sellerIdExpr} AS seller_id,${sellerNameExpr} AS seller_name,
        s.customer_id,c.name AS customer_name
        FROM sales s LEFT JOIN users u ON u.id=s.operator_id ${sellerJoin}
        LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=?`).get(String(entry.sourceId));
    }else if(sourceType==='RETURN'){
      row=db.prepare(`SELECT s.id AS sale_id,s.sale_number,rt.id AS return_id,${sellerIdExpr} AS seller_id,${sellerNameExpr} AS seller_name,
        s.customer_id,c.name AS customer_name
        FROM return_transactions rt JOIN sales s ON s.id=rt.sale_id
        LEFT JOIN users u ON u.id=s.operator_id ${sellerJoin}
        LEFT JOIN customers c ON c.id=s.customer_id WHERE rt.id=?`).get(String(entry.sourceId));
    }
    if(!row)return{saleId:null,saleNumber:null,returnId:sourceType==='RETURN'?entry.sourceId:null,sellerId:null,sellerName:null,customerId:null,customerName:null};
    return{
      saleId:row.sale_id??null,
      saleNumber:row.sale_number??null,
      returnId:row.return_id??null,
      sellerId:row.seller_id??null,
      sellerName:row.seller_name??null,
      customerId:row.customer_id??null,
      customerName:row.customer_name??null
    };
  }

  function enhance(entry){
    if(!entry)return entry;
    const row=extension(entry.id)||{};
    const extended={...entry,
      sourceLineKey:row.source_line_key??null,
      paymentMethod:row.payment_method??null,
      grossAmountCents:row.gross_amount_cents??null,
      feeAmountCents:row.fee_amount_cents??null,
      netAmountCents:row.net_amount_cents??null,
      originalEntryId:row.original_entry_id??null,
      installmentNumber:row.installment_number??null,
      installmentCount:row.installment_count??null,
      originType:entry.sourceType||'MANUAL'
    };
    return{...extended,...contextFor(extended)};
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

  function listEntries(filters={}){
    const baseFilters={};
    for(const key of ['kind','status','from','to','accountId','query','asOf','overdue'])if(filters[key]!==undefined)baseFilters[key]=filters[key];
    let rows=baseFinance.listEntries(baseFilters).map(enhance);
    if(filters.sourceType){
      const wanted=String(filters.sourceType).toUpperCase();
      rows=rows.filter(row=>wanted==='MANUAL'?!row.sourceType:String(row.sourceType||'').toUpperCase()===wanted);
    }
    if(filters.sourceId)rows=rows.filter(row=>String(row.sourceId||'')===String(filters.sourceId));
    if(filters.saleId)rows=rows.filter(row=>String(row.saleId||'')===String(filters.saleId));
    if(filters.paymentMethod){const method=String(filters.paymentMethod).toUpperCase();rows=rows.filter(row=>String(row.paymentMethod||'').toUpperCase()===method);}
    if(filters.sellerId)rows=rows.filter(row=>String(row.sellerId||'')===String(filters.sellerId));
    if(filters.customerId)rows=rows.filter(row=>String(row.customerId||'')===String(filters.customerId));
    return rows;
  }

  function findBySourceLine(sourceType,sourceId,sourceLineKey){
    const row=db.prepare('SELECT id FROM financial_entries WHERE source_type=? AND source_id=? AND source_line_key=?')
      .get(String(sourceType),String(sourceId),String(sourceLineKey));
    return row?getEntry(row.id):null;
  }

  function createSourceEntry(input={},actor=null){
    const sourceType=String(input.sourceType||'').trim();
    const sourceId=String(input.sourceId||'').trim();
    const sourceLineKey=String(input.sourceLineKey||'').trim();
    if(!sourceType||!sourceId||!sourceLineKey)throw new Error('Origem financeira idempotente exige sourceType, sourceId e sourceLineKey.');
    const existing=findBySourceLine(sourceType,sourceId,sourceLineKey);
    if(existing)return existing;
    try{return createEntry({...input,sourceType,sourceId,sourceLineKey},actor);}
    catch(error){
      if(/UNIQUE constraint failed/.test(String(error?.message||''))){
        const raced=findBySourceLine(sourceType,sourceId,sourceLineKey);
        if(raced)return raced;
      }
      throw error;
    }
  }

  function listBySource(sourceType,sourceId){
    return db.prepare('SELECT id FROM financial_entries WHERE source_type=? AND source_id=? ORDER BY due_at,id')
      .all(String(sourceType),String(sourceId)).map(row=>getEntry(row.id));
  }
  function listLinkedEntries(originalEntryId,{includeCancelled=true}={}){
    const rows=includeCancelled
      ?db.prepare('SELECT id FROM financial_entries WHERE original_entry_id=? ORDER BY created_at,id').all(String(originalEntryId))
      :db.prepare("SELECT id FROM financial_entries WHERE original_entry_id=? AND status<>'CANCELLED' ORDER BY created_at,id").all(String(originalEntryId));
    return rows.map(row=>getEntry(row.id));
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

  return {...baseFinance,createEntry,createSourceEntry,getEntry,listEntries,findBySourceLine,listBySource,listLinkedEntries,settleEntry,reverseSettlement,cancelEntry};
}

module.exports={createFinanceReceivableService,PAYMENT_METHODS};
