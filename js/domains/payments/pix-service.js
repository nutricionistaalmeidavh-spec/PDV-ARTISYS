'use strict';

const { randomUUID } = require('node:crypto');
const { writeAudit } = require('../../core/audit-log');
const { assertCents } = require('../shared/money');
const { buildPixPayload } = require('./pix-brcode');

const PIX_CONFIG_KEY='payments.pix.config';

function createPixService({db,settings,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!settings)throw new TypeError('Database and settings are required.');

  function getConfiguration(){
    return settings.get(PIX_CONFIG_KEY,{defaultValue:{enabled:false,pixKey:'',merchantName:'',merchantCity:'',descriptionPrefix:''}});
  }

  function saveConfiguration(input={},actor=null){
    if(!['admin','manager','system'].includes(String(actor?.role||'')))throw new Error('Permissao insuficiente para configurar Pix.');
    const config={
      enabled:Boolean(input.enabled),
      pixKey:String(input.pixKey||'').trim(),
      merchantName:String(input.merchantName||'').trim(),
      merchantCity:String(input.merchantCity||'').trim(),
      descriptionPrefix:String(input.descriptionPrefix||'').trim()
    };
    if(config.enabled&&(!config.pixKey||!config.merchantName||!config.merchantCity))throw new Error('Chave, nome e cidade Pix sao obrigatorios quando Pix local esta ativo.');
    settings.set(PIX_CONFIG_KEY,config,{actor:actor||{role:'system',userId:'system'}});
    return config;
  }

  function mapCharge(row){return row&&{
    id:row.id,saleId:row.sale_id,amountCents:row.amount_cents,payload:row.payload,status:row.status,createdAt:row.created_at,
    confirmedAt:row.confirmed_at,confirmedBy:row.confirmed_by,cancelledAt:row.cancelled_at,
    qrData:{format:'PIX_BR_CODE',payload:row.payload}
  };}
  function getCharge(id){return mapCharge(db.prepare('SELECT * FROM pix_charges WHERE id=?').get(String(id)));}
  function listCharges({saleId=null,status=null}={}){const clauses=[];const params=[];if(saleId){clauses.push('sale_id=?');params.push(String(saleId));}if(status){clauses.push('status=?');params.push(String(status).toUpperCase());}return db.prepare(`SELECT * FROM pix_charges${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC`).all(...params).map(mapCharge);}

  function createCharge(input={},actor=null){
    const id=String(input.id||idFactory('pix'));const existing=getCharge(id);if(existing)return existing;
    const saleId=String(input.saleId||'').trim();if(!saleId)throw new Error('Venda obrigatoria para cobranca Pix.');
    const amountCents=assertCents(Number(input.amountCents),'amountCents');if(amountCents<=0)throw new Error('Valor Pix deve ser maior que zero.');
    const config=getConfiguration();if(!config.enabled)throw new Error('Pix local nao esta configurado/ativo.');
    const description=[config.descriptionPrefix,String(input.description||'').trim()].filter(Boolean).join(' ').slice(0,60);
    const payload=buildPixPayload({pixKey:config.pixKey,merchantName:config.merchantName,merchantCity:config.merchantCity,amountCents,txid:input.txid||saleId,description});
    const timestamp=now();db.prepare(`INSERT INTO pix_charges(id,sale_id,amount_cents,payload,status,created_at) VALUES(?,?,?,?,'PENDING',?)`).run(id,saleId,amountCents,payload,timestamp);
    writeAudit(db,{action:'pix.charge.create',entity:'pix-charge',entityId:id,actor,context:{saleId,amountCents}},now);
    return getCharge(id);
  }

  function confirmCharge(id,actor=null){
    const row=db.prepare('SELECT * FROM pix_charges WHERE id=?').get(String(id));if(!row)throw new Error('Cobranca Pix nao encontrada.');if(row.status==='CANCELLED')throw new Error('Cobranca Pix cancelada nao pode ser confirmada.');if(row.status==='CONFIRMED')return getCharge(id);
    const timestamp=now();db.prepare("UPDATE pix_charges SET status='CONFIRMED',confirmed_at=?,confirmed_by=? WHERE id=? AND status='PENDING'").run(timestamp,actor?.userId||null,String(id));
    writeAudit(db,{action:'pix.charge.confirm',entity:'pix-charge',entityId:String(id),actor,context:{saleId:row.sale_id,amountCents:row.amount_cents,confirmation:'manual'}},now);return getCharge(id);
  }

  function cancelCharge(id,{reason='',actor=null}={}){
    const row=db.prepare('SELECT * FROM pix_charges WHERE id=?').get(String(id));if(!row)throw new Error('Cobranca Pix nao encontrada.');if(row.status==='CONFIRMED')throw new Error('Cobranca Pix confirmada nao pode ser cancelada.');if(row.status==='CANCELLED')return getCharge(id);
    const text=String(reason||'').trim();if(!text)throw new Error('Informe o motivo do cancelamento Pix.');const timestamp=now();db.prepare("UPDATE pix_charges SET status='CANCELLED',cancelled_at=? WHERE id=?").run(timestamp,String(id));writeAudit(db,{action:'pix.charge.cancel',entity:'pix-charge',entityId:String(id),actor,context:{reason:text}},now);return getCharge(id);
  }

  function assertConfirmedPayment({chargeId,saleId,amountCents}={}){
    const charge=getCharge(chargeId);if(!charge)throw new Error('Cobranca Pix nao encontrada.');if(charge.status!=='CONFIRMED')throw new Error('Cobranca Pix ainda nao foi confirmada.');if(String(charge.saleId)!==String(saleId))throw new Error('Cobranca Pix pertence a outra venda; venda divergente.');if(Number(charge.amountCents)!==Number(amountCents))throw new Error('Valor da cobranca Pix diverge do pagamento.');return charge;
  }

  return{getConfiguration,saveConfiguration,createCharge,getCharge,listCharges,confirmCharge,cancelCharge,assertConfirmedPayment};
}

module.exports={createPixService,PIX_CONFIG_KEY};
