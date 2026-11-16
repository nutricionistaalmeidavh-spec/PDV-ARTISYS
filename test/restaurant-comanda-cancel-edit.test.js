'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

function fixture(){
  let seq=0;
  const rt=createPdvRuntime({now:()=>new Date(Date.UTC(2026,10,16,12,0,0)+1000*seq++).toISOString(),idFactory:p=>p+'-'+seq++});
  const cashier=rt.catalog.createUser({id:'cashier-qa',username:'cashier-qa',name:'Caixa QA',profileId:'profile-cashier',password:'senha-cash-123'});
  const manager=rt.catalog.createUser({id:'manager-qa',username:'manager-qa',name:'Gerente QA',profileId:'profile-manager',password:'senha-man-123'});
  const direct=rt.catalog.upsertProduct({id:'direct-qa',name:'Água',salePriceCents:650,trackStock:false,menuEnabled:true});
  const meal=rt.catalog.upsertProduct({id:'meal-qa',name:'Prato',salePriceCents:2500,trackStock:false,menuEnabled:true});
  rt.kitchen.configureProductRoute(direct.id,{mode:'DIRECT'});
  const station=rt.kitchen.upsertStation({id:'station-qa',name:'Cozinha'});
  rt.kitchen.configureProductRoute(meal.id,{mode:'PRODUCTION',stationId:station.id});
  const table=rt.restaurant.upsertTable({id:'table-qa',label:'Mesa QA'});
  const table2=rt.restaurant.upsertTable({id:'table-qa-2',label:'Mesa 2'});
  const open=()=>rt.restaurant.openTable(table.id,{operatorId:cashier.id,actor:{userId:cashier.id}});
  return{rt,cashier,manager,direct,meal,table,table2,open,close:()=>rt.close()};
}

test('P1 edita quantidade e observação de item direto sem perder preço, item ou histórico',()=>{
  const f=fixture();try{
    const session=f.open();
    const order=f.rt.restaurant.addOrder(session.id,{items:[{productId:f.direct.id,quantity:1,note:'Gelada'}],actor:{userId:f.cashier.id}});
    const old=order.items[0];
    const edited=f.rt.restaurant.updateOrderItem(old.id,{quantity:3,note:'Sem gelo'}, {kind:'human',userId:f.cashier.id});
    assert.equal(edited.quantity,3);assert.equal(edited.note,'Sem gelo');
    assert.equal(edited.totalCents,1950);assert.equal(edited.id,old.id);
    const read=f.rt.restaurant.getSession(session.id);
    assert.equal(read.totalCents,1950);
    assert.equal(read.orders[0].items[0].note,'Sem gelo');
    assert.ok(f.rt.db.prepare("SELECT 1 FROM audit_log WHERE action='restaurant.order.item.update'").get());
  }finally{f.close();}
});

test('P1 impede alterar pedido pago, cancelado e ticket em preparação',async()=>{
  const f=fixture();try{
    const session=f.open();
    const order=f.rt.restaurant.addOrder(session.id,{items:[{productId:f.meal.id,quantity:2}],actor:{userId:f.cashier.id}});
    await f.rt.dispatchPending();
    const ticket=f.rt.kitchen.listTickets().find(t=>t.orderId===order.id);
    f.rt.kitchen.updateTicketStatus(ticket.id,'PREPARING',{userId:f.manager.id});
    assert.throws(()=>f.rt.restaurant.updateOrderItem(order.items[0].id,{quantity:4},{kind:'human',userId:f.cashier.id}),/produção|preparo|cozinha/i);
    assert.equal(f.rt.restaurant.getOrder(order.id).items[0].quantity,2);
  }finally{f.close();}
});

test('P0 cancelamento de comanda vazia libera mesa, persiste motivo e preserva consulta',()=>{
  const f=fixture();try{
    const session=f.open();
    const result=f.rt.restaurant.cancelSession(session.id,{reason:'Aberta por engano',actor:{kind:'human',userId:f.cashier.id}});
    assert.equal(result.status,'CANCELLED');assert.equal(result.cancelReason,'Aberta por engano');
    assert.equal(f.rt.restaurant.listTables().find(t=>t.id===f.table.id).status,'FREE');
    assert.equal(f.rt.restaurant.getSession(session.id).status,'CANCELLED');
    assert.ok(f.rt.db.prepare("SELECT reason FROM restaurant_session_cancellations WHERE session_id=?").get(session.id));
    assert.throws(()=>f.rt.restaurant.addOrder(session.id,{items:[{productId:f.direct.id}]}),/aberta/i);
    assert.equal(f.rt.restaurant.cancelSession(session.id,{reason:'Repetir',actor:{userId:f.cashier.id}}).cancelReason,'Aberta por engano');
  }finally{f.close();}
});

test('P0 cancelar comanda com tickets NEW suspende KDS e mantém histórico de pedidos',async()=>{
  const f=fixture();try{
    const session=f.open();
    const order=f.rt.restaurant.addOrder(session.id,{items:[{productId:f.meal.id,quantity:1}],actor:{userId:f.cashier.id}});
    await f.rt.dispatchPending();
    assert.equal(f.rt.kitchen.listTickets().filter(t=>t.orderId===order.id)[0].status,'NEW');
    const cancelled=f.rt.restaurant.cancelSession(session.id,{reason:'Cliente desistiu',actor:{kind:'human',userId:f.cashier.id}});
    assert.equal(cancelled.status,'CANCELLED');
    assert.equal(cancelled.orders[0].status,'CANCELLED');
    assert.equal(f.rt.restaurant.listTables().find(t=>t.id===f.table.id).status,'FREE');
    assert.equal(f.rt.kitchen.listTickets().filter(t=>t.orderId===order.id)[0].status,'CANCELLED');
    await f.rt.dispatchPending();
    const printJobs=f.rt.printing.listJobs({type:'KITCHEN_TICKET'});
    assert.ok(printJobs.some(job=>String(job.payload?.text||'').includes('COMANDA CANCELADA')));
  }finally{f.close();}
});

test('P0 cancelamento proíbe produção em andamento sem autorização extra e pagamentos parciais',async()=>{
  const f=fixture();try{
    const session=f.open();
    const order=f.rt.restaurant.addOrder(session.id,{items:[{productId:f.meal.id,quantity:1}],actor:{userId:f.cashier.id}});
    await f.rt.dispatchPending();
    const ticket=f.rt.kitchen.listTickets().find(t=>t.orderId===order.id);
    f.rt.kitchen.updateTicketStatus(ticket.id,'PREPARING',{userId:f.manager.id});
    assert.throws(()=>f.rt.restaurant.cancelSession(session.id,{reason:'Cliente desistiu',actor:{userId:f.cashier.id}}),/produção|preparo|autorização/i);
    const result=f.rt.restaurant.cancelSession(session.id,{reason:'Gerente autorizou',allowProduction:true,actor:{kind:'human',userId:f.manager.id}});
    assert.equal(result.status,'CANCELLED');
    const next=f.rt.restaurant.openTable(f.table.id,{operatorId:f.cashier.id});
    f.rt.restaurant.addOrder(next.id,{items:[{productId:f.direct.id,quantity:2}]});
    const billItem=f.rt.restaurantSettlement.getRemainingBalance(next.id).items[0];
    f.rt.cash.openSession({terminalId:'PDV-01',operatorId:f.cashier.id,initialCashCents:0,actor:{userId:f.cashier.id}});
    const split=f.rt.restaurantSettlement.createItemSettlement(next.id,{
      terminalId:'PDV-01',operatorId:f.cashier.id,items:[{orderItemId:billItem.orderItemId,quantity:1}]
    },{kind:'human',userId:f.cashier.id});
    f.rt.restaurantSettlement.completeSettlement(split.settlement.id,{
      payments:[{method:'CASH',amountCents:650}]
    },{kind:'human',userId:f.cashier.id});
    assert.throws(()=>f.rt.restaurant.cancelSession(next.id,{reason:'Pagamento registrado'}),/pagamento|cobrança|divisão/i);
    assert.equal(f.rt.restaurant.getSession(next.id).status,'OPEN');
  }finally{f.close();}
});

test('P0 e P1 API exige sessão humana e permissões de perfil para edição e cancelamento',async()=>{
  const f=fixture();let server;
  try{
    const session=f.open();
    const order=f.rt.restaurant.addOrder(session.id,{items:[{productId:f.direct.id,quantity:1}]});
    server=createLocalServer({runtime:f.rt,host:'127.0.0.1',port:0,token:'comanda-secret'});
    const addr=await server.start();const base='http://'+addr.host+':'+addr.port;
    const headers={'x-pdv-token':'comanda-secret','content-type':'application/json'};
    const login=async(u,p)=>{
      const r=await fetch(base+'/api/v1/auth/login',{method:'POST',headers,body:JSON.stringify({username:u,password:p,terminalId:'PDV-01'})});
      assert.equal(r.status,200);return(await r.json()).sessionToken;
    };
    const cashierToken=await login('cashier-qa','senha-cash-123');
    const api=(route,method,body,token)=>fetch(base+route,{method,headers:{...headers,...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});
    const noAuth=await api('/api/v1/restaurant/order-items/'+order.items[0].id,'PATCH',{quantity:2});
    assert.equal(noAuth.status,401);
    const edit=await api('/api/v1/restaurant/order-items/'+order.items[0].id,'PATCH',{quantity:2,note:'Editado'},cashierToken);
    assert.equal(edit.status,200);
    const cancel=await api('/api/v1/restaurant/sessions/'+session.id+'/cancel','POST',{reason:'Cliente cancelou'},cashierToken);
    assert.equal(cancel.status,200);
    assert.equal(f.rt.restaurant.getSession(session.id).status,'CANCELLED');
  }finally{if(server)await server.stop();f.close();}
});
