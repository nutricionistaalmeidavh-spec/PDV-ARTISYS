'use strict';
const XLSX=require('xlsx');

const HEADERS=Object.freeze(['tipo','descricao','valor_centavos','vencimento','categoria','conta_id','observacoes']);
function requiredDate(value){
  let text;
  if(value instanceof Date&&!Number.isNaN(value.getTime()))text=value.toISOString().slice(0,10);
  else if(typeof value==='number'&&Number.isFinite(value)){
    const d=XLSX.SSF.parse_date_code(value);
    text=d?String(d.y).padStart(4,'0')+'-'+String(d.m).padStart(2,'0')+'-'+String(d.d).padStart(2,'0'):'';
  }else{
    text=String(value||'').trim();
    if(/^\d{2}\/\d{2}\/\d{4}$/.test(text))text=text.slice(6)+'-'+text.slice(3,5)+'-'+text.slice(0,2);
    else text=text.slice(0,10);
  }
  const date=new Date(text+'T00:00:00.000Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==text)
    throw new Error('Vencimento invalido no arquivo XLSX.');
  return text;
}
function requiredCents(value){
  const amount=Number(value);
  if(!Number.isSafeInteger(amount)||amount<=0)throw new Error('Valor em centavos invalido no XLSX.');
  return amount;
}
function safeCell(value){
  let text=String(value??'');
  // Avoid formula interpretation when opening exported XLSX in desktop spreadsheet programs.
  if(/^\s*[=+@]/.test(text))text="'"+text;
  return text;
}
function buildFinanceWorkbook(entries=[]){
  if(!Array.isArray(entries)||entries.length>10000)throw new Error('Limite de 10000 registros por planilha XLSX.');
  const rows=entries.map(entry=>({
    tipo:String(entry.kind||''),
    descricao:safeCell(entry.description),
    valor_centavos:Number(entry.amountCents||0),
    vencimento:requiredDate(entry.dueAt),
    categoria:safeCell(entry.category||''),
    conta_id:safeCell(entry.accountId||''),
    observacoes:safeCell(entry.notes||'')
  }));
  const sheet=XLSX.utils.json_to_sheet(rows,{header:HEADERS});
  if(rows.length===0)XLSX.utils.sheet_add_aoa(sheet,[HEADERS],{origin:'A1'});
  sheet['!cols']=[{wch:17},{wch:45},{wch:20},{wch:15},{wch:28},{wch:28},{wch:50}];
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet,'Lançamentos');
  return{base64:XLSX.write(workbook,{type:'base64',bookType:'xlsx',compression:true}),count:rows.length};
}
function parseFinanceWorkbook(base64){
  if(typeof base64!=='string'||!base64||base64.length>3*1024*1024||!(/^[a-zA-Z0-9+/]*={0,2}$/.test(base64))||base64.length%4!==0)
    throw new Error('Arquivo XLSX invalido ou maior que o limite.');
  const binary=Buffer.from(base64,'base64');
  if(binary.length<100||binary.length>2*1024*1024||binary.subarray(0,2).toString()!=='PK')
    throw new Error('Arquivo XLSX invalido.');
  let workbook;
  try{workbook=XLSX.read(binary,{type:'buffer',dense:false,cellDates:true,bookVBA:false});}
  catch{throw new Error('Arquivo XLSX invalido ou corrompido.');}
  if(!workbook.SheetNames.length)throw new Error('Planilha XLSX vazia.');
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:true,blankrows:false});
  if(rows.length<1)throw new Error('Planilha XLSX sem lançamentos.');
  if(rows.length>500)throw new Error('Importe no maximo 500 linhas por XLSX.');
  const normalized=value=>String(value||'').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  const get=(row,...keys)=>{
    for(const [key,val] of Object.entries(row)){
      if(keys.includes(normalized(key)))return val;
    }
    return '';
  };
  return rows.map((row,i)=>{
    const rawType=normalized(get(row,'tipo','kind'));
    const kind=['payable','pagar','despesa','saida'].includes(rawType)?'PAYABLE':
      ['receivable','receber','receita','entrada'].includes(rawType)?'RECEIVABLE':null;
    if(!kind)throw new Error('Tipo de lançamento invalido na linha '+(i+2)+'.');
    const description=String(get(row,'descricao','description')||'').trim();
    if(!description||description.length>240)throw new Error('Descricao invalida na linha '+(i+2)+'.');
    const value=get(row,'valor_centavos','amountcents');
    return{
      kind,description,amountCents:requiredCents(value),
      dueAt:requiredDate(get(row,'vencimento','due_at','dueat')),
      category:String(get(row,'categoria','category')||'').slice(0,160)||null,
      accountId:String(get(row,'conta_id','account_id','accountid')||'').trim()||null,
      notes:String(get(row,'observacoes','notes')||'').slice(0,2000)||null
    };
  });
}
module.exports={HEADERS,buildFinanceWorkbook,parseFinanceWorkbook};
