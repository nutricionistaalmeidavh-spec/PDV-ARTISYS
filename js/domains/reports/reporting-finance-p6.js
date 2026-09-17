'use strict';

function parseDate(value,fallback){
  if(value==null||value==='')return fallback;
  const time=Date.parse(String(value));
  if(!Number.isFinite(time))throw new Error('Periodo de relatorio invalido.');
  return new Date(time).toISOString();
}

function createP6ReportingService({db,baseReports,now=()=>new Date().toISOString()}={}){
  if(!db)throw new TypeError('Database is required.');
  if(!baseReports)throw new TypeError('Base reporting service is required.');
  const saleColumns=new Set(db.prepare('PRAGMA table_info(sales)').all().map(row=>row.name));
  const sellerIdExpression=saleColumns.has('seller_id')?'COALESCE(s.seller_id,s.operator_id)':'s.operator_id';

  function buildFinanceSummary(filters={}){
    const clauses=["fe.status<>'CANCELLED'"];
    const params=[];
    if(filters.from){clauses.push('fe.due_at>=?');params.push(parseDate(filters.from,'1970-01-01T00:00:00.000Z'));}
    if(filters.to){clauses.push('fe.due_at<=?');params.push(parseDate(filters.to,'9999-12-31T23:59:59.999Z'));}
    if(filters.sellerId){clauses.push(`${sellerIdExpression}=?`);params.push(String(filters.sellerId));}
    const rows=db.prepare(`SELECT fe.*,
      COALESCE((SELECT SUM(fs.amount_cents) FROM financial_settlements fs WHERE fs.entry_id=fe.id AND fs.reversed_at IS NULL),0) AS settled_cents
      FROM financial_entries fe
      LEFT JOIN return_transactions rt ON fe.source_type='RETURN' AND rt.id=fe.source_id
      LEFT JOIN sales s ON (fe.source_type='SALE' AND s.id=fe.source_id) OR (fe.source_type='RETURN' AND s.id=rt.sale_id)
      WHERE ${clauses.join(' AND ')} ORDER BY fe.due_at,fe.id`).all(...params);

    const result={
      perspective:'FINANCIAL',
      payableTotalCents:0,payableSettledCents:0,payableOpenCents:0,
      receivableTotalCents:0,receivableSettledCents:0,receivableOpenCents:0,
      overduePayableCents:0,overdueReceivableCents:0,
      netSettledCents:0,
      sourceBreakdown:{},
      commercialTotalsIncluded:false
    };
    const asOfMs=Date.parse(String(filters.asOf||now()));
    for(const row of rows){
      const amount=Number(row.amount_cents||0);
      const settled=Number(row.settled_cents||0);
      const open=Math.max(amount-settled,0);
      const prefix=row.kind==='PAYABLE'?'payable':'receivable';
      result[`${prefix}TotalCents`]+=amount;
      result[`${prefix}SettledCents`]+=settled;
      result[`${prefix}OpenCents`]+=open;
      if(open>0&&Date.parse(row.due_at)<asOfMs)result[row.kind==='PAYABLE'?'overduePayableCents':'overdueReceivableCents']+=open;
      const source=String(row.source_type||'MANUAL').toUpperCase();
      const bucket=result.sourceBreakdown[source]||(result.sourceBreakdown[source]={totalCents:0,settledCents:0,openCents:0,receivableCents:0,payableCents:0,count:0});
      bucket.totalCents+=amount;bucket.settledCents+=settled;bucket.openCents+=open;bucket.count+=1;
      bucket[row.kind==='PAYABLE'?'payableCents':'receivableCents']+=amount;
    }
    result.netSettledCents=result.receivableSettledCents-result.payableSettledCents;
    return result;
  }

  return{...baseReports,buildFinanceSummary};
}

module.exports={createP6ReportingService};
