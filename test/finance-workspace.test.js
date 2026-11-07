'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runErpFinanceMigrations}=require('../js/core/database/erp-finance-migrations');
const {runFinanceWorkspaceMigrations}=require('../js/core/database/finance-workspace-migrations');
const {createFinanceService}=require('../js/domains/finance/finance-service');
const {createFinanceWorkspace}=require('../js/domains/finance/finance-workspace');

function fixture(){
  const db=openDatabase(':memory:');runMigrations(db);runErpFinanceMigrations(db);runFinanceWorkspaceMigrations(db);
  let seq=0;const now=()=> '2026-11-07T12:00:00.000Z';
  const idFactory=prefix=>prefix+'-'+(++seq);
  const finance=createFinanceService({db,now,idFactory});
  const authorization={require({principal,capability}){if(principal.id!=='allowed'||capability!=='finance.settle'){const error=new Error('Permissao insuficiente.');error.statusCode=403;throw error;}return true;}};
  const workspace=createFinanceWorkspace({db,finance,authorization,now,idFactory});
  const account=finance.createAccount({name:'Banco',type:'BANK'});
  return{db,finance,workspace,account,allowed:{userId:'allowed'},denied:{userId:'denied'}};
}
test('Kanban exige confirmacao e permissao especifica para baixa integral e idempotente',()=>{
  const f=fixture();try{
    const entry=f.finance.createEntry({kind:'PAYABLE',description:'Fornecedor',amountCents:15900,dueAt:'2026-11-10',accountId:f.account.id});
    assert.throws(()=>f.workspace.moveCard('entry:'+entry.id,{stage:'DONE',method:'PIX',idempotencyKey:'move-1'},f.allowed),/confirm/i);
    assert.throws(()=>f.workspace.moveCard('entry:'+entry.id,{stage:'DONE',confirmed:true,method:'PIX',idempotencyKey:'move-1'},f.denied),/permiss/i);
    assert.equal(f.finance.getEntry(entry.id).openCents,15900);
    const first=f.workspace.moveCard('entry:'+entry.id,{stage:'DONE',confirmed:true,method:'PIX',accountId:f.account.id,idempotencyKey:'move-1'},f.allowed);
    assert.equal(first.stage,'DONE');assert.equal(f.finance.getEntry(entry.id).status,'SETTLED');
    const retry=f.workspace.moveCard('entry:'+entry.id,{stage:'DONE',confirmed:true,method:'PIX',accountId:f.account.id,idempotencyKey:'move-1'},f.allowed);
    assert.equal(retry.id,first.id);
    assert.equal(f.finance.getEntry(entry.id).settlements.length,1);
    assert.throws(()=>f.workspace.moveCard('entry:'+entry.id,{stage:'PENDING'},f.allowed),/estorn/i);
    assert.ok(f.db.prepare("SELECT 1 FROM audit_log WHERE action='finance.kanban.settle'").get());
  }finally{f.db.close();}
});
test('Kanban contempla tarefas sem efeito financeiro e etapas persistentes',()=>{
  const f=fixture();try{
    const card=f.workspace.createTask({title:'Cobrar comprovante',priority:'HIGH',dueAt:'2026-11-10'},f.allowed);
    assert.equal(card.stage,'PENDING');
    assert.equal(f.workspace.moveCard(card.id,{stage:'IN_PROGRESS'},f.allowed).stage,'IN_PROGRESS');
    assert.equal(f.workspace.moveCard(card.id,{stage:'DONE'},f.allowed).stage,'DONE');
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM financial_settlements').get().total,0);
    assert.equal(f.workspace.listCards().find(c=>c.id===card.id).priority,'HIGH');
  }finally{f.db.close();}
});
test('Planilha altera somente lancamentos manuais, sem apagar pagamentos nem permitir valores negativos',()=>{
 const f=fixture();try{
   const entry=f.finance.createEntry({kind:'RECEIVABLE',description:'Fatura A',amountCents:10000,dueAt:'2026-11-11'});
   const edited=f.workspace.updateEntry(entry.id,{description:'Fatura corrigida',amountCents:12000,dueAt:'2026-11-15'},f.allowed);
   assert.equal(edited.amountCents,12000);assert.equal(edited.description,'Fatura corrigida');
   f.finance.settleEntry(entry.id,{amountCents:9000,method:'PIX'});
   assert.throws(()=>f.workspace.updateEntry(entry.id,{amountCents:8000},f.allowed),/liquidado|baixado/i);
   assert.throws(()=>f.workspace.updateEntry(entry.id,{amountCents:-100},f.allowed),/valor/i);
   const sale=f.finance.createEntry({kind:'RECEIVABLE',description:'PDV',amountCents:500,dueAt:'2026-11-11',sourceType:'sale'});
   assert.throws(()=>f.workspace.updateEntry(sale.id,{description:'manipulado'},f.allowed),/automatic/i);
 }finally{f.db.close();}
});
test('Importacao CSV em lote e atomica e idempotente',()=>{
  const f=fixture();try{
    const rows=[{kind:'PAYABLE',description:'Aluguel',amountCents:15000,dueAt:'2026-11-10'},{kind:'RECEIVABLE',description:'Cliente',amountCents:5000,dueAt:'2026-11-12'}];
    assert.throws(()=>f.workspace.importEntries([...rows,{kind:'PAYABLE',description:'Invalido',amountCents:-1,dueAt:'2026-11-12'}],'csv-bad',f.allowed),/valor/i);
    assert.equal(f.finance.listEntries().length,0);
    assert.equal(f.workspace.importEntries(rows,'csv-okay',f.allowed).count,2);
    assert.equal(f.workspace.importEntries(rows,'csv-okay',f.allowed).count,2);
    assert.equal(f.finance.listEntries().length,2);
    assert.throws(()=>f.workspace.importEntries([rows[0]],'csv-okay',f.allowed),/reutilizada/i);
  }finally{f.db.close();}
});
