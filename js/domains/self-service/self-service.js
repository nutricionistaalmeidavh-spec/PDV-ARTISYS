'use strict';

const {withTransaction}=require('../../core/database/sqlite-database');
const {writeAudit}=require('../../core/audit-log');

function createSelfService({db,modules,mobileDevices,restaurant,fastFood,publicOrdering,now=()=>new Date().toISOString()}={}){
  if(!db||!modules||!mobileDevices||!restaurant||!fastFood||!publicOrdering)throw new TypeError('self-service dependencies are required.');
  const gate=()=>modules.requireEnabled('FOOD');

  function profile(deviceId){
    gate();
    const row=db.prepare('SELECT * FROM self_service_profiles WHERE device_id=?').get(String(deviceId));
    if(!row)throw new Error('Perfil de autoatendimento nao configurado.');
    return{deviceId:row.device_id,mode:row.mode,tableId:row.table_id,operatorId:row.operator_id,createdAt:row.created_at,updatedAt:row.updated_at};
  }

  function configureDevice(deviceId,input={},actor={}){
    gate();
    const device=mobileDevices.getDevice(deviceId);
    if(!device||device.deviceType!=='SELF_SERVICE')throw new Error('Dispositivo nao e de autoatendimento.');
    const mode=String(input.mode||'').toUpperCase();
    if(!['TABLE','PICKUP'].includes(mode))throw new Error('Modo de autoatendimento invalido.');
    let tableId=null;
    let operatorId=null;
    if(mode==='TABLE'){
      tableId=String(input.tableId||'').trim();
      const table=tableId?restaurant.getTable(tableId):null;
      if(!table||table.active===false)throw new Error('Mesa valida obrigatoria para autoatendimento em mesa.');
    }else{
      operatorId=String(input.operatorId||actor?.userId||'').trim();
      const user=operatorId?db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(operatorId):null;
      if(!user)throw new Error('Operador local obrigatorio para autoatendimento de retirada.');
    }
    const ts=now();
    db.prepare(`INSERT INTO self_service_profiles(device_id,mode,table_id,operator_id,created_at,updated_at)
      VALUES(?,?,?,?,?,?)
      ON CONFLICT(device_id) DO UPDATE SET mode=excluded.mode,table_id=excluded.table_id,operator_id=excluded.operator_id,updated_at=excluded.updated_at`)
      .run(device.id,mode,tableId,operatorId,ts,ts);
    writeAudit(db,{action:'self-service.configure',entity:'mobile_device',entityId:device.id,actor,context:{mode,tableId,operatorId}},now);
    return profile(device.id);
  }

  function createConfiguredDevice(input={},actor={}){
    gate();
    return withTransaction(db,()=>{
      const device=mobileDevices.createDevice({id:input.id,name:input.name,deviceType:'SELF_SERVICE'},actor);
      const configured=configureDevice(device.id,{mode:input.mode,tableId:input.tableId,operatorId:input.operatorId},actor);
      return{device,profile:configured};
    });
  }

  function listConfiguredDevices(){
    gate();
    return db.prepare(`SELECT md.id,md.name,md.status,md.last_seen_at,ssp.mode,ssp.table_id,ssp.operator_id,
      rt.label AS table_label,u.name AS operator_name
      FROM mobile_devices md
      JOIN self_service_profiles ssp ON ssp.device_id=md.id
      LEFT JOIN restaurant_tables rt ON rt.id=ssp.table_id
      LEFT JOIN users u ON u.id=ssp.operator_id
      WHERE md.device_type='SELF_SERVICE'
      ORDER BY md.name,md.id`).all().map(row=>({
        id:row.id,name:row.name,deviceType:'SELF_SERVICE',status:row.status,lastSeenAt:row.last_seen_at,mode:row.mode,
        locationLabel:row.mode==='TABLE'?(row.table_label||'Mesa fixa'):'Retirada no balcão',
        tableId:row.table_id||null,tableLabel:row.table_label||null,operatorId:row.operator_id||null,operatorName:row.operator_name||null
      }));
  }

  function context(deviceId){
    gate();
    const device=mobileDevices.getDevice(deviceId);
    if(!device||device.deviceType!=='SELF_SERVICE'||device.status!=='ACTIVE')throw new Error('Dispositivo de autoatendimento indisponivel.');
    const currentProfile=profile(device.id);
    const products=publicOrdering.listMenu();
    const categories=[...new Set(products.map(product=>product.categoryName).filter(Boolean))];
    const publicConfig=publicOrdering.getConfig();
    let table=null;
    let session=null;
    if(currentProfile.mode==='TABLE'){
      table=restaurant.getTable(currentProfile.tableId);
      session=table?restaurant.currentSession(table.id):null;
    }
    return{
      device,
      profile:currentProfile,
      table,
      session,
      products,
      categories,
      config:{menuLayout:publicConfig.menuLayout},
      paymentMode:currentProfile.mode==='PICKUP'?'MANUAL_AT_COUNTER':null
    };
  }

  function requestService(deviceId,requestType,actor={},mutationId=null){
    gate();
    const state=context(deviceId);
    if(state.profile.mode!=='TABLE')throw new Error('Solicitacao de atendimento disponivel apenas no autoatendimento de mesa.');
    const type=String(requestType||'').toUpperCase();
    if(!['WAITER','BILL'].includes(type))throw new Error('Tipo de solicitacao invalido.');
    return restaurant.requestService(state.profile.tableId,type,{deviceId:state.device.id,actor,mutationId});
  }

  function submitOrder(deviceId,input={},actor={},mutationId=null){
    gate();
    const state=context(deviceId);
    const items=Array.isArray(input.items)?input.items:[];
    if(!items.length)throw new Error('Adicione itens ao pedido.');
    const normalized=items.map(item=>publicOrdering.priceMenuItem(item));
    if(state.profile.mode==='TABLE'){
      if(!state.session)throw new Error('Mesa sem comanda aberta.');
      return restaurant.addOrder(state.session.id,{items:normalized,note:String(input.note||'').trim(),source:'TABLE',deviceId:state.device.id,actor,mutationId});
    }
    return fastFood.create({terminalId:'SELF-SERVICE',operatorId:state.profile.operatorId,items:normalized,note:String(input.note||'').trim()},actor);
  }

  function requestService(deviceId,requestType,actor={},mutationId=null){
    gate();
    const state=context(deviceId);
    if(state.profile.mode!=='TABLE')throw new Error('Solicitacao de atendimento disponivel apenas no autoatendimento em mesa.');
    const type=String(requestType||'').toUpperCase();
    if(!['WAITER','BILL'].includes(type))throw new Error('Tipo de solicitacao invalido.');
    return restaurant.requestService(state.profile.tableId,type,{deviceId:state.device.id,actor,mutationId});
  }

  return{createConfiguredDevice,configureDevice,getProfile:profile,listConfiguredDevices,context,submitOrder,requestService};
}

module.exports={createSelfService};
