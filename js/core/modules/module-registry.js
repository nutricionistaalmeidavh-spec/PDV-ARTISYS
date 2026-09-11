'use strict';

const MODULES=Object.freeze([
  {id:'RESTAURANT',name:'Restaurante',description:'Mesas, comandas e cozinha',dependsOn:[],defaultEnabled:true},
  {id:'PIZZERIA',name:'Pizzaria',description:'Tamanhos, sabores e bordas',dependsOn:[],defaultEnabled:false},
  {id:'DELIVERY',name:'Delivery',description:'Entrega e retirada local',dependsOn:[],defaultEnabled:false},
  {id:'FAST_FOOD',name:'Fast-food/Lanchonete',description:'Senha, fila e retirada',dependsOn:[],defaultEnabled:false},
  {id:'MARKET_BAKERY',name:'Mercado/Conveniência/Padaria',description:'Peso, balança e encomendas',dependsOn:[],defaultEnabled:false},
  {id:'RETAIL',name:'Varejo',description:'Variantes de cor e tamanho',dependsOn:[],defaultEnabled:false},
  {id:'SERVICES',name:'Serviços',description:'Agenda, profissionais e comissão',dependsOn:[],defaultEnabled:false},
  {id:'WORKSHOP',name:'Oficina',description:'Ordens de serviço, peças e mão de obra',dependsOn:['SERVICES'],defaultEnabled:false},
  {id:'SELF_SERVICE',name:'Autoatendimento',description:'Pedido local em tablet/totem',dependsOn:[],defaultEnabled:false}
]);
const BY_ID=new Map(MODULES.map(item=>[item.id,item]));
function getModuleDefinition(id){return BY_ID.get(String(id||'').trim().toUpperCase())||null;}
module.exports={MODULES,getModuleDefinition};
