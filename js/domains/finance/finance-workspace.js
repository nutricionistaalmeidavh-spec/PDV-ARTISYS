'use strict';
const {createHash,randomUUID}=require('node:crypto');
const {withTransaction}=require('../../core/database/sqlite-database');
const {writeAudit}=require('../../core/audit-log');

const STAGES=new Set(['PENDING','IN_PROGRESS','DONE']);
const PRIORITIES=new Set(['LOW','NORMAL','HIGH']);
function dateOnly(value,required=false){
  if((value===null||value===undefined||value==='')&&!required)return null;
  const text=String(value||'').slice(0,10);
  const parsed=new Date(text+'T00:00:00.000Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==text)
    throw new Error('Data invalida; use AAAA-MM-DD.');
  return text;
}
function stageOf(value){const stage=String(value||'').toUpperCase();if(!STAGES.has(stage))throw new Error('Etapa do Kanban invalida.');return stage;}
function priorityOf(value){const priority=String(value||'NORMAL').toUpperCase();if(!PRIORITIES.has(priority))throw new Error('Prioridade invalida.');return priority;}
function requireText(value,label,max=240){const s=String(value||'').trim();if(!s||s.length>max)throw new Error(label+' obrigatorio (ate '+max+' caracteres).');return s;}
function userId(actor){const id=String(actor?.userId||'').trim();if(!id)throw new Error('Usuario autenticado obrigatorio.');return id;}

function createFinanceWorkspace({db,finance,financeManagement=null,reports=null,authorization=null,now=()=>new Date().toISOString(),idFactory=p=>p+'-'+randomUUID()}={}){
  if(!db||!finance)throw new TypeError('db and finance are required.');
  function rawCard(id){return db.prepare('SELECT * FROM finance_kanban_cards WHERE id=?').get(String(id));}
  function linkedEntry(id){
    if(!String(id).startsWith('entry:'))return null;
    return finance.getEntry(String(id).slice(6));
  }
  function getCard(id){
    const entry=linkedEntry(id);
    const row=rawCard(id);
    if(entry){
      if(entry.status==='CANCELLED')return null;
      const stage=entry.status==='SETTLED'?'DONE':entry.status==='PARTIAL'?'IN_PROGRESS':row?.stage==='DONE'?'PENDING':row?.stage||'PENDING';
      return{id:'entry:'+entry.id,entryId:entry.id,title:entry.description,details:row?.details||entry.notes||'',
        priority:row?.priority||'NORMAL',assigneeId:row?.assignee_id||null,dueAt:dateOnly(entry.dueAt),stage,
        kind:entry.kind,amountCents:entry.amountCents,openCents:entry.openCents,accountId:entry.accountId,
        status:entry.status,sourceType:entry.sourceType,updatedAt:row?.updated_at||entry.updatedAt};
    }
    if(!row||row.entry_id)return null;
    return{id:row.id,entryId:null,title:row.title,details:row.details||'',priority:row.priority,assigneeId:row.assignee_id,
      dueAt:row.due_at,stage:row.stage,kind:'TASK',amountCents:0,openCents:0,accountId:null,status:null,updatedAt:row.updated_at};
  }
  function listCards(filters={}){
    const entries=finance.listEntries(filters).filter(entry=>entry.status!=='CANCELLED').map(entry=>getCard('entry:'+entry.id));
    const tasks=db.prepare('SELECT id FROM finance_kanban_cards WHERE entry_id IS NULL ORDER BY due_at,id').all()
      .map(row=>getCard(row.id)).filter(card=>(!filters.from||!card.dueAt||card.dueAt>=filters.from)&&(!filters.to||!card.dueAt||card.dueAt<=filters.to));
    const all=entries.concat(tasks).filter(Boolean);
    return all.filter(card=>!filters.stage||card.stage===String(filters.stage).toUpperCase())
      .sort((a,b)=>String(a.dueAt||'9999-12-31').localeCompare(String(b.dueAt||'9999-12-31'))||a.title.localeCompare(b.title,'pt-BR'));
  }
  function validateAssignee(value){
    if(!value)return null;
    const id=String(value);
    if(!db.prepare('SELECT 1 FROM users WHERE id=? AND active=1').get(id))throw new Error('Responsavel nao encontrado ou inativo.');
    return id;
  }
  function createTask(input={},actor=null){
    const title=requireText(input.title,'Titulo');
    const details=String(input.details||'').slice(0,4000);
    const dueAt=dateOnly(input.dueAt);
    const priority=priorityOf(input.priority);
    const assigneeId=validateAssignee(input.assigneeId);
    const id=idFactory('fin-task'),timestamp=now(),by=userId(actor);
    return withTransaction(db,()=>{
      db.prepare("INSERT INTO finance_kanban_cards (id,entry_id,title,details,due_at,priority,assignee_id,stage,created_by,updated_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'PENDING',?,?,?,?)")
        .run(id,null,title,details,dueAt,priority,assigneeId,by,by,timestamp,timestamp);
      writeAudit(db,{action:'finance.kanban.task.create',entity:'finance-kanban-card',entityId:id,actor,context:{title,dueAt,priority}},now);
      return getCard(id);
    });
  }
  function updateTask(id,input={},actor=null){
    const by=userId(actor),row=rawCard(id);
    if(!row||row.entry_id)throw new Error('Tarefa do Kanban nao encontrada.');
    const title=input.title===undefined?row.title:requireText(input.title,'Titulo');
    const details=input.details===undefined?row.details:String(input.details||'').slice(0,4000);
    const dueAt=input.dueAt===undefined?row.due_at:dateOnly(input.dueAt);
    const priority=input.priority===undefined?row.priority:priorityOf(input.priority);
    const assigneeId=input.assigneeId===undefined?row.assignee_id:validateAssignee(input.assigneeId);
    return withTransaction(db,()=>{
      db.prepare('UPDATE finance_kanban_cards SET title=?,details=?,due_at=?,priority=?,assignee_id=?,updated_by=?,updated_at=? WHERE id=?')
        .run(title,details,dueAt,priority,assigneeId,by,now(),row.id);
      writeAudit(db,{action:'finance.kanban.task.update',entity:'finance-kanban-card',entityId:row.id,actor,context:{title,dueAt,priority}},now);
      return getCard(id);
    });
  }
  function moveCard(id,input={},actor=null){
    const target=stageOf(input.stage),by=userId(actor),key=String(input.idempotencyKey||'').trim();
    return withTransaction(db,()=>{
      const card=getCard(id);
      if(!card)throw new Error('Card financeiro nao encontrado.');
      if(card.entryId&&target==='DONE'&&card.openCents>0){
        if(input.confirmed!==true)throw new Error('Confirmacao explicita da baixa financeira obrigatoria.');
        if(!authorization)throw new Error('Servico de autorizacao obrigatorio para baixa.');
        authorization.require({principal:{kind:'human',id:by},capability:'finance.settle'});
        if(!key||key.length>160)throw new Error('Chave de idempotencia obrigatoria para baixa.');
      }
      if(key){
        if(key.length>160)throw new Error('Chave de idempotencia invalida.');
        const earlier=db.prepare('SELECT * FROM finance_kanban_actions WHERE idempotency_key=?').get(key);
        if(earlier){
          if(earlier.card_id!==id||earlier.stage!==target||earlier.actor_id!==by)
            throw new Error('Chave de idempotencia reutilizada com outra operacao.');
          return getCard(id);
        }
      }
      if(card.entryId&&card.status==='SETTLED'&&target!=='DONE')
        throw new Error('Estorne as baixas financeiras com permissao propria antes de reabrir o card.');
      if(card.entryId&&card.status==='PARTIAL'&&target==='PENDING')
        throw new Error('Estorne a baixa parcial antes de voltar para Pendente.');
      let settlementId=null;
      if(card.entryId&&target==='DONE'&&card.openCents>0){
        const accountId=String(input.accountId||card.accountId||'').trim();
        const account=accountId?finance.getAccount(accountId):null;
        if(!account||!account.active)throw new Error('Selecione uma conta financeira ativa para a baixa.');
        if(card.accountId&&card.accountId!==accountId)throw new Error('Conta diferente da vinculada ao lancamento.');
        const method=requireText(input.method,'Forma de pagamento',40);
        if(!card.accountId)db.prepare('UPDATE financial_entries SET account_id=?,updated_at=? WHERE id=?')
          .run(accountId,now(),card.entryId);
        const settlement=finance.settleEntry(card.entryId,{amountCents:card.openCents,method,note:'Baixa confirmada no Kanban',id:idFactory('fin-kanban-settle')},actor);
        settlementId=settlement.settlement.id;
      }
      const timestamp=now();
      const existing=rawCard(id);
      if(existing)db.prepare('UPDATE finance_kanban_cards SET stage=?,updated_by=?,updated_at=?,completed_at=? WHERE id=?')
        .run(target,by,timestamp,target==='DONE'?timestamp:null,id);
      else db.prepare('INSERT INTO finance_kanban_cards (id,entry_id,title,details,due_at,priority,assignee_id,stage,created_by,updated_by,created_at,updated_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
        .run(id,card.entryId,card.title,card.details,card.dueAt,card.priority,card.assigneeId,target,by,by,timestamp,timestamp,target==='DONE'?timestamp:null);
      if(key)db.prepare('INSERT INTO finance_kanban_actions (idempotency_key,card_id,stage,actor_id,settlement_id,created_at) VALUES (?,?,?,?,?,?)')
        .run(key,id,target,by,settlementId,timestamp);
      writeAudit(db,{action:settlementId?'finance.kanban.settle':'finance.kanban.move',entity:'finance-kanban-card',entityId:id,actor,context:{stage:target,entryId:card.entryId,settlementId,amountCents:settlementId?card.openCents:0}},now);
      return getCard(id);
    });
  }
  function updateEntry(id,input={},actor=null){
    const by=userId(actor);
    return withTransaction(db,()=>{
      const entry=finance.getEntry(id);
      if(!entry)throw new Error('Lancamento financeiro nao encontrado.');
      if(entry.sourceType)throw new Error('Lancamento automatico do PDV nao pode ser editado na planilha.');
      if(entry.status==='CANCELLED')throw new Error('Lancamento cancelado nao pode ser editado.');
      const description=input.description===undefined?entry.description:requireText(input.description,'Descricao');
      const amountCents=input.amountCents===undefined?entry.amountCents:Number(input.amountCents);
      if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw new Error('Valor financeiro invalido.');
      if(amountCents<entry.settledCents)throw new Error('Valor nao pode ficar abaixo do montante liquidado/baixado.');
      const dueAt=input.dueAt===undefined?entry.dueAt:dateOnly(input.dueAt,true);
      const category=input.category===undefined?entry.category:String(input.category||'').slice(0,160)||null;
      const notes=input.notes===undefined?entry.notes:String(input.notes||'').slice(0,2000)||null;
      const accountId=input.accountId===undefined?entry.accountId:input.accountId||null;
      if(accountId&&(!finance.getAccount(accountId)||!finance.getAccount(accountId).active))throw new Error('Conta financeira nao encontrada ou inativa.');
      if(entry.settledCents>0&&accountId!==entry.accountId)throw new Error('Conta com baixa registrada nao pode ser alterada.');
      db.prepare('UPDATE financial_entries SET description=?,amount_cents=?,due_at=?,category=?,notes=?,account_id=?,updated_at=? WHERE id=?')
        .run(description,amountCents,dueAt,category,notes,accountId,now(),entry.id);
      // Recompute on amount changes so a previously SETTLED entry with higher amount becomes PARTIAL.
      const status=entry.settledCents<=0?'OPEN':entry.settledCents<amountCents?'PARTIAL':'SETTLED';
      db.prepare('UPDATE financial_entries SET status=? WHERE id=?').run(status,entry.id);
      writeAudit(db,{action:'finance.spreadsheet.update',entity:'financial-entry',entityId:entry.id,actor,context:{description,amountCents,dueAt,accountId,by}},now);
      return finance.getEntry(entry.id);
    });
  }
  function importEntries(rows,idempotencyKey,actor=null){
    const key=requireText(idempotencyKey,'Chave de idempotencia',160),by=userId(actor);
    if(!Array.isArray(rows)||rows.length<1||rows.length>500)throw new Error('Importacao aceita de 1 a 500 linhas.');
    const safeRows=rows.map(row=>({
      kind:row.kind,description:row.description,amountCents:row.amountCents,
      dueAt:row.dueAt,category:row.category,accountId:row.accountId,
      notes:row.notes,categoryId:row.categoryId,costCenterId:row.costCenterId,competencyDate:row.competencyDate
    }));
    const hash=createHash('sha256').update(JSON.stringify(safeRows)).digest('hex');
    return withTransaction(db,()=>{
      const previous=db.prepare('SELECT * FROM finance_workspace_imports WHERE idempotency_key=?').get(key);
      if(previous){
        if(previous.payload_hash!==hash||previous.created_by!==by)throw new Error('Chave de idempotencia reutilizada com outro conteudo.');
        return{count:previous.row_count,duplicate:true};
      }
      for(const row of safeRows)finance.createEntry(row,actor);
      db.prepare('INSERT INTO finance_workspace_imports(idempotency_key,payload_hash,row_count,created_by,created_at) VALUES (?,?,?,?,?)')
        .run(key,hash,safeRows.length,by,now());
      writeAudit(db,{action:'finance.spreadsheet.import',entity:'finance-import',entityId:key,actor,context:{count:safeRows.length}},now);
      return{count:safeRows.length,duplicate:false};
    });
  }
  function bi({from,to,basis='cash'}={}){
    if(!financeManagement)throw new Error('Gestao financeira indisponivel.');
    const current=dateOnly(now().slice(0,10),true);
    const toDate=dateOnly(to||current,true);
    const fromDate=dateOnly(from||toDate.slice(0,7)+'-01',true);
    if(fromDate>toDate)throw new Error('Periodo invalido.');
    if(!['cash','accrual'].includes(basis))throw new Error('Base invalida.');
    const dashboard=financeManagement.dashboard({from:fromDate,to:toDate,basis});
    const dre=financeManagement.dre({from:fromDate,to:toDate,basis});
    const cashflow=financeManagement.cashflow({from:fromDate,to:toDate,projectionDays:30});
    let cursor=fromDate.slice(0,7),last=toDate.slice(0,7),index=0;const series=[];
    while(cursor<=last&&index++<24){
      const start=cursor+'-01';
      const nextDate=new Date(start+'T00:00:00.000Z');nextDate.setUTCMonth(nextDate.getUTCMonth()+1);
      const next=nextDate.toISOString().slice(0,10),end=new Date(nextDate.getTime()-86400000).toISOString().slice(0,10);
      const part=financeManagement.dre({from:start<fromDate?fromDate:start,to:end>toDate?toDate:end,basis});
      series.push({month:cursor,revenueCents:part.revenueCents,costCents:part.costCents,expenseCents:part.expenseCents,resultCents:part.resultCents});
      cursor=next.slice(0,7);
    }
    return{from:fromDate,to:toDate,basis,dashboard,dre,cashflow,series,truncated:cursor<=last};
  }
  return{getCard,listCards,createTask,updateTask,moveCard,updateEntry,importEntries,bi};
}
module.exports={createFinanceWorkspace};
