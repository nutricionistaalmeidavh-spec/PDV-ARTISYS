'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runAccessProfileMigrations}=require('../js/core/database/access-profile-migrations');
const {runCanonicalAccessMigrations}=require('../js/core/database/canonical-access-migrations');
const {runCashManagementMigrations}=require('../js/core/database/cash-management-migrations');
const {createCatalogService}=require('../js/domains/catalog/catalog-service');
const {createCashService}=require('../js/domains/cash/cash-service');
const {createReportingService}=require('../js/domains/reports/reporting-service');
const {SqliteOutboxStore}=require('../js/core/database/outbox-store');
const NOW='2026-11-15T15:00:00.000Z';
const admin={kind:'human',userId:'admin'};
const cashier={kind:'human',userId:'cashier'};

function fixture(){
  const db=openDatabase(':memory:');
  runMigrations(db);runAccessProfileMigrations(db);runCanonicalAccessMigrations(db);
  runCashManagementMigrations(db);runCashManagementMigrations(db);
  let n=0;const ids=p=>p+'-'+(++n);
  const catalog=createCatalogService({db,now:()=>NOW,idFactory:ids});
  catalog.createUser({id:'admin',username:'admincash',name:'Administrador',profileId:'profile-administrator',password:'senha-forte-123'});
  catalog.createUser({id:'cashier',username:'caixacash',name:'Operadora',profileId:'profile-cashier',password:'senha-forte-123'});
  const cash=createCashService({db,outbox:new SqliteOutboxStore(db),now:()=>NOW,idFactory:ids});
  const reports=createReportingService({db,now:()=>NOW});
  return {db,cash,reports};
}

test('registra abertura e fechamento por usuarios distintos, com trilha auditavel',()=>{
  const f=fixture();
  try {
    f.cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'cashier',actor:cashier});
    const closed=f.cash.closeSession('cs1',{countedByMethod:{CASH:0},actor:admin});
    assert.equal(closed.openedByName,'Operadora');
    assert.equal(closed.closedById,'admin');
    assert.equal(closed.closedByName,'Administrador');
    const detail=f.cash.getSessionDetails('cs1');
    assert.ok(detail.timeline.some(entry=>entry.action==='cash.open'&&entry.actorId==='cashier'));
    assert.ok(detail.timeline.some(entry=>entry.action==='cash.close'&&entry.actorId==='admin'));
  }finally{f.db.close();}
});

test('correcao do valor contado preserva o fechamento original e ajusta relatorio',()=>{
  const f=fixture();
  try {
    f.cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'cashier',initialCashCents:1000,actor:cashier});
    f.cash.closeSession('cs1',{countedByMethod:{CASH:900},actor:cashier});
    assert.throws(()=>f.cash.correctClosing('cs1',{countedCashCents:1100,reason:'Conferencia apos fechamento',actor:cashier}),/administrador|permiss/i);
    assert.throws(()=>f.cash.correctClosing('cs1',{countedCashCents:1100,reason:'',actor:admin}),/motivo|justific/i);
    const corrected=f.cash.correctClosing('cs1',{countedCashCents:1100,reason:'Recontagem do dinheiro em especie',actor:admin});
    assert.equal(corrected.countedCashCents,1100);
    assert.equal(corrected.divergenceCents,100);
    assert.equal(f.db.prepare('SELECT counted_cash_cents FROM cash_sessions WHERE id=?').get('cs1').counted_cash_cents,900);
    assert.equal(f.cash.getSessionDetails('cs1').corrections.length,1);
    const report=f.reports.buildCashSummary({from:'2026-11-15T00:00:00.000Z',to:'2026-11-16T00:00:00.000Z'});
    assert.equal(report.countedCashCents,1100);
    assert.equal(report.divergenceCents,100);
  }finally{f.db.close();}
});

test('anula somente caixa fechado sem atividade financeira e o conserva na auditoria',()=>{
  const f=fixture();
  try {
    f.cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'cashier',initialCashCents:500,actor:cashier});
    f.cash.closeSession('cs1',{countedByMethod:{CASH:500},actor:cashier});
    assert.throws(()=>f.cash.annulSession('cs1',{reason:'Caixa aberto apenas para teste',actor:cashier}),/administrador|permiss/i);
    assert.throws(()=>f.cash.annulSession('cs1',{reason:'teste',actor:admin}),/motivo|justific/i);
    assert.equal(f.cash.getSessionDetails('cs1').canAnnul,true);
    const annulled=f.cash.annulSession('cs1',{reason:'Caixa aberto apenas para teste',actor:admin});
    assert.equal(annulled.status,'ANNULLED');
    assert.equal(annulled.annulledById,'admin');
    assert.equal(f.cash.listSessions({status:'ANNULLED'}).length,1);
    assert.ok(f.cash.getSessionDetails('cs1').timeline.some(e=>e.action==='cash.annul'));
    assert.throws(()=>f.cash.annulSession('cs1',{reason:'Tentativa de repetir anulacao',actor:admin}),/anulad/i);
    const report=f.reports.buildCashSummary({from:'2026-11-15T00:00:00.000Z',to:'2026-11-16T00:00:00.000Z'});
    assert.equal(report.closedSessions,0);
    assert.equal(report.openingCashCents,0);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM cash_movements WHERE cash_session_id=?').get('cs1').n,1);
  }finally{f.db.close();}
});

test('impede anular sessoes com suprimentos, vendas ou vendas sem efeitos de caixa ainda',()=>{
  const f=fixture();
  try {
    f.cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'cashier',actor:cashier});
    f.cash.addSupply('cs1',{amountCents:100});
    f.cash.closeSession('cs1',{countedByMethod:{CASH:100},actor:cashier});
    assert.throws(()=>f.cash.annulSession('cs1',{reason:'Solicitacao de anular operacao com suprimento',actor:admin}),/moviment|venda|operac/i);
    f.cash.openSession({id:'cs2',terminalId:'pdv-01',operatorId:'cashier',actor:cashier});
    f.cash.closeSession('cs2',{countedByMethod:{CASH:0},actor:cashier});
    f.db.prepare("INSERT INTO sales(id,sale_number,terminal_id,operator_id,status,opened_at,completed_at,updated_at) VALUES ('s2','000002','pdv-01','cashier','COMPLETED',?,?,?)").run(NOW,NOW,NOW);
    assert.equal(f.cash.getSessionDetails('cs2').canAnnul,false);
    assert.throws(()=>f.cash.annulSession('cs2',{reason:'Registro de venda nao pode ser apagado',actor:admin}),/venda|moviment|operac/i);
    assert.equal(f.cash.getSession('cs2').status,'CLOSED');
  }finally{f.db.close();}
});


test('identifica o responsavel por suprimentos na sessao e preserva auditoria',()=>{
  const f=fixture();
  try{
    f.cash.openSession({id:'cs-audit',terminalId:'pdv-01',operatorId:'cashier',actor:cashier});
    f.cash.addSupply('cs-audit',{amountCents:1000,note:'Troco adicional',actor:admin});
    const movement=f.cash.getSession('cs-audit').movements.find(m=>m.type==='SUPPLY');
    assert.equal(movement.actorId,'admin');
    assert.equal(movement.actorName,'Administrador');
  }finally{f.db.close();}
});

test('migração preserva sessões antigas e recupera responsável do fechamento pela auditoria',()=>{
  const db=openDatabase(':memory:');
  try{
    runMigrations(db);runAccessProfileMigrations(db);runCanonicalAccessMigrations(db);
    const catalog=createCatalogService({db,now:()=>NOW});
    catalog.createUser({id:'admin',username:'adminlegado',name:'Administrador',profileId:'profile-administrator',password:'senha-forte-123'});
    catalog.createUser({id:'cashier',username:'caixalegado',name:'Operadora',profileId:'profile-cashier',password:'senha-forte-123'});
    db.prepare("INSERT INTO cash_sessions(id,terminal_id,operator_id,status,initial_cash_cents,expected_cash_cents,counted_cash_cents,divergence_cents,opened_at,closed_at) VALUES ('antigo','pdv-01','cashier','CLOSED',100,100,100,0,?,?)").run(NOW,NOW);
    db.prepare("INSERT INTO audit_log(action,entity,entity_id,actor_id,context_json,created_at) VALUES ('cash.close','cash-session','antigo','admin','{}',?)").run(NOW);
    runCashManagementMigrations(db);
    const legacy=db.prepare("SELECT * FROM cash_sessions WHERE id='antigo'").get();
    assert.equal(legacy.closed_by_id,'admin');
    assert.equal(legacy.counted_cash_cents,100);
    assert.equal(legacy.status,'CLOSED');
  }finally{db.close();}
});

test('atribui a sangria ao usuario que realizou a retirada',()=>{
  const f=fixture();
  try{
    f.cash.openSession({id:'cs-sangria',terminalId:'pdv-01',operatorId:'cashier',initialCashCents:2000,actor:cashier});
    f.cash.withdraw('cs-sangria',{amountCents:500,note:'Retirada para troco',actor:admin});
    const movement=f.cash.getSession('cs-sangria').movements.find(m=>m.type==='WITHDRAWAL');
    assert.equal(movement.actorId,'admin');
    assert.equal(movement.actorName,'Administrador');
  }finally{f.db.close();}
});
