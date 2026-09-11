'use strict';

const {writeAudit}=require('../../core/audit-log');

function createSelfService({db,modules,catalog,catalogCustomization,mobileDevices,restaurant,fastFood,now=()=>new Date().toISOString()}={}){
  if(!db||!modules||!catalog||!mobileDevices||!restaurant||!fastFood)throw new TypeError('self-service dependencies are required.');
  const gate=()=>modules.requireEnabled('SELF_SERVICE');

  function profile(deviceId){
    gate();const row=db.prepare('SELECT * FROM self_service_profiles WHERE device_id=?').get(String(deviceId));if(!row)throw new Error('Perfil de autoatendimento nao configurado.');
    return{deviceId:row.device_id,mode:row.mode,tableId:row.table_id,operatorId:row.operator_id,createdAt:row.created_at,updatedAt:row.updated_at};
  }
  function configureDevice(deviceId,input={},actor={}){
    gate();const device=mobileDevices.getDevice(deviceId);if(!device||device.deviceType!=='SELF_SERVICE')throw new Error('Dispositivo nao e de autoatendimento.');const mode=String(input.mode||'').toUpperCase();if(!['TABLE','PICKUP'].includes(mode))throw new Error('Modo de autoatendimento invalido.');let tableId=null;let operatorId=null;
    if(mode==='TABLE'){
      modules.requireEnabled('RESTAURANT');tableId=String(input.tableId||'').trim();if(!tableId||!restaurant.getTable(tableId))throw new Error('Mesa valida obrigatoria para autoatendimento em mesa.');
    }else{
      modules.requireEnabled('FAST_FOOD');operatorId=String(input.operatorId||actor?.userId||'').trim();const user=operatorId?db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(operatorId):null;if(!user)throw new Error('Operador local obrigatorio para autoatendimento de retirada.');
    }
    const ts=now();db.prepare(`INSERT INTO self_service_profiles(device_id,mode,table_id,operator_id,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET mode=excluded.mode,table_id=excluded.table_id,operator_id=excluded.operator_id,updated_at=excluded.updated_at`).run(device.id,mode,tableId,operatorId,ts,ts);
    writeAudit(db,{action:'self-service.configure',entity:'mobile_device',entityId:device.id,actor,context:{mode,tableId,operatorId}},now);return profile(device.id);
  }
  function productView(product){
    let configuration=null;if(catalogCustomization){try{configuration=catalogCustomization.getProductConfiguration(product.id);}catch{configuration=null;}}
    return{id:product.id,name:product.name,categoryId:product.categoryId,categoryName:product.categoryName,salePriceCents:product.salePriceCents,unit:product.unit,configuration};
  }
  function context(deviceId){
    gate();const device=mobileDevices.getDevice(deviceId);if(!device||device.deviceType!=='SELF_SERVICE'||device.status!=='ACTIVE')throw new Error('Dispositivo de autoatendimento indisponivel.');const p=profile(device.id);const products=catalog.listProducts().map(productView);let table=null;let session=null;
    if(p.mode==='TABLE'){modules.requireEnabled('RESTAURANT');table=restaurant.getTable(p.tableId);session=table?restaurant.currentSession(table.id):null;}else modules.requireEnabled('FAST_FOOD');
    return{device,profile:p,table,session,products,paymentMode:'MANUAL_AT_COUNTER'};
  }
  function submitOrder(deviceId,input={},actor={},mutationId=null){
    gate();const state=context(deviceId);const items=Array.isArray(input.items)?input.items:[];if(!items.length)throw new Error('Adicione itens ao pedido.');const normalized=items.map(item=>({productId:item.productId,quantity:item.quantity??1,unitPriceCents:item.unitPriceCents,configurationSnapshot:item.configurationSnapshot,note:item.note||''}));
    if(state.profile.mode==='TABLE'){
      if(!state.session)throw new Error('Mesa sem comanda aberta.');
      return restaurant.addOrder(state.session.id,{items:normalized,note:String(input.note||'').trim(),source:'TABLET',deviceId:state.device.id,actor,mutationId});
    }
    return fastFood.create({terminalId:'SELF-SERVICE',operatorId:state.profile.operatorId,items:normalized,note:String(input.note||'').trim()},actor);
  }
  return{configureDevice,getProfile:profile,context,submitOrder};
}

module.exports={createSelfService};
