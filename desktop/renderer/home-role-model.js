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
    settings:Object.freeze({key:'settings',label:'Configurações',description:'Empresa, acessos, áreas e dispositivos',route:'settings',tone:'sky',icon:'modules'})
  });

  const TOP_LEVEL=Object.freeze(['checkout','cash','post-sale','catalog','financial-management','settings']);

  function profileLabel(user){
    return String(user?.profile?.name||user?.profileName||'Operação');
  }

  function homeForUser(user,baseTiles=[]){
    const tiles=new Map(baseTiles.map(tile=>[tile.route,tile]));
    Object.entries(HUB_TILES).forEach(([key,tile])=>tiles.set(key,tile));
    const routes=TOP_LEVEL.filter(route=>policy?.canAccessRoute?.(user,route));
    return{
      profileId:user?.profile?.id||user?.profileId||null,
      label:profileLabel(user),
      title:'Início',
      subtitle:'Acesso rápido às áreas liberadas para este perfil.',
      sections:[{
        key:'authorized-main',
        label:'',
        tiles:routes.map(route=>tiles.get(route)).filter(Boolean)
      }]
    };
  }

  return Object.freeze({HUB_TILES,TOP_LEVEL,homeForUser});
});
