'use strict';

const {PERMISSIONS}=require('./permission-registry');

const idsByPrefix=(...prefixes)=>PERMISSIONS
  .map(permission=>permission.id)
  .filter(id=>prefixes.some(prefix=>id===prefix||id.startsWith(prefix+'.')));

const STAFF_PERMISSION_IDS=Object.freeze(
  PERMISSIONS.map(permission=>permission.id).filter(id=>!id.startsWith('public.'))
);

const DEFAULT_PROFILE_IDS=Object.freeze({
  ADMINISTRATOR:'profile-administrator',
  MANAGER:'profile-manager',
  OPERATOR:'profile-operator'
});

const DEFAULT_PROFILE_PERMISSIONS=Object.freeze({
  ADMINISTRATOR:Object.freeze([...STAFF_PERMISSION_IDS]),
  MANAGER:Object.freeze([
    ...idsByPrefix('sales','returns','cash','customers','products','suppliers','sellers','inventory','restaurant','wholesale','finance','reports','management'),
    'users.view','users.create','users.edit','users.reset_password',
    'devices.view','devices.pair','devices.block','devices.rotate_credential',
    'modules.view','settings.view','settings.manage'
  ].filter((id,index,array)=>array.indexOf(id)===index).sort()),
  OPERATOR:Object.freeze([
    'sales.view','sales.create',
    'returns.view',
    'cash.view','cash.open','cash.close','cash.supply','cash.withdraw',
    'customers.view','customers.manage',
    'products.view'
  ].sort())
});

const DEFAULT_PROFILES=Object.freeze([
  Object.freeze({
    id:DEFAULT_PROFILE_IDS.ADMINISTRATOR,
    name:'Administrador',
    slug:'administrador',
    systemKey:'admin',
    legacyRole:'admin',
    protected:true,
    permissions:DEFAULT_PROFILE_PERMISSIONS.ADMINISTRATOR
  }),
  Object.freeze({
    id:DEFAULT_PROFILE_IDS.MANAGER,
    name:'Gerente',
    slug:'gerente',
    systemKey:'manager',
    legacyRole:'manager',
    protected:false,
    permissions:DEFAULT_PROFILE_PERMISSIONS.MANAGER
  }),
  Object.freeze({
    id:DEFAULT_PROFILE_IDS.OPERATOR,
    name:'Operador',
    slug:'operador',
    systemKey:'operator',
    legacyRole:'cashier',
    protected:false,
    permissions:DEFAULT_PROFILE_PERMISSIONS.OPERATOR
  })
]);

function defaultProfileForLegacyRole(role){
  const normalized=String(role||'').trim().toLowerCase();
  return DEFAULT_PROFILES.find(profile=>profile.legacyRole===normalized)||null;
}

module.exports={
  STAFF_PERMISSION_IDS,
  DEFAULT_PROFILE_IDS,
  DEFAULT_PROFILE_PERMISSIONS,
  DEFAULT_PROFILES,
  defaultProfileForLegacyRole
};
