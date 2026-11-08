'use strict';

((root,factory)=>{
  const model=factory();
  if(typeof module==='object'&&module.exports)module.exports=model;
  if(root)root.PdvFirstUseModel=model;
})(typeof window!=='undefined'?window:null,()=>{
  const TUTORIAL=Object.freeze([
    {route:'home',title:'Seu ponto de partida',description:'No Início, veja os atalhos das tarefas que seu perfil pode executar.'},
    {route:'catalog',title:'Clientes, produtos e estoque',description:'Use Cadastros para preparar o catálogo e consultar os saldos.'},
    {route:'checkout',title:'Venda pelo Balcão',description:'Busque produtos, confira o carrinho e finalize somente uma venda real. O tour não cria transações.'},
    {route:'cash',title:'Controle de caixa',description:'Abra, acompanhe ou feche uma sessão de caixa conforme as permissões do seu usuário.'},
    {route:'settings',title:'Configurações da loja',description:'Configure impressoras, meios de pagamento, áreas e os demais detalhes operacionais.'},
    {route:'FOOD',title:'Mesas, pedidos e produção',description:'Na área Alimentação, acompanhe comandas e a produção quando sua loja utilizar esse fluxo.'}
  ]);
  function firstUseSteps(snapshot={}){
    const knownOnboarding=snapshot.onboarding&&typeof snapshot.onboarding.completed==='boolean';
    const products=Array.isArray(snapshot.products)?snapshot.products:null;
    const cash=snapshot.cashSession;
    const sales=Array.isArray(snapshot.sales)?snapshot.sales:null;
    const completedSale=Boolean(sales&&sales.some(s=>['COMPLETED','PAID'].includes(String(s.status||'').toUpperCase())));
    const steps=[
      {id:'profile',title:'Dados da loja e área de atuação',description:'Escolha a operação e confira Alimentação ou Atacado.',route:'home',status:!knownOnboarding?'unknown':snapshot.onboarding.completed?'done':'pending',required:true},
      {id:'products',title:'Primeiros produtos',description:'Cadastre ou importe os itens que serão vendidos.',route:'products',status:!products?'unknown':products.some(p=>p.active!==false)?'done':'pending',required:true},
      {id:'cash',title:'Caixa da loja',description:'Abra uma sessão de caixa quando for iniciar as vendas.',route:'cash',status:cash===undefined?'unknown':cash&&String(cash.status||'OPEN').toUpperCase()==='OPEN'?'done':'pending',required:true},
      {id:'printer',title:'Impressora e periféricos',description:'Confira conexão e impressão de teste no equipamento real.',route:'settings',category:'printing',status:'optional',required:false},
      {id:'payments',title:'Pix e cartão',description:'Revise os meios de pagamento; integrações externas são opcionais.',route:'settings',category:'payments',status:'optional',required:false},
      {id:'sale',title:'Primeira venda',description:'Conheça o Balcão. Não crie vendas fictícias no banco da loja.',route:'checkout',status:completedSale?'done':'optional',required:false}
    ];
    if(Array.isArray(snapshot.modules)&&snapshot.modules.some(m=>m.id==='FOOD'&&m.enabled===true)){
      steps.push({id:'food',title:'Mesas e produção',description:'Confira as opções disponíveis na área Alimentação.',route:'FOOD',status:'optional',required:false});
    }
    return Object.freeze({
      steps,
      completed:steps.filter(s=>s.required&&s.status==='done').length,
      total:steps.filter(s=>s.required).length
    });
  }
  function shouldOfferAutomatically(snapshot={}){
    return snapshot.onboarding?.completed===false&&
      Array.isArray(snapshot.products)&&snapshot.products.length===0&&
      Array.isArray(snapshot.sales)&&snapshot.sales.length===0;
  }
  function tourForUser(canAccess,modules=[]){
    if(typeof canAccess!=='function')return[];
    return TUTORIAL.filter(item=>canAccess(item.route)&&
      (item.route!=='FOOD'||modules.some(m=>m.id==='FOOD'&&m.enabled===true)));
  }
  return Object.freeze({firstUseSteps,shouldOfferAutomatically,tourForUser});
});
