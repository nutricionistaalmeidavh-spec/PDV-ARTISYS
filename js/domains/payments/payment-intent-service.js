'use strict';
const {randomUUID,createHash}=require('node:crypto');
const {withTransaction}=require('../../core/database/sqlite-database');
const {buildStaticPix}=require('./pix-brcode');
const {pixQrSvg}=require('./pix-qr-svg');
const {assertCents}=require('../shared/money');

const CHANNEL_METHODS=Object.freeze({PIX_STATIC:['PIX'],PIX_API:['PIX'],TEF:['DEBIT_CARD','CREDIT_CARD']});
function migratePaymentIntents(db){
  // Additive and non-destructive. No credential/certificate ever persists here.
  db.exec(`CREATE TABLE IF NOT EXISTS payment_intents (
    id TEXT PRIMARY KEY,
    sale_id TEXT NOT NULL REFERENCES sales(id),
    channel TEXT NOT NULL CHECK(channel IN ('PIX_STATIC','PIX_API','TEF')),
    method TEXT NOT NULL CHECK(method IN ('PIX','DEBIT_CARD','CREDIT_CARD')),
    amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
    idempotency_key TEXT NOT NULL,
    txid TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK(status IN ('PENDING','REVIEW','VERIFIED','MANUAL_CONFIRMED','CANCELLED','FAILED','CONSUMED')),
    br_code TEXT,
    end_to_end_id TEXT UNIQUE,
    provider_reference TEXT,
    confirmation_source TEXT,
    confirmed_by TEXT,
    started_at TEXT,
    verified_at TEXT,
    consumed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(sale_id,channel,idempotency_key)
  );
  CREATE INDEX IF NOT EXISTS idx_payment_intents_sale ON payment_intents(sale_id,status);`);
}
function createPaymentIntentService({
  db,sales,now=()=>new Date().toISOString(),
  idFactory=()=>randomUUID(),pixStatic=null,pixProvider=null,tefProvider=null
}={}){
  if(!db||!sales)throw new TypeError('Banco e vendas sao obrigatorios.');
  migratePaymentIntents(db);
  const getRow=id=>db.prepare('SELECT * FROM payment_intents WHERE id=?').get(String(id));
  function publicRow(row){
    if(!row)return null;
    let qrSvg=null;
    if(row.br_code){try{qrSvg=pixQrSvg(row.br_code);}catch{/* copied payload still available */}}
    return{qrSvg,id:row.id,saleId:row.sale_id,channel:row.channel,method:row.method,amountCents:row.amount_cents,
      status:row.status,brCode:row.br_code,txid:row.txid,endToEndId:row.end_to_end_id,
      providerReference:row.provider_reference,confirmationSource:row.confirmation_source,
      confirmedBy:row.confirmed_by,startedAt:row.started_at,verifiedAt:row.verified_at,
      consumedAt:row.consumed_at,createdAt:row.created_at,updatedAt:row.updated_at};
  }
  function requireIntent(id){const row=getRow(id);if(!row)throw new Error('Tentativa de pagamento nao encontrada.');return row;}
  function get(id){return publicRow(getRow(id));}
  function listBySale(saleId){return db.prepare('SELECT * FROM payment_intents WHERE sale_id=? ORDER BY created_at,id').all(String(saleId)).map(publicRow);}
  function create({saleId,channel,method='PIX',amountCents,idempotencyKey}={}){
    const kind=String(channel||'').toUpperCase(),paymentMethod=String(method||'PIX').toUpperCase();
    if(!CHANNEL_METHODS[kind]||!CHANNEL_METHODS[kind].includes(paymentMethod))throw new Error('Meio/canal de pagamento invalido.');
    const amount=assertCents(amountCents,'amountCents');
    if(amount<=0)throw new Error('Valor de pagamento invalido.');
    const requestId=String(idempotencyKey||'').trim();
    if(!requestId||requestId.length>128)throw new Error('Chave de idempotencia obrigatoria.');
    const staticConfig=typeof pixStatic==='function'?pixStatic():pixStatic;
    if(kind==='PIX_STATIC'&&!staticConfig?.key)throw new Error('Pix local nao configurado.');
    if(kind==='PIX_API'&&!pixProvider)throw new Error('Banco Pix nao configurado.');
    if(kind==='TEF'&&!tefProvider)throw new Error('TEF nao configurado.');
    return withTransaction(db,()=>{
      const sale=sales.getSale(saleId);
      if(!sale||sale.status!=='OPEN')throw new Error('A venda precisa estar aberta.');
      const previous=db.prepare('SELECT * FROM payment_intents WHERE sale_id=? AND channel=? AND idempotency_key=?').get(String(saleId),kind,requestId);
      if(previous){
        if(previous.amount_cents!==amount||previous.method!==paymentMethod)throw new Error('Conflito de idempotencia para pagamento.');
        return publicRow(previous);
      }
      const reserved=db.prepare("SELECT COALESCE(SUM(amount_cents),0) AS amount FROM payment_intents WHERE sale_id=? AND status NOT IN ('CANCELLED','FAILED')").get(String(saleId)).amount;
      if(amount+reserved>sale.totalCents)throw new Error('Valor das tentativas excede o total atual da venda.');
      const id=String(idFactory('intent'));
      const txid=createHash('sha256').update(id).digest('hex').slice(0,kind==='PIX_STATIC'?25:26).toUpperCase();
      const brCode=kind==='PIX_STATIC'?buildStaticPix({
        key:staticConfig.key,merchantName:staticConfig.merchantName,merchantCity:staticConfig.merchantCity,
        amountCents:amount,txid
      }):null;
      const timestamp=now();
      db.prepare(`INSERT INTO payment_intents
        (id,sale_id,channel,method,amount_cents,idempotency_key,txid,status,br_code,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,'PENDING',?,?,?)`)
        .run(id,String(saleId),kind,paymentMethod,amount,requestId,txid,brCode,timestamp,timestamp);
      return get(id);
    });
  }
  async function start(id){
    const row=requireIntent(id);
    if(row.channel==='PIX_STATIC')return get(id);
    if(row.status!=='PENDING'||row.started_at)return get(id); // Never re-charge after a crash or timeout.
    const provider=row.channel==='PIX_API'?pixProvider:tefProvider;
    if(!provider||typeof provider.start!=='function')throw new Error('Provedor nao configurado.');
    const claimed=withTransaction(db,()=>{
      const updated=db.prepare("UPDATE payment_intents SET started_at=?,updated_at=? WHERE id=? AND started_at IS NULL AND status='PENDING'")
        .run(now(),now(),row.id);
      return updated.changes===1;
    });
    if(!claimed)return get(id);
    try{
      const response=await provider.start({id:row.id,txid:row.txid,amountCents:row.amount_cents,
        method:row.method,saleId:row.sale_id});
      if(row.channel==='PIX_API'){
        if(response?.txid!==row.txid||typeof response.brCode!=='string'||!response.brCode.trim())
          throw new Error('Banco nao retornou QR Pix com identificador valido.');
        db.prepare("UPDATE payment_intents SET br_code=?,updated_at=? WHERE id=?")
          .run(response.brCode,now(),row.id);
      }else{
        // The adapter must return actual acquirer credentials, never a UI boolean.
        if(response?.status==='APPROVED'&&response.nsu&&response.authorizationCode&&response.acquirer
          &&response.txid===row.txid&&response.amountCents===row.amount_cents){
          db.prepare("UPDATE payment_intents SET status='VERIFIED',confirmation_source='TEF',provider_reference=?,verified_at=?,updated_at=? WHERE id=? AND status='PENDING'")
            .run(String(response.acquirer)+':'+String(response.nsu)+':'+String(response.authorizationCode),now(),now(),row.id);
        }else if(response?.status==='DECLINED'){
          db.prepare("UPDATE payment_intents SET status='FAILED',updated_at=? WHERE id=?").run(now(),row.id);
        }else{
          db.prepare("UPDATE payment_intents SET status='REVIEW',updated_at=? WHERE id=?").run(now(),row.id);
        }
      }
    }catch(error){
      // Network/PinPad timeouts are indeterminate. Never automatically retry the charge.
      db.prepare("UPDATE payment_intents SET status='REVIEW',updated_at=? WHERE id=? AND status='PENDING'").run(now(),row.id);
    }
    return get(id);
  }
  async function reconcile(id){
    const row=requireIntent(id);
    if(row.channel!=='PIX_API')throw new Error('Conciliacao automatica disponivel apenas para Pix bancario.');
    if(row.status==='VERIFIED'||row.status==='CONSUMED')return get(id);
    if(row.status==='CANCELLED'||row.status==='FAILED')throw new Error('Tentativa encerrada.');
    if(!row.started_at)throw new Error('Cobranca Pix ainda nao iniciada.');
    if(!pixProvider||typeof pixProvider.verify!=='function')throw new Error('Banco Pix nao configurado.');
    const receipt=await pixProvider.verify({id:row.id,txid:row.txid,amountCents:row.amount_cents});
    if(receipt?.status!=='PAID')return get(id);
    if(receipt.txid!==row.txid||receipt.amountCents!==row.amount_cents||
      typeof receipt.endToEndId!=='string'||!/^E[A-Za-z0-9]{8,}$/.test(receipt.endToEndId))
      throw new Error('Comprovacao bancaria inconsistente: txid, valor ou EndToEndId.');
    withTransaction(db,()=>{
      db.prepare("UPDATE payment_intents SET status='VERIFIED',confirmation_source='BANK_API',end_to_end_id=?,verified_at=?,updated_at=? WHERE id=? AND status IN ('PENDING','REVIEW')")
        .run(receipt.endToEndId,now(),now(),row.id);
    });
    return get(id);
  }
  function confirmManual(id,{checkedAccountCredit=false,actorId=''}={}){
    const operator=String(actorId||'').trim();
    if(!checkedAccountCredit||!operator)throw new Error('Confirmacao manual exige credito bancario conferido e operador autenticado.');
    return withTransaction(db,()=>{
      const row=requireIntent(id);
      if(row.channel!=='PIX_STATIC'||row.status!=='PENDING')throw new Error('Somente Pix estatico pendente aceita confirmacao manual.');
      db.prepare("UPDATE payment_intents SET status='MANUAL_CONFIRMED',confirmation_source='MANUAL',confirmed_by=?,verified_at=?,updated_at=? WHERE id=?")
        .run(operator,now(),now(),row.id);
      return get(id);
    });
  }
  function cancel(id){
    return withTransaction(db,()=>{
      const row=requireIntent(id);
      if(row.channel!=='PIX_STATIC'||row.status!=='PENDING')throw new Error('Cancelamento automatico de banco/TEF requer conciliacao e estorno no provedor.');
      db.prepare("UPDATE payment_intents SET status='CANCELLED',updated_at=? WHERE id=?").run(now(),id);
      return get(id);
    });
  }
  function validateCheckout(saleId,payments=[]){
    const intents=db.prepare("SELECT * FROM payment_intents WHERE sale_id=? AND status NOT IN ('FAILED','CANCELLED')").all(String(saleId));
    const byId=new Map(intents.map(row=>[row.id,row]));
    const used=new Set();
    for(const payment of payments){
      const intentId=String(payment?.metadata?.paymentIntentId||'').trim();
      if(!intentId)continue;
      const intent=byId.get(intentId);
      if(!intent||used.has(intentId))throw new Error('Tentativa de pagamento nao pertence a venda ou esta duplicada.');
      used.add(intentId);
      if(!['VERIFIED','MANUAL_CONFIRMED'].includes(intent.status))throw new Error('Pagamento integrado ainda nao confirmado.');
      if(intent.amount_cents!==payment.amountCents||intent.method!==String(payment.method||'').toUpperCase())
        throw new Error('Valor ou meio do pagamento integrado diverge da tentativa.');
      if(intent.channel!=='PIX_STATIC'&&intent.status!=='VERIFIED')throw new Error('Pagamento requer confirmacao da operadora.');
    }
    if(intents.some(row=>!used.has(row.id)))throw new Error('Pagamento pendente: associe, concilie ou cancele as tentativas antes de concluir a venda.');
    return [...used];
  }
  function consumeCheckout(saleId,ids){
    for(const id of ids){
      const result=db.prepare("UPDATE payment_intents SET status='CONSUMED',consumed_at=?,updated_at=? WHERE id=? AND sale_id=? AND status IN ('VERIFIED','MANUAL_CONFIRMED')")
        .run(now(),now(),id,String(saleId));
      if(result.changes!==1)throw new Error('Pagamento ja consumido; venda revertida por seguranca.');
    }
  }
  function assertCancellationAllowed(saleId){
    const row=db.prepare("SELECT id FROM payment_intents WHERE sale_id=? AND status NOT IN ('CANCELLED','FAILED') LIMIT 1").get(String(saleId));
    if(row)throw new Error('Venda com cobranca Pix/TEF pendente ou recebida exige cancelamento ou estorno externo conciliado antes de cancelar.');
  }
  function fiscalReferences(saleId){
    return listBySale(saleId).filter(x=>x.status==='CONSUMED').map(x=>({
      paymentIntentId:x.id,method:x.method,channel:x.channel,
      endToEndId:x.endToEndId||null,providerReference:x.providerReference||null,
      confirmationSource:x.confirmationSource
    }));
  }
  function capabilities(){const config=typeof pixStatic==='function'?pixStatic():pixStatic;return {pixStatic:Boolean(config?.key&&config?.merchantName&&config?.merchantCity),pixApi:Boolean(pixProvider),tef:Boolean(tefProvider)};}
  return{create,start,reconcile,confirmManual,cancel,get,listBySale,validateCheckout,consumeCheckout,assertCancellationAllowed,fiscalReferences,capabilities};
}
module.exports={migratePaymentIntents,createPaymentIntentService};
