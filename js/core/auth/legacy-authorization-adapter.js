'use strict';

const { PERMISSIONS }=require('./permission-registry');

const idsByPrefix=(...prefixes)=>PERMISSIONS
  .map(permission=>permission.id)
  .filter(id=>prefixes.some(prefix=>id===prefix||id.startsWith(prefix+'.')));

const STAFF_PERMISSION_IDS=Object.freeze(
  PERMISSIONS.map(permission=>permission.id).filter(id=>!id.startsWith('public.'))
);

const LEGACY_ROLE_PERMISSIONS=Object.freeze({
  admin:Object.freeze([...STAFF_PERMISSION_IDS]),
  manager:Object.freeze([
    ...idsByPrefix('sales','returns','cash','customers','products','suppliers','sellers','inventory','restaurant','wholesale','finance','reports','management'),
    'users.view','users.create','users.edit','users.reset_password',
    'devices.view','devices.pair','devices.block','devices.rotate_credential',
    'modules.view','settings.view','settings.manage'
  ].filter((id,index,array)=>array.indexOf(id)===index)),
  cashier:Object.freeze([
    'sales.view','sales.create',
    'returns.view','returns.manage',
    'cash.view','cash.open','cash.close','cash.supply','cash.withdraw',
    'customers.view','customers.manage',
    'products.view'
  ])
});

const DEVICE_TYPE_PERMISSIONS=Object.freeze({
  WAITER:Object.freeze([
    'restaurant.access','restaurant.orders.view','restaurant.orders.create',
    'restaurant.orders.transfer','restaurant.tables.manage'
  ]),
  TABLET:Object.freeze([
    'restaurant.access','restaurant.orders.view','restaurant.orders.create'
  ]),
  KITCHEN:Object.freeze([
    'restaurant.access','kitchen.view','kitchen.update_status'
  ]),
  SELF_SERVICE:Object.freeze([
    'restaurant.access','restaurant.orders.create'
  ])
});

const PUBLIC_RESOURCE_PERMISSIONS=Object.freeze({
  table:Object.freeze(['public.menu.view','public.order.create'])
});

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
      surface:type.toLowerCase().replace(/_/g,'-'),
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
  DEVICE_TYPE_PERMISSIONS,
  PUBLIC_RESOURCE_PERMISSIONS,
  createLegacyPermissionResolver,
  principalFromLegacyActor
};
