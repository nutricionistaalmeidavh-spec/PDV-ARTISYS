'use strict';
const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { assertCents }=require('../shared/money');
const { normalizeMethod }=require('../payments/payment-rules');
const { calculateCashClosing }=require('./cash-rules');
const { DEFAULT_PROFILE_IDS }=require('../../core/auth/default-profiles');

function createCashService({db,outbox,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!outbox)throw new TypeError('Database and outbox are required.');
  const managementReady=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='cash_session_corrections'").get());
  function mapMovement(row){
    if(!row)return null;
    const match=/^RETURN:([^:]+):/.exec(String(row.note||''));
    const returnId=match?.[1]||null;
    const saleActor=row.sale_id?db.prepare('SELECT operator_id FROM sales WHERE id=?').get(row.sale_id)?.operator_id:null;
    const returnActor=returnId?db.prepare('SELECT operator_id FROM return_transactions WHERE id=?').get(returnId)?.operator_id:null;
    const openingActor=row.type==='OPENING'?db.prepare('SELECT operator_id FROM cash_sessions WHERE id=?').get(row.cash_session_id)?.operator_id:null;
    const actorId=row.actor_id||saleActor||returnActor||openingActor||null;
    return {id:row.id,cashSessionId:row.cash_session_id,type:row.type,amountCents:row.amount_cents,
      paymentMethod:row.payment_method,saleId:row.sale_id,note:row.note,createdAt:row.created_at,
      ...(returnId?{returnId}:{}),actorId,actorName:userName(actorId)};
  }
  function listSessionMovements(sessionId){return db.prepare('SELECT * FROM cash_movements WHERE cash_session_id=? ORDER BY created_at,id').all(String(sessionId)).map(mapMovement);}
  function latestCorrection(sessionId){
    if(!managementReady)return null;
    return db.prepare('SELECT * FROM cash_session_corrections WHERE cash_session_id=? ORDER BY created_at DESC,id DESC LIMIT 1').get(String(sessionId))||null;
  }
  function userName(userId){
    if(!userId)return null;
    return db.prepare('SELECT name FROM users WHERE id=?').get(String(userId))?.name||null;
  }
  function mapSession(row){
    if(!row)return null;
    const movements=listSessionMovements(row.id);
    const liveExpected=row.expected_cash_cents==null&&row.status==='OPEN'
      ?calculateCashClosing({initialCashCents:row.initial_cash_cents,movements:movements.filter(m=>m.type!=='OPENING'),countedByMethod:{CASH:0}}).expectedCashCents
      :row.expected_cash_cents;
    const correction=latestCorrection(row.id);
    const counted=correction?correction.counted_cash_cents:row.counted_cash_cents;
    return {
      id:row.id,terminalId:row.terminal_id,operatorId:row.operator_id,
      openedByName:userName(row.operator_id),closedById:row.closed_by_id||null,
      closedByName:userName(row.closed_by_id),status:row.annulled_at?'ANNULLED':row.status,
      initialCashCents:row.initial_cash_cents,expectedCashCents:liveExpected,
      originalCountedCashCents:row.counted_cash_cents,countedCashCents:counted,
      divergenceCents:counted==null||liveExpected==null?row.divergence_cents:counted-liveExpected,
      correctedAt:correction?.created_at||null,
      annulledAt:row.annulled_at||null,annulledById:row.annulled_by_id||null,
      annulledByName:userName(row.annulled_by_id),annulReason:row.annul_reason||null,
      openedAt:row.opened_at,closedAt:row.closed_at,movements
    };
  }
  function getSession(id){return mapSession(db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(String(id)));}
  function getOpenSession(terminalId){return mapSession(db.prepare("SELECT * FROM cash_sessions WHERE terminal_id=? AND status='OPEN'").get(String(terminalId)));}
  function listSessions(filters={}){
    const clauses=[];const params=[];
    if(filters.terminalId){clauses.push('terminal_id=?');params.push(String(filters.terminalId));}
    if(filters.operatorId){clauses.push('operator_id=?');params.push(String(filters.operatorId));}
    if(filters.status){
      const status=String(filters.status).toUpperCase();
      if(status==='ANNULLED'&&managementReady)clauses.push('annulled_at IS NOT NULL');
      else if(status==='CLOSED'&&managementReady)clauses.push("status='CLOSED' AND annulled_at IS NULL");
      else{clauses.push('status=?');params.push(status);}
    }
    if(filters.from){clauses.push('opened_at>=?');params.push(String(filters.from));}
    if(filters.to){clauses.push('opened_at<=?');params.push(String(filters.to));}
    const sql=`SELECT * FROM cash_sessions${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY opened_at DESC,id DESC`;
    return db.prepare(sql).all(...params).map(mapSession);
  }
  function requireOpen(id){const row=db.prepare("SELECT * FROM cash_sessions WHERE id=? AND status='OPEN'").get(String(id));if(!row)throw new Error('Caixa nao esta aberto.');return row;}
  function insertMovement({sessionId,type,amountCents,paymentMethod='CASH',saleId=null,note=null,createdAt,actorId=null}){
    assertCents(amountCents,'amountCents');
    if(amountCents<0)throw new Error('Valor do movimento nao pode ser negativo.');
    const method=normalizeMethod(paymentMethod)||'CASH';
    const id=idFactory('cashmov');
    try{
      if(managementReady){
        db.prepare(`INSERT INTO cash_movements
          (id,cash_session_id,type,amount_cents,payment_method,sale_id,note,created_at,actor_id)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(id,sessionId,type,amountCents,method,saleId,note,createdAt||now(),actorId);
      }else{
        db.prepare(`INSERT INTO cash_movements
          (id,cash_session_id,type,amount_cents,payment_method,sale_id,note,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).run(id,sessionId,type,amountCents,method,saleId,note,createdAt||now());
      }
      return mapMovement(db.prepare('SELECT * FROM cash_movements WHERE id=?').get(id));
    }catch(error){
      if(saleId&&/UNIQUE constraint failed/.test(error.message)){
        return mapMovement(db.prepare('SELECT * FROM cash_movements WHERE cash_session_id=? AND sale_id=? AND payment_method=? AND type=?').get(sessionId,saleId,method,type));
      }
      throw error;
    }
  }
  function openSession(input={}){const initial=assertCents(input.initialCashCents??0,'initialCashCents');if(initial<0)throw new Error('Saldo inicial nao pode ser negativo.');const terminalId=String(input.terminalId||'').trim();const operatorId=String(input.operatorId||'').trim();if(!terminalId||!operatorId)throw new Error('Terminal e operador sao obrigatorios.');if(getOpenSession(terminalId))throw new Error('Ja existe caixa aberto neste terminal.');const id=String(input.id||idFactory('cash'));const timestamp=now();return withTransaction(db,()=>{db.prepare("INSERT INTO cash_sessions (id,terminal_id,operator_id,status,initial_cash_cents,opened_at) VALUES (?,?,?,'OPEN',?,?)").run(id,terminalId,operatorId,initial,timestamp);insertMovement({sessionId:id,type:'OPENING',amountCents:initial,paymentMethod:'CASH',note:'Abertura',createdAt:timestamp,actorId:operatorId});const event={eventId:idFactory('evt'),type:'cash-session.opened',aggregate:'cash-session',aggregateId:id,occurredAt:timestamp,actor:input.actor||{userId:operatorId,role:'cashier',terminalId},source:'server',mutationId:input.mutationId||null,payload:{terminalId,initialCashCents:initial}};outbox.insert(event);writeAudit(db,{action:'cash.open',entity:'cash-session',entityId:id,actor:event.actor,context:{terminalId,initialCashCents:initial,eventId:event.eventId}},now);return getSession(id);});}
  function addSupply(id,{amountCents,note='',actor=null}={}){requireOpen(id);assertCents(amountCents,'amountCents');if(amountCents<=0)throw new Error('Suprimento deve ser maior que zero.');const movement=withTransaction(db,()=>insertMovement({sessionId:id,type:'SUPPLY',amountCents,paymentMethod:'CASH',note,createdAt:now(),actorId:actor?.userId||null}));writeAudit(db,{action:'cash.supply',entity:'cash-session',entityId:id,actor,context:{amountCents,note}},now);return movement;}
  function withdraw(id,{amountCents,note='',actor=null}={}){const session=requireOpen(id);assertCents(amountCents,'amountCents');if(amountCents<=0)throw new Error('Sangria deve ser maior que zero.');const movements=db.prepare('SELECT type,amount_cents AS amountCents,payment_method AS paymentMethod FROM cash_movements WHERE cash_session_id=?').all(id);const current=calculateCashClosing({initialCashCents:session.initial_cash_cents,movements:movements.filter(m=>m.type!=='OPENING'),countedByMethod:{CASH:0}}).expectedCashCents;if(amountCents>current)throw new Error('Saldo em dinheiro insuficiente para sangria.');const movement=withTransaction(db,()=>insertMovement({sessionId:id,type:'WITHDRAWAL',amountCents,paymentMethod:'CASH',note,createdAt:now()}));writeAudit(db,{action:'cash.withdraw',entity:'cash-session',entityId:id,actor,context:{amountCents,note}},now);return movement;}

  function findSessionAt(terminalId,occurredAt){
    if(!terminalId||!occurredAt)return null;
    return mapSession(db.prepare(`SELECT * FROM cash_sessions WHERE terminal_id=? AND opened_at<=?
      AND (closed_at IS NULL OR closed_at>=?) ORDER BY opened_at DESC,id DESC LIMIT 1`).get(String(terminalId),String(occurredAt),String(occurredAt)));
  }
  function resolveEffectSession({cashSessionId=null,terminalId=null,occurredAt=null}={}){
    if(cashSessionId){
      const session=getSession(cashSessionId);
      if(!session)throw new Error('Sessao de caixa original nao encontrada.');
      if(session.status==='ANNULLED')throw new Error('Caixa anulado nao aceita novos movimentos.');
      if(terminalId&&String(session.terminalId)!==String(terminalId))throw new Error('Sessao de caixa original nao pertence ao terminal da operacao.');
      return session;
    }
    const historical=findSessionAt(terminalId,occurredAt);
    if(historical){if(historical.status==='ANNULLED')throw new Error('Caixa anulado nao aceita novos movimentos.');return historical;}
    const current=getOpenSession(terminalId);
    if(current)return current;
    throw new Error('Nao existe caixa correspondente a esta operacao.');
  }
  function aggregateAmountsByMethod(items=[]){
    const grouped=new Map();
    for(const item of items||[]){
      const method=normalizeMethod(item?.method)||'CASH';
      const amountCents=assertCents(item?.amountCents,'amountCents');
      if(amountCents<0)throw new Error('Valor do movimento nao pode ser negativo.');
      grouped.set(method,(grouped.get(method)||0)+amountCents);
    }
    return [...grouped].map(([method,amountCents])=>({method,amountCents}));
  }
  function recalculateClosedSession(sessionId){
    const row=db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(String(sessionId));
    if(!row||row.status!=='CLOSED')return;
    const movements=db.prepare('SELECT type,amount_cents AS amountCents,payment_method AS paymentMethod FROM cash_movements WHERE cash_session_id=?').all(row.id).filter(item=>item.type!=='OPENING');
    const summary=calculateCashClosing({initialCashCents:row.initial_cash_cents,movements,countedByMethod:{CASH:Number(row.counted_cash_cents||0)}});
    db.prepare('UPDATE cash_sessions SET expected_cash_cents=?,divergence_cents=? WHERE id=?').run(summary.expectedCashCents,summary.divergenceCents,row.id);
  }
  function recordSalePayments({cashSessionId=null,terminalId,saleId,payments=[],occurredAt=null}={}){const session=resolveEffectSession({cashSessionId,terminalId,occurredAt});const grouped=aggregateAmountsByMethod(payments);const result=withTransaction(db,()=>grouped.map(payment=>insertMovement({sessionId:session.id,type:'SALE',amountCents:payment.amountCents,paymentMethod:payment.method,saleId,createdAt:occurredAt||now()})));recalculateClosedSession(session.id);return result;}
  function reverseSalePayments({cashSessionId=null,terminalId,saleId,payments=[],occurredAt=null}={}){const session=resolveEffectSession({cashSessionId,terminalId,occurredAt});const grouped=aggregateAmountsByMethod(payments);const result=withTransaction(db,()=>grouped.map(payment=>insertMovement({sessionId:session.id,type:'REVERSAL',amountCents:payment.amountCents,paymentMethod:payment.method,saleId,createdAt:occurredAt||now()})));recalculateClosedSession(session.id);return result;}
  function recordReturnRefunds({cashSessionId=null,terminalId,returnId,refunds=[],direction='return',occurredAt=null}={}){
    const session=resolveEffectSession({cashSessionId,terminalId,occurredAt});
    const type=direction==='cancel'?'SALE':'REVERSAL';
    const note=`RETURN:${String(returnId)}:${direction==='cancel'?'CANCELLED':'COMPLETED'}`;
    const result=withTransaction(db,()=>refunds.map(refund=>{
      const method=normalizeMethod(refund.method)||'CASH';
      const existing=db.prepare('SELECT * FROM cash_movements WHERE cash_session_id=? AND type=? AND payment_method=? AND note=?').get(session.id,type,method,note);
      if(existing)return mapMovement(existing);
      return insertMovement({sessionId:session.id,type,amountCents:refund.amountCents,paymentMethod:method,saleId:null,note,createdAt:occurredAt||now()});
    }));
    recalculateClosedSession(session.id);
    return result;
  }
  function closeSession(id,{countedByMethod={},actor={},mutationId=null}={}){
    const session=requireOpen(id);
    return withTransaction(db,()=>{
      const movements=db.prepare('SELECT type,amount_cents AS amountCents,payment_method AS paymentMethod FROM cash_movements WHERE cash_session_id=?').all(id).filter(m=>m.type!=='OPENING');
      const summary=calculateCashClosing({initialCashCents:session.initial_cash_cents,movements,countedByMethod});
      const timestamp=now();
      if(managementReady){
        db.prepare("UPDATE cash_sessions SET status='CLOSED',expected_cash_cents=?,counted_cash_cents=?,divergence_cents=?,closed_at=?,closed_by_id=? WHERE id=? AND status='OPEN'")
          .run(summary.expectedCashCents,summary.countedCashCents,summary.divergenceCents,timestamp,actor?.userId||null,id);
      }else{
        db.prepare("UPDATE cash_sessions SET status='CLOSED',expected_cash_cents=?,counted_cash_cents=?,divergence_cents=?,closed_at=? WHERE id=? AND status='OPEN'")
          .run(summary.expectedCashCents,summary.countedCashCents,summary.divergenceCents,timestamp,id);
      }
      const event={eventId:idFactory('evt'),type:'cash-session.closed',aggregate:'cash-session',aggregateId:id,occurredAt:timestamp,actor,source:'server',mutationId,payload:{terminalId:session.terminal_id,...summary}};
      outbox.insert(event);
      writeAudit(db,{action:'cash.close',entity:'cash-session',entityId:id,actor,context:{status:summary.status,divergenceCents:summary.divergenceCents,eventId:event.eventId}},now);
      return getSession(id);
    });
  }

  function requireAdministrator(actor){
    const userId=String(actor?.userId||'').trim();
    const authorized=userId&&db.prepare(`SELECT 1 FROM users u
      JOIN profiles p ON p.id=u.profile_id AND p.active=1
      JOIN profile_permissions pp ON pp.profile_id=p.id AND pp.permission_id='cash.manage'
      WHERE u.id=? AND u.active=1 AND u.profile_id=?`).get(userId,DEFAULT_PROFILE_IDS.ADMINISTRATOR);
    if(!authorized){
      const error=new Error('Somente administrador com permissao de gestao de caixa pode executar esta acao.');
      error.statusCode=403;throw error;
    }
    return userId;
  }
  function requireReason(reason){
    const text=String(reason||'').trim();
    if(text.length<10||text.length>500)throw new Error('Informe justificativa entre 10 e 500 caracteres.');
    return text;
  }
  function getSessionDetails(id){
    const session=getSession(id);
    if(!session)return null;
    const corrections=managementReady
      ?db.prepare(`SELECT c.id,c.previous_counted_cash_cents AS previousCountedCashCents,
        c.counted_cash_cents AS countedCashCents,c.reason,c.actor_id AS actorId,u.name AS actorName,
        c.created_at AS createdAt FROM cash_session_corrections c
        LEFT JOIN users u ON u.id=c.actor_id WHERE c.cash_session_id=?
        ORDER BY c.created_at,c.id`).all(String(id))
      :[];
    const timeline=db.prepare(`SELECT a.id,a.action,a.actor_id AS actorId,
      COALESCE(u.name,a.actor_id) AS actorName,a.created_at AS createdAt,a.context_json AS contextJson
      FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id
      WHERE a.entity='cash-session' AND a.entity_id=?
      ORDER BY a.created_at,a.id`).all(String(id)).map(row=>({
        ...row,context:(()=>{try{return JSON.parse(row.contextJson||'{}');}catch{return {};}})()
      }));
    return {...session,corrections,timeline};
  }
  function correctClosing(id,{countedCashCents,reason,actor}={}){
    if(!managementReady)throw new Error('Migracao de gestao de caixas nao foi aplicada.');
    const actorId=requireAdministrator(actor);
    const justification=requireReason(reason);
    const counted=assertCents(countedCashCents,'countedCashCents');
    if(counted<0)throw new Error('Valor contado deve ser positivo ou zero.');
    return withTransaction(db,()=>{
      const row=db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(String(id));
      if(!row)throw new Error('Caixa nao encontrado.');
      if(row.status!=='CLOSED'||row.annulled_at)throw new Error('Somente caixa fechado e nao anulado pode ser corrigido.');
      const previous=latestCorrection(id)?.counted_cash_cents??row.counted_cash_cents;
      if(previous===counted)throw new Error('Valor informado ja corresponde a contagem atual.');
      db.prepare(`INSERT INTO cash_session_corrections
        (id,cash_session_id,previous_counted_cash_cents,counted_cash_cents,reason,actor_id,created_at)
        VALUES(?,?,?,?,?,?,?)`).run(idFactory('cashfix'),id,previous,counted,justification,actorId,now());
      writeAudit(db,{action:'cash.correct',entity:'cash-session',entityId:id,actor,context:{previousCountedCashCents:previous,countedCashCents:counted,reason:justification}},now);
      return getSession(id);
    });
  }
  function annulSession(id,{reason,actor}={}){
    if(!managementReady)throw new Error('Migracao de gestao de caixas nao foi aplicada.');
    const actorId=requireAdministrator(actor);
    const justification=requireReason(reason);
    return withTransaction(db,()=>{
      const row=db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(String(id));
      if(!row)throw new Error('Caixa nao encontrado.');
      if(row.annulled_at)throw new Error('Caixa ja anulado.');
      if(row.status!=='CLOSED')throw new Error('Somente caixa fechado pode ser anulado.');
      const nonOpening=db.prepare("SELECT 1 FROM cash_movements WHERE cash_session_id=? AND type<>'OPENING' LIMIT 1").get(row.id);
      if(nonOpening)throw new Error('Nao e possivel anular caixa com movimentacoes; utilize os fluxos de estorno ou devolucao.');
      const sale=db.prepare(`SELECT 1 FROM sales
        WHERE terminal_id=? AND ((opened_at>=? AND opened_at<=?)
          OR (completed_at>=? AND completed_at<=?)
          OR (cancelled_at>=? AND cancelled_at<=?))
        LIMIT 1`).get(row.terminal_id,row.opened_at,row.closed_at,row.opened_at,row.closed_at,row.opened_at,row.closed_at);
      if(sale)throw new Error('Nao e possivel anular caixa com vendas relacionadas ao periodo.');
      const timestamp=now();
      const result=db.prepare(`UPDATE cash_sessions SET annulled_at=?,annulled_by_id=?,annul_reason=?
        WHERE id=? AND status='CLOSED' AND annulled_at IS NULL`).run(timestamp,actorId,justification,row.id);
      if(result.changes!==1)throw new Error('Caixa foi alterado por outra operacao.');
      writeAudit(db,{action:'cash.annul',entity:'cash-session',entityId:id,actor,context:{reason:justification,terminalId:row.terminal_id,originalStatus:row.status}},now);
      return getSession(id);
    });
  }
  return{openSession,addSupply,withdraw,recordSalePayments,reverseSalePayments,recordReturnRefunds,closeSession,getOpenSession,getSession,getSessionDetails,listSessionMovements,listSessions,correctClosing,annulSession,resolveEffectSession};
}
module.exports={createCashService};
