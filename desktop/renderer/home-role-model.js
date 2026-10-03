'use strict';

((root,factory)=>{
  const policy=root?.PdvAccessPolicy||(typeof require==='function'?require('./access-policy'):null);
  const model=factory(policy);
  if(typeof module==='object'&&module.exports)module.exports=model;
  if(root)root.PdvHomeRoleModel=model;
})(typeof window!=='undefined'?window:null,(policy)=>{
  const HUB_TILES=Object.freeze({
    catalog:Object.freeze({key:'catalog',label:'Cadastros',description:'Clientes, produtos, estoque e equipe',route:'catalog',tone:'purple',icon:'document'}),
    'post-sale':Object.freeze({key:'post-sale',label:'Vendas e devoluções',description:'Histórico, comprovantes e devoluções',route:'post-sale',tone:'slate',icon:'history'}),
    'financial-management':Object.freeze({key:'financial-management',label:'Gestão financeira',description:'DRE, relatórios e financeiro',route:'financial-management',tone:'rose',icon:'management'}),
    access:Object.freeze({key:'access',label:'Acessos e equipe',description:'Pessoas, perfis, dispositivos e segurança',route:'access',tone:'amber',icon:'users'}),
    settings:Object.freeze({key:'settings',label:'Configurações',description:'Empresa, áreas e preferências operacionais',route:'settings',tone:'sky',icon:'settings'})
  });

  const TOP_LEVEL=Object.freeze(['checkout','cash','post-sale','catalog','financial-management','access','settings']);

  function profileLabel(user){return String(user?.profile?.name||user?.profileName||'Operação');}

  function homeForUser(user,baseTiles=[]){
    const tiles=new Map(baseTiles.map(tile=>[tile.route,tile]));
    Object.values(HUB_TILES).forEach(tile=>tiles.set(tile.route,tile));
    const routes=TOP_LEVEL.filter(route=>policy?.canAccessRoute?.(user,route));
    return{
      profileId:user?.profile?.id||user?.profileId||null,
      label:profileLabel(user),
      title:'Início',
      subtitle:'Acesso rápido às áreas liberadas para este perfil.',
      sections:[{key:'authorized-main',label:'',tiles:routes.map(route=>tiles.get(route)).filter(Boolean)}]
    };
  }

  // Compatibilidade visual temporária para testes antigos; não é usada como boundary de autorização.
  const LEGACY_USERS=Object.freeze({
    cashier:Object.freeze({profileName:'Operador',permissions:Object.freeze(['sales.create','sales.view','returns.view','cash.view','products.view','customers.view'])}),
    manager:Object.freeze({profileName:'Gerente',permissions:Object.freeze(['sales.create','sales.view','returns.view','cash.view','products.view','customers.view','inventory.view','finance.view','reports.view','management.view','sellers.view'])}),
    admin:Object.freeze({profileName:'Administrador',permissions:Object.freeze(['sales.create','sales.view','returns.view','cash.view','products.view','customers.view','inventory.view','finance.view','reports.view','management.view','sellers.view','settings.view'])})
  });
  function legacyUser(role){return LEGACY_USERS[role]||LEGACY_USERS.cashier;}
  function canAccessRoute(role,route){return Boolean(policy?.canAccessRoute?.(legacyUser(role),route));}
  function routesForRole(role){return ['home','checkout','cash','post-sale','catalog','financial-management'].filter(route=>canAccessRoute(role,route));}
  function homeForRole(role,baseTiles=[]){
    const normalized=Object.hasOwn(LEGACY_USERS,role)?role:'cashier';
    const view=homeForUser(legacyUser(normalized),baseTiles);
    return{...view,role:normalized,label:legacyUser(normalized).profileName};
  }

  return Object.freeze({HUB_TILES,TOP_LEVEL,homeForUser,canAccessRoute,routesForRole,homeForRole});
});
