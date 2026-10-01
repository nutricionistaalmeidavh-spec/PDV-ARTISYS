'use strict';

const AREAS=Object.freeze({
  FOOD:Object.freeze({id:'FOOD',label:'Alimentação',description:'Salão, produção, pedidos e retirada',icon:'pizza',routeId:'FOOD',navigation:'group'}),
  RETAIL:Object.freeze({id:'RETAIL',label:'Varejo',description:'Produtos e variações de loja',icon:'box',routeId:'RETAIL',navigation:'module'}),
  SERVICES:Object.freeze({id:'SERVICES',label:'Serviços',description:'Agenda, profissionais e comissões',icon:'users',routeId:'SERVICES',navigation:'module'})
});

const MODULES=Object.freeze([
  {id:'RESTAURANT',name:'Restaurante',description:'Mesas, comandas e cozinha',defaultEnabled:true,dependsOn:[],area:AREAS.FOOD,routeId:'RESTAURANT',icon:'store',accessRoles:['admin','manager'],manageRoles:['admin']},
  {id:'PIZZERIA',name:'Pizzaria',description:'Tamanhos, sabores, bordas e preços',defaultEnabled:false,dependsOn:[],area:AREAS.FOOD,routeId:'PIZZERIA',icon:'pizza',accessRoles:['admin','manager'],manageRoles:['admin']},
  {id:'DELIVERY',name:'Delivery',description:'Entregas, retiradas e pedidos',defaultEnabled:false,dependsOn:[],area:AREAS.FOOD,routeId:'DELIVERY',icon:'cart',accessRoles:['admin','manager'],manageRoles:['admin']},
  {id:'FAST_FOOD',name:'Fast-food / Lanchonete',description:'Senhas, fila e retirada',defaultEnabled:false,dependsOn:[],area:AREAS.FOOD,routeId:'FAST_FOOD',icon:'cash',accessRoles:['admin','manager'],manageRoles:['admin']},
  {id:'MARKET_BAKERY',name:'Mercado / Conveniência / Padaria',description:'Venda por peso, balança e encomendas',defaultEnabled:false,dependsOn:[],area:AREAS.FOOD,routeId:'MARKET_BAKERY',icon:'store',accessRoles:['admin','manager'],manageRoles:['admin']},
  {id:'RETAIL',name:'Varejo',description:'Variantes de cor e tamanho',defaultEnabled:false,dependsOn:[],area:AREAS.RETAIL,routeId:'RETAIL',icon:'box',accessRoles:['admin','manager'],manageRoles:['admin']},
  {id:'SERVICES',name:'Serviços',description:'Agenda, profissionais e comissão',defaultEnabled:false,dependsOn:[],area:AREAS.SERVICES,routeId:'SERVICES',icon:'users',accessRoles:['admin','manager'],manageRoles:['admin']},
  {id:'SELF_SERVICE',name:'Autoatendimento',description:'Pedidos iniciados em tablet ou totem',defaultEnabled:false,dependsOn:[],area:AREAS.FOOD,routeId:'SELF_SERVICE',icon:'terminal',accessRoles:['admin','manager'],manageRoles:['admin']}
].map(module=>Object.freeze({...module,dependsOn:Object.freeze([...module.dependsOn]),accessRoles:Object.freeze([...module.accessRoles]),manageRoles:Object.freeze([...module.manageRoles])})));

const BY_ID=new Map(MODULES.map(item=>[item.id,item]));
function getModuleDefinition(id){return BY_ID.get(String(id||'').trim().toUpperCase())||null;}
function getAreaDefinition(id){return Object.values(AREAS).find(area=>area.id===String(id||'').trim().toUpperCase())||null;}

module.exports={AREAS,MODULES,getAreaDefinition,getModuleDefinition};
