'use strict';

((root,factory)=>{
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  if(root)root.PdvAccessPolicy=model;
})(typeof window!=='undefined'?window:null,()=>{
  const ROUTE_CAPABILITIES=Object.freeze({
    home:Object.freeze([]),
    checkout:Object.freeze(['sales.create']),
    cash:Object.freeze(['cash.view']),
    sales:Object.freeze(['sales.view']),
    returns:Object.freeze(['returns.view']),
    customers:Object.freeze(['customers.view']),
    products:Object.freeze(['products.view']),
    inventory:Object.freeze(['inventory.view']),
    finance:Object.freeze(['finance.view']),
    'finance-banks':Object.freeze(['finance.view']),
    'finance-recurrences':Object.freeze(['finance.view']),
    'finance-alerts':Object.freeze(['finance.view']),
    reports:Object.freeze(['reports.view']),
    management:Object.freeze(['management.view']),
    sellers:Object.freeze(['sellers.view']),
    settings:Object.freeze(['settings.view']),
    access:Object.freeze(['users.view','profiles.view','devices.view','security.view']),
    catalog:Object.freeze(['customers.view','products.view','inventory.view','sellers.view']),
    'post-sale':Object.freeze(['sales.view','returns.view']),
    'financial-management':Object.freeze(['finance.view','reports.view','management.view']),
    FOOD:Object.freeze(['restaurant.access']),
    WHOLESALE:Object.freeze(['wholesale.access'])
  });

  const TOP_LEVEL_ROUTES=Object.freeze([
    'home','checkout','cash','post-sale','catalog','financial-management','access','settings'
  ]);

  function permissionsOf(user){
    const source=Array.isArray(user?.permissions)?user.permissions:
      Array.isArray(user?.profile?.permissions)?user.profile.permissions:[];
    return new Set(source.map(value=>String(value||'').trim().toLowerCase()).filter(Boolean));
  }

  function hasCapability(user,capability){
    return permissionsOf(user).has(String(capability||'').trim().toLowerCase());
  }

  function canAccessRoute(user,route){
    if(!user)return false;
    const required=ROUTE_CAPABILITIES[String(route||'').trim()];
    if(!required)return false;
    if(required.length===0)return true;
    const permissions=permissionsOf(user);
    return required.some(capability=>permissions.has(capability));
  }

  function routesForUser(user){return TOP_LEVEL_ROUTES.filter(route=>canAccessRoute(user,route));}

  return Object.freeze({ROUTE_CAPABILITIES,TOP_LEVEL_ROUTES,permissionsOf,hasCapability,canAccessRoute,routesForUser});
});
