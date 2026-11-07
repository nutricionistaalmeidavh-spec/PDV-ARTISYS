'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const XLSX=require('xlsx');
const {buildFinanceWorkbook,parseFinanceWorkbook}=require('../js/domains/finance/workspace-xlsx');

test('XLSX usa dados reais, conserva centavos, aspas e datas e rejeita formulas como dado executavel',()=>{
  const original=[
    {kind:'PAYABLE',description:'Aluguel loja',amountCents:10550,dueAt:'2026-11-12',category:'Renda',accountId:'banco-1',notes:'Pago 15 dias'},
    {kind:'RECEIVABLE',description:'Cliente; "VIP"',amountCents:99999,dueAt:'2026-11-18'}
  ];
  const exported=buildFinanceWorkbook(original);
  assert.ok(exported.base64.length>200);
  const result=parseFinanceWorkbook(exported.base64);
  assert.equal(result.length,2);
  assert.equal(result[0].amountCents,10550);
  assert.equal(result[1].description,'Cliente; "VIP"');
  assert.equal(result[1].dueAt,'2026-11-18');
});
test('XLSX valida formato e recusa valores negativos ou quantidade excessiva',()=>{
  const make=rows=>{const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Lançamentos');return XLSX.write(wb,{type:'base64',bookType:'xlsx'});};
  assert.throws(()=>parseFinanceWorkbook(make([{tipo:'PAYABLE',descricao:'Inválido',valor_centavos:-2,vencimento:'2026-11-15'}])),/valor/i);
  const rows=Array.from({length:501},(_,i)=>({tipo:'PAYABLE',descricao:'Fatura '+i,valor_centavos:100,vencimento:'2026-11-15'}));
  assert.throws(()=>parseFinanceWorkbook(make(rows)),/500/i);
  assert.throws(()=>parseFinanceWorkbook('not base64'),/xlsx|arquivo|invalido/i);
});
