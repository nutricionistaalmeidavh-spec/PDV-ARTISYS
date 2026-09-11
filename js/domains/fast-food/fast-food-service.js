'use strict';

const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');

const TRANSITIONS={NEW:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['DELIVERED','CANCELLED'],DELIVERED:[],CANCELLED:[]};

function createFastFoodService({db,modules,sales=null,kitchen=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules)throw new TypeError('db and modules are required.');
  const gate=()=>modules.requireEnabled('FAST_FOOD');
  const dateKey=ts=>String(ts).slice(0,10);
  const map=row=>row&&({id:row.id,saleId:row.sale_id,dailyNumber:row.daily_number,status:row.status,note:row.note,createdAt:row.created_at,updatedAt:row.updated_at});

  function get(id){
    gate();
    const row=db.prepare('SELECT * FROM fast_food_orders WHERE id=?').get(String(id));
    if(!row)throw new Error('Pedido fast-food nao encontrado.');
    return map(row);
  }

  function create(input={},actor={}){
    gate();
    return withTransaction(db,()=>{
      const ts=now();
      const day=dateKey(ts);
      const number=Number(db.prepare('SELECT COALESCE(MAX(daily_number),0)+1 AS next FROM fast_food_orders WHERE order_date=?').get(day)?.next||1);
      const id=String(input.id||idFactory('fast-order'));
      const items=Array.isArray(input.items)?input.items:[];
      let saleId=input.saleId?String(input.saleId):null;

      if(items.length&&!saleId){
        if(!sales)throw new Error('Motor canonico de vendas indisponivel para fast-food.');
        const terminalId=String(input.terminalId||'').trim();
        const operatorId=String(input.operatorId||'').trim();
        if(!terminalId||!operatorId)throw new Error('Terminal e operador sao obrigatorios para criar a venda fast-food.');
        const sale=sales.openSale({terminalId,operatorId,customerId:input.customerId||null},actor);
        for(const item of items){
          sales.addItem(sale.id,{
            productId:item.productId,
            quantity:item.quantity??1,
            unitPriceCents:item.unitPriceCents,
            configurationSnapshot:item.configurationSnapshot,
            forceSeparateLine:Boolean(item.configurationSnapshot)||item.unitPriceCents!==undefined
          });
        }
        saleId=sale.id;
      }

      db.prepare(`INSERT INTO fast_food_orders(id,sale_id,order_date,daily_number,status,note,created_at,updated_at)
        VALUES(?,?,?,?,'NEW',?,?,?)`).run(id,saleId,day,number,String(input.note||'').trim()||null,ts,ts);

      if(saleId&&items.length&&sales&&kitchen?.routeProduction){
        const sale=sales.getSale(saleId);
        kitchen.routeProduction({sourceType:'FAST_FOOD',sourceId:id,items:sale.items,note:String(input.note||'').trim()});
      }

      writeAudit(db,{action:'fast-food.create',entity:'fast_food_order',entityId:id,actor,context:{dailyNumber:number,saleId}},now);
      return get(id);
    });
  }

  function updateStatus(id,status,actor={}){
    gate();
    const order=get(id);
    const next=String(status||'').toUpperCase();
    if(!(TRANSITIONS[order.status]||[]).includes(next))throw new Error(`Transicao de fast-food invalida: ${order.status} -> ${next}.`);
    db.prepare('UPDATE fast_food_orders SET status=?,updated_at=? WHERE id=?').run(next,now(),order.id);
    writeAudit(db,{action:'fast-food.status',entity:'fast_food_order',entityId:order.id,actor,context:{from:order.status,to:next}},now);
    return get(order.id);
  }

  function readyBoard(){
    gate();
    return db.prepare("SELECT daily_number AS number,status FROM fast_food_orders WHERE status='READY' ORDER BY order_date,daily_number").all();
  }

  function list({status=null}={}){
    gate();
    return status
      ? db.prepare('SELECT * FROM fast_food_orders WHERE status=? ORDER BY order_date DESC,daily_number').all(String(status).toUpperCase()).map(map)
      : db.prepare('SELECT * FROM fast_food_orders ORDER BY order_date DESC,daily_number').all().map(map);
  }

  return{create,get,list,updateStatus,readyBoard};
}

module.exports={createFastFoodService,TRANSITIONS};
