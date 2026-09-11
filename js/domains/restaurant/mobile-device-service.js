'use strict';

const { randomBytes, randomUUID, scryptSync, timingSafeEqual } = require('node:crypto');
const { writeAudit } = require('../../core/audit-log');

const DEVICE_TYPES = new Set(['WAITER','TABLET','KITCHEN','SELF_SERVICE']);
const DEVICE_STATUSES = new Set(['ACTIVE','BLOCKED']);

function hashSecret(secret,salt){return scryptSync(String(secret),String(salt),32).toString('hex');}
function safeEqualHex(left,right){try{const a=Buffer.from(String(left),'hex');const b=Buffer.from(String(right),'hex');return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}}

function createMobileDeviceService({db,now=()=>new Date().toISOString(),idFactory=prefix=>`${prefix}-${randomUUID()}`,secretFactory=()=>randomBytes(32).toString('base64url')}={}){
  if(!db)throw new TypeError('Database is required.');

  function isSelfService(id){try{return Boolean(db.prepare('SELECT 1 FROM self_service_profiles WHERE device_id=?').get(String(id)));}catch{return false;}}
  function mapDevice(row){
    if(!row)return null;
    const deviceType=row.device_type==='KITCHEN'&&isSelfService(row.id)?'SELF_SERVICE':row.device_type;
    return {id:row.id,name:row.name,deviceType,tableId:row.table_id,userId:row.user_id,status:row.status,lastSeenAt:row.last_seen_at,createdBy:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at};
  }

  function getDevice(id){return mapDevice(db.prepare('SELECT * FROM mobile_devices WHERE id=?').get(String(id)));}
  function requireDevice(id){const row=db.prepare('SELECT * FROM mobile_devices WHERE id=?').get(String(id));if(!row)throw new Error('Dispositivo nao encontrado.');return row;}

  function validateBinding(type,tableId,userId){
    if(type==='TABLET'){
      if(!tableId)throw new Error('Tablet deve estar vinculado a uma mesa.');
      const table=db.prepare('SELECT id FROM restaurant_tables WHERE id=? AND active=1').get(String(tableId));
      if(!table)throw new Error('Mesa nao encontrada ou inativa.');
    }
    if(type==='WAITER'&&userId){
      const user=db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(String(userId));
      if(!user)throw new Error('Usuario do garcom nao encontrado ou inativo.');
    }
  }

  function createDevice(input={},actor={}){
    const name=String(input.name||'').trim();if(!name)throw new Error('Nome do dispositivo obrigatorio.');
    const requestedType=String(input.deviceType||'').trim().toUpperCase();if(!DEVICE_TYPES.has(requestedType))throw new Error('Tipo de dispositivo invalido.');
    const tableId=input.tableId?String(input.tableId):null;const userId=input.userId?String(input.userId):null;
    validateBinding(requestedType,tableId,userId);
    const id=String(input.id||idFactory('mobile')).trim();const credential=String(secretFactory());const salt=randomBytes(16).toString('hex');const timestamp=now();
    const storedType=requestedType==='SELF_SERVICE'?'KITCHEN':requestedType;
    db.prepare(`INSERT INTO mobile_devices(id,name,device_type,table_id,user_id,credential_hash,credential_salt,status,last_seen_at,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,'ACTIVE',NULL,?,?,?)`).run(id,name,storedType,tableId,userId,hashSecret(credential,salt),salt,actor?.userId||null,timestamp,timestamp);
    if(requestedType==='SELF_SERVICE'){
      db.prepare(`INSERT INTO self_service_profiles(device_id,mode,table_id,operator_id,created_at,updated_at) VALUES(?,'PICKUP',NULL,NULL,?,?)`).run(id,timestamp,timestamp);
    }
    writeAudit(db,{action:'restaurant.mobile.create',entity:'mobile_device',entityId:id,actor,context:{name,deviceType:requestedType,tableId,userId}},now);
    return {...getDevice(id),credential};
  }

  function listDevices({deviceType=null,status=null}={}){
    const clauses=[];const params=[];
    if(deviceType){
      const type=String(deviceType).toUpperCase();if(!DEVICE_TYPES.has(type))throw new Error('Tipo de dispositivo invalido.');
      if(type==='SELF_SERVICE')clauses.push('EXISTS (SELECT 1 FROM self_service_profiles ssp WHERE ssp.device_id=mobile_devices.id)');
      else if(type==='KITCHEN')clauses.push("device_type='KITCHEN' AND NOT EXISTS (SELECT 1 FROM self_service_profiles ssp WHERE ssp.device_id=mobile_devices.id)");
      else{clauses.push('device_type=?');params.push(type);}
    }
    if(status){const value=String(status).toUpperCase();if(!DEVICE_STATUSES.has(value))throw new Error('Status de dispositivo invalido.');clauses.push('status=?');params.push(value);}
    return db.prepare(`SELECT * FROM mobile_devices${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY name,id`).all(...params).map(mapDevice);
  }

  function authenticate(deviceId,credential){
    const row=db.prepare('SELECT * FROM mobile_devices WHERE id=?').get(String(deviceId||''));
    if(!row||row.status!=='ACTIVE'||!credential)return{ok:false,reason:row?.status==='BLOCKED'?'blocked':'invalid'};
    const candidate=hashSecret(credential,row.credential_salt);if(!safeEqualHex(candidate,row.credential_hash))return{ok:false,reason:'invalid'};
    const timestamp=now();db.prepare('UPDATE mobile_devices SET last_seen_at=?,updated_at=? WHERE id=?').run(timestamp,timestamp,row.id);
    return{ok:true,device:mapDevice({...row,last_seen_at:timestamp,updated_at:timestamp})};
  }

  function setStatus(deviceId,status,actor={}){
    const normalized=String(status||'').toUpperCase();if(!DEVICE_STATUSES.has(normalized))throw new Error('Status de dispositivo invalido.');
    const row=requireDevice(deviceId);db.prepare('UPDATE mobile_devices SET status=?,updated_at=? WHERE id=?').run(normalized,now(),row.id);
    writeAudit(db,{action:'restaurant.mobile.status',entity:'mobile_device',entityId:row.id,actor,context:{from:row.status,to:normalized}},now);
    return getDevice(row.id);
  }

  function rotateCredential(deviceId,actor={}){
    const row=requireDevice(deviceId);const credential=String(secretFactory());const salt=randomBytes(16).toString('hex');const timestamp=now();
    db.prepare("UPDATE mobile_devices SET credential_hash=?,credential_salt=?,status='ACTIVE',updated_at=? WHERE id=?").run(hashSecret(credential,salt),salt,timestamp,row.id);
    writeAudit(db,{action:'restaurant.mobile.rotate',entity:'mobile_device',entityId:row.id,actor,context:{}},now);
    return{...getDevice(row.id),credential};
  }

  return{createDevice,listDevices,getDevice,authenticate,setStatus,rotateCredential,DEVICE_TYPES,DEVICE_STATUSES};
}

module.exports={createMobileDeviceService};
