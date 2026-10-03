'use strict';

const {DEFAULT_PROFILE_PERMISSIONS}=require('./default-profiles');

const LEGACY_ROLE_PERMISSIONS=Object.freeze({
  admin:DEFAULT_PROFILE_PERMISSIONS.ADMINISTRATOR,
  manager:DEFAULT_PROFILE_PERMISSIONS.MANAGER,
  cashier:DEFAULT_PROFILE_PERMISSIONS.OPERATOR
});

const DEVICE_SURFACE_PERMISSIONS=Object.freeze({
  waiter:Object.freeze([
    'restaurant.access','restaurant.orders.view','restaurant.orders.create',
    'restaurant.orders.transfer','restaurant.tables.manage'
  ]),
  table:Object.freeze([
    'restaurant.access','restaurant.orders.view','restaurant.orders.create'
  ]),
  kitchen:Object.freeze([
    'restaurant.access','kitchen.view','kitchen.update_status'
  ]),
  'self-service':Object.freeze([
    'restaurant.access','restaurant.orders.create'
  ]),
  terminal:Object.freeze([])
});

const DEVICE_TYPE_PERMISSIONS=Object.freeze({
  WAITER:DEVICE_SURFACE_PERMISSIONS.waiter,
  TABLET:DEVICE_SURFACE_PERMISSIONS.table,
  KITCHEN:DEVICE_SURFACE_PERMISSIONS.kitchen,
  SELF_SERVICE:DEVICE_SURFACE_PERMISSIONS['self-service'],
  TERMINAL:DEVICE_SURFACE_PERMISSIONS.terminal
});

const PUBLIC_RESOURCE_PERMISSIONS=Object.freeze({
  table:Object.freeze(['public.menu.view','public.order.create'])
});

function surfaceFromDeviceType(type){
  const normalized=String(type||'').trim().toUpperCase().replace(/-/g,'_');
  if(normalized==='WAITER')return'waiter';
  if(normalized==='TABLET')return'table';
  if(normalized==='KITCHEN')return'kitchen';
  if(normalized==='SELF_SERVICE')return'self-service';
  if(normalized==='TERMINAL')return'terminal';
  return normalized.toLowerCase().replace(/_/g,'-');
}

function principalFromLegacyActor(actor={},context={}){
  const role=String(actor?.role||'').trim().toLowerCase();
  if(role==='system')return {kind:'system',id:'system'};

  if(role==='terminal'){
    const id=String(actor?.terminalId||context?.terminalId||'').trim();
    return id?{kind:'device',id,surface:'terminal',userId:actor?.userId?String(actor.userId):null,legacyDeviceType:'TERMINAL'}:null;
  }

  if(role.startsWith('mobile-')){
    const device=context?.device||null;
    const id=String(device?.id||context?.deviceId||'').trim();
    const type=String(device?.deviceType||role.slice('mobile-'.length)||'').trim().toUpperCase().replace(/-/g,'_');
    if(!id||!type)return null;
    return {
      kind:'device',
      id,
      surface:String(device?.surface||surfaceFromDeviceType(type)),
      userId:device?.userId?String(device.userId):(actor?.userId?String(actor.userId):null),
      legacyDeviceType:type
    };
  }

  const userId=String(actor?.userId||'').trim();
  if(userId&&LEGACY_ROLE_PERMISSIONS[role])return {kind:'human',id:userId,legacyRole:role};
  return null;
}

function createLegacyPermissionResolver(){
  return function resolveLegacyPermissions(principal){
    if(!principal||typeof principal!=='object')return [];

    if(principal.kind==='human'){
      return LEGACY_ROLE_PERMISSIONS[String(principal.legacyRole||'').toLowerCase()]||[];
    }

    if(principal.kind==='device'){
      const surface=String(principal.surface||'').toLowerCase();
      if(DEVICE_SURFACE_PERMISSIONS[surface])return DEVICE_SURFACE_PERMISSIONS[surface];
      return DEVICE_TYPE_PERMISSIONS[String(principal.legacyDeviceType||'').toUpperCase()]||[];
    }

    if(principal.kind==='public-resource'){
      return PUBLIC_RESOURCE_PERMISSIONS[String(principal.resourceType||'').toLowerCase()]||[];
    }

    return [];
  };
}

module.exports={
  LEGACY_ROLE_PERMISSIONS,
  DEVICE_SURFACE_PERMISSIONS,
  DEVICE_TYPE_PERMISSIONS,
  PUBLIC_RESOURCE_PERMISSIONS,
  createLegacyPermissionResolver,
  principalFromLegacyActor,
  surfaceFromDeviceType
};
