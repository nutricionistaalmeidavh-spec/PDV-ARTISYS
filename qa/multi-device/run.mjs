#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const {createPdvRuntime}=require('../../js/core/pdv-runtime');
const {createLocalServer}=require('../../server/local-server');

const PROFILE_SCENARIOS=Object.freeze({
  smoke:['price-propagation','sale-stock-decrement','last-unit-race','idempotent-completion','database-invariants'],
  full:['price-propagation','sale-stock-decrement','last-unit-race','idempotent-completion','cash-session-isolation','restaurant-kds-flow','self-service-order','authorization-boundaries','database-invariants'],
  stress:['price-propagation','sale-stock-decrement','last-unit-race','idempotent-completion','cash-session-isolation','restaurant-kds-flow','self-service-order','authorization-boundaries','stress-last-unit-races','database-invariants']
});

function parseArgs(argv){
  const result={profile:process.env.QA_PROFILE||'full',output:'qa-artifacts/multi-device'};
  for(let i=0;i<argv.length;i+=1){
    if(argv[i]==='--profile'&&argv[i+1])result.profile=argv[++i];
    else if(argv[i]==='--output'&&argv[i+1])result.output=argv[++i];
  }
  result.profile=String(result.profile||'full').toLowerCase();
  if(!PROFILE_SCENARIOS[result.profile])throw new Error('Perfil invalido. Use smoke, full ou stress.');
  return result;
}

function assert(condition,message,details={}){
  if(condition)return;
  const error=new Error(message);
  error.details=details;
  throw error;
}

function safeJson(value){
  try{return JSON.stringify(value);}catch{return String(value);}
}

function requestFactory(base,defaults={}){
  return async function request(route,{method='GET',body,headers={},expected=null}={}){
    const response=await fetch(base+route,{
      method,
      headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(defaults.headers||{}),...headers},
      body:body===undefined?undefined:JSON.stringify(body)
    });
    const text=await response.text();
    let payload=null;
    if(text){try{payload=JSON.parse(text);}catch{payload=text;}}
    const result={status:response.status,body:payload};
    if(expected!==null){
      const accepted=Array.isArray(expected)?expected:[expected];
      if(!accepted.includes(response.status)){
        const error=new Error(method+' '+route+' retornou '+response.status+': '+safeJson(payload));
        error.response=result;
        throw error;
      }
    }
    return result;
  };
}

async function login(base,{username,password,terminal}){
  const terminalHeaders={'x-terminal-id':terminal.terminalId,'x-terminal-key':terminal.credential};
  const request=requestFactory(base,{headers:terminalHeaders});
  const response=await request('/api/v1/auth/login',{method:'POST',body:{username,password,terminalId:terminal.terminalId},expected:200});
  const token=response.body.sessionToken;
  return {terminalId:terminal.terminalId,token,request:requestFactory(base,{headers:{authorization:'Bearer '+token,...terminalHeaders}})};
}

function deviceClient(base,device){
  return requestFactory(base,{headers:{'x-device-id':device.id,'x-device-key':device.credential}});
}

function movementCount(db,productId,type='sale'){
  return db.prepare('SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id=? AND type=?').get(String(productId),String(type)).n;
}

function completedCount(db,ids){
  const placeholders=ids.map(()=>'?').join(',');
  return db.prepare("SELECT COUNT(*) AS n FROM sales WHERE id IN ("+placeholders+") AND status='COMPLETED'").get(...ids).n;
}

async function runMultiDeviceQa({profile='full',output='qa-artifacts/multi-device'}={}){
  const selected=PROFILE_SCENARIOS[profile];
  if(!selected)throw new Error('Perfil de QA desconhecido.');
  const outputDir=path.resolve(output);
  fs.rmSync(outputDir,{recursive:true,force:true});
  fs.mkdirSync(outputDir,{recursive:true});
  const logPath=path.join(outputDir,'events.jsonl');
  const log=(event,data={})=>fs.appendFileSync(logPath,JSON.stringify({at:new Date().toISOString(),event,...data})+'\n');

  const dbPath=path.join(outputDir,'final.sqlite');
  const packageVersion=JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'..','..','package.json'),'utf8')).version;
  let idSeq=0;
  let nowSeq=0;
  const runtime=createPdvRuntime({
    dbPath,
    appVersion:packageVersion,
    serverVersion:packageVersion,
    idFactory:prefix=>'qa-'+prefix+'-'+(++idSeq),
    now:()=>new Date(Date.UTC(2026,9,3,18,0,0)+(nowSeq++)*1000).toISOString()
  });
  const installToken='qa-local-fixture';
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:installToken,requireTerminalAuth:true});
  const actor={userId:'qa-admin',role:'admin',terminalId:'ADMIN-01'};
  const results=[];
  const state={};

  function pairTerminal(terminalId,name){
    const pairing=runtime.terminals.createPairingCode({createdBy:'qa-admin',ttlSeconds:3600});
    const paired=runtime.terminals.pairTerminal({code:pairing.code,terminalId,name,fingerprint:'qa-'+terminalId,appVersion:packageVersion});
    return{terminalId,name,credential:paired.credential};
  }

  async function scenario(name,fn){
    if(!selected.includes(name))return;
    const started=performance.now();
    log('scenario.start',{name});
    try{
      const details=await fn();
      const entry={name,status:'PASS',durationMs:Math.round(performance.now()-started),details:details||{}};
      results.push(entry);log('scenario.pass',entry);return entry;
    }catch(error){
      const entry={name,status:'FAIL',durationMs:Math.round(performance.now()-started),error:error?.message||String(error),details:error?.details||error?.response||{}};
      results.push(entry);log('scenario.fail',entry);return entry;
    }
  }

  try{
    runtime.catalog.createUser({id:'qa-admin',username:'qa-admin',name:'QA Administrador',role:'admin',password:'qa-test-password'});
    runtime.catalog.createUser({id:'qa-cash-a',username:'qa-cash-a',name:'QA Caixa A',role:'cashier',password:'qa-test-password'});
    runtime.catalog.createUser({id:'qa-cash-b',username:'qa-cash-b',name:'QA Caixa B',role:'cashier',password:'qa-test-password'});
    runtime.catalog.createUser({id:'qa-waiter',username:'qa-waiter',name:'QA Garcom',role:'cashier',password:'qa-test-password'});
    runtime.catalog.createUser({id:'qa-waiter-2',username:'qa-waiter-2',name:'QA Garcom 2',role:'cashier',password:'qa-test-password'});

    runtime.catalog.upsertCategory({id:'qa-category',name:'QA Multi-Device'},actor);
    const seedProducts=[
      {id:'qa-price',sku:'QA-PRICE',name:'Produto Preco',salePriceCents:1000,costCents:400,trackStock:false,menuEnabled:true},
      {id:'qa-stock',sku:'QA-STOCK',name:'Produto Estoque',salePriceCents:1000,costCents:400,trackStock:true,menuEnabled:true},
      {id:'qa-last',sku:'QA-LAST',name:'Ultima Unidade',salePriceCents:700,costCents:250,trackStock:true,menuEnabled:true},
      {id:'qa-idem',sku:'QA-IDEM',name:'Produto Idempotencia',salePriceCents:900,costCents:300,trackStock:true,menuEnabled:true},
      {id:'qa-food',sku:'QA-FOOD',name:'Prato QA',salePriceCents:1800,costCents:700,trackStock:true,menuEnabled:true}
    ];
    for(const product of seedProducts)runtime.catalog.upsertProduct({...product,categoryId:'qa-category',active:true},actor);
    runtime.inventory.move({productId:'qa-stock',type:'opening',quantityDelta:5,reason:'QA seed'},actor);
    runtime.inventory.move({productId:'qa-last',type:'opening',quantityDelta:1,reason:'QA seed'},actor);
    runtime.inventory.move({productId:'qa-idem',type:'opening',quantityDelta:2,reason:'QA seed'},actor);
    runtime.inventory.move({productId:'qa-food',type:'opening',quantityDelta:5,reason:'QA seed'},actor);

    state.adminTerminal=pairTerminal('ADMIN-01','Administracao QA');
    state.cashATerminal=pairTerminal('CAIXA-01','Caixa QA 1');
    state.cashBTerminal=pairTerminal('CAIXA-02','Caixa QA 2');

    const address=await server.start();
    const base='http://'+address.host+':'+address.port;
    state.base=base;
    state.admin=await login(base,{username:'qa-admin',password:'qa-test-password',terminal:state.adminTerminal});
    state.cashA=await login(base,{username:'qa-cash-a',password:'qa-test-password',terminal:state.cashATerminal});
    state.cashB=await login(base,{username:'qa-cash-b',password:'qa-test-password',terminal:state.cashBTerminal});

    const cashAOpen=await state.cashA.request('/api/v1/cash/sessions',{method:'POST',headers:{'x-mutation-id':'qa-open-cash-a'},body:{initialCashCents:10000},expected:201});
    const cashBOpen=await state.cashB.request('/api/v1/cash/sessions',{method:'POST',headers:{'x-mutation-id':'qa-open-cash-b'},body:{initialCashCents:10000},expected:201});
    state.cashSessionA=cashAOpen.body.session;
    state.cashSessionB=cashBOpen.body.session;

    await scenario('price-propagation',async()=>{
      await state.admin.request('/api/v1/products',{method:'POST',body:{id:'qa-price',sku:'QA-PRICE',name:'Produto Preco',categoryId:'qa-category',salePriceCents:1250,costCents:400,trackStock:false,menuEnabled:true,active:true},expected:201});
      const products=await state.cashA.request('/api/v1/products',{expected:200});
      const product=products.body.find(item=>item.id==='qa-price');
      assert(product?.salePriceCents===1250,'Novo preco nao apareceu no caixa',{product});
      const opened=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-PRICE-SALE'},expected:201});
      const sale=await state.cashA.request('/api/v1/sales/'+opened.body.id+'/items',{method:'POST',body:{productId:'qa-price',quantity:1},expected:200});
      assert(sale.body.items[0]?.unitPriceCents===1250,'Venda nova nao capturou o preco atualizado',{item:sale.body.items[0]});
      state.priceSaleId=opened.body.id;
      return{priceCents:product.salePriceCents,saleUnitPriceCents:sale.body.items[0].unitPriceCents};
    });

    await scenario('sale-stock-decrement',async()=>{
      const opened=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-STOCK-SALE'},expected:201});
      await state.cashA.request('/api/v1/sales/'+opened.body.id+'/items',{method:'POST',body:{productId:'qa-stock',quantity:2},expected:200});
      const completed=await state.cashA.request('/api/v1/sales/'+opened.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-stock-complete'},body:{payments:[{method:'CASH',amountCents:2000}]},expected:200});
      const inventory=await state.admin.request('/api/v1/inventory/qa-stock',{expected:200});
      assert(completed.body.sale.status==='COMPLETED','Venda de estoque nao concluiu',{sale:completed.body.sale});
      assert(inventory.body.quantity===3,'Venda nao baixou exatamente duas unidades',{inventory:inventory.body});
      assert(movementCount(runtime.db,'qa-stock')===1,'Baixa de estoque foi duplicada',{movements:movementCount(runtime.db,'qa-stock')});
      state.stockSaleId=opened.body.id;
      return{saleId:opened.body.id,finalStock:inventory.body.quantity,movements:movementCount(runtime.db,'qa-stock')};
    });

    await scenario('last-unit-race',async()=>{
      const a=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-LAST-A'},expected:201});
      const b=await state.cashB.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-LAST-B'},expected:201});
      await state.cashA.request('/api/v1/sales/'+a.body.id+'/items',{method:'POST',body:{productId:'qa-last',quantity:1},expected:200});
      await state.cashB.request('/api/v1/sales/'+b.body.id+'/items',{method:'POST',body:{productId:'qa-last',quantity:1},expected:200});
      const attempts=await Promise.all([
        state.cashA.request('/api/v1/sales/'+a.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-last-a'},body:{payments:[{method:'PIX',amountCents:700}]}}),
        state.cashB.request('/api/v1/sales/'+b.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-last-b'},body:{payments:[{method:'PIX',amountCents:700}]}})
      ]);
      const successes=attempts.filter(item=>item.status===200);
      const inventory=await state.admin.request('/api/v1/inventory/qa-last',{expected:200});
      const completed=completedCount(runtime.db,[a.body.id,b.body.id]);
      const movements=movementCount(runtime.db,'qa-last');
      assert(successes.length===1,'Duas vendas consumiram a mesma ultima unidade',{attempts,completed,finalStock:inventory.body.quantity,movements});
      assert(completed===1,'Mais de uma venda ficou COMPLETED com estoque unitario',{attempts,completed});
      assert(inventory.body.quantity===0,'Saldo final da ultima unidade deve ser zero',{inventory:inventory.body});
      assert(movements===1,'Ultima unidade deve gerar uma unica baixa',{movements});
      return{attemptStatuses:attempts.map(item=>item.status),completedSales:completed,finalStock:inventory.body.quantity,movements};
    });

    await scenario('idempotent-completion',async()=>{
      const opened=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-IDEM-SALE'},expected:201});
      await state.cashA.request('/api/v1/sales/'+opened.body.id+'/items',{method:'POST',body:{productId:'qa-idem',quantity:1},expected:200});
      const mutationId='qa-idempotent-complete';
      const attempts=await Promise.all([
        state.cashA.request('/api/v1/sales/'+opened.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':mutationId},body:{payments:[{method:'PIX',amountCents:900}]}}),
        state.cashA.request('/api/v1/sales/'+opened.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':mutationId},body:{payments:[{method:'PIX',amountCents:900}]}})
      ]);
      assert(attempts.every(item=>item.status===200),'Reenvio idempotente nao retornou resultado canonico',{attempts});
      const inventory=await state.admin.request('/api/v1/inventory/qa-idem',{expected:200});
      const movements=movementCount(runtime.db,'qa-idem');
      assert(inventory.body.quantity===1,'Reenvio baixou estoque mais de uma vez',{inventory:inventory.body,movements});
      assert(movements===1,'Reenvio criou movimento de estoque duplicado',{movements});
      state.idempotentSaleId=opened.body.id;
      return{statuses:attempts.map(item=>item.status),finalStock:inventory.body.quantity,movements};
    });

    await scenario('cash-session-isolation',async()=>{
      const saleB=await state.cashB.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-CASH-B'},expected:201});
      await state.cashB.request('/api/v1/sales/'+saleB.body.id+'/items',{method:'POST',body:{productId:'qa-price',quantity:1},expected:200});
      await state.cashB.request('/api/v1/sales/'+saleB.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-cash-b-sale'},body:{payments:[{method:'CASH',amountCents:1250}]},expected:200});
      const rowA=runtime.db.prepare('SELECT cash_session_id AS cashSessionId FROM sales WHERE id=?').get(state.stockSaleId);
      const rowB=runtime.db.prepare('SELECT cash_session_id AS cashSessionId FROM sales WHERE id=?').get(saleB.body.id);
      assert(rowA.cashSessionId===state.cashSessionA.id,'Venda do Caixa A foi vinculada a sessao errada',{rowA,expected:state.cashSessionA.id});
      assert(rowB.cashSessionId===state.cashSessionB.id,'Venda do Caixa B foi vinculada a sessao errada',{rowB,expected:state.cashSessionB.id});
      const movementA=runtime.db.prepare('SELECT cash_session_id AS cashSessionId FROM cash_movements WHERE sale_id=? LIMIT 1').get(state.stockSaleId);
      const movementB=runtime.db.prepare('SELECT cash_session_id AS cashSessionId FROM cash_movements WHERE sale_id=? LIMIT 1').get(saleB.body.id);
      assert(movementA?.cashSessionId===state.cashSessionA.id,'Movimento financeiro do Caixa A caiu em outro caixa',{movementA});
      assert(movementB?.cashSessionId===state.cashSessionB.id,'Movimento financeiro do Caixa B caiu em outro caixa',{movementB});
      return{cashA:rowA.cashSessionId,cashB:rowB.cashSessionId};
    });

    await scenario('restaurant-kds-flow',async()=>{
      runtime.restaurant.upsertTable({id:'qa-table',label:'Mesa QA',seats:4,active:true},actor);
      runtime.kitchen.upsertStation({id:'qa-station',name:'Cozinha QA',active:true},actor);
      runtime.kitchen.assignProduct('qa-food','qa-station',actor);
      const waiter=runtime.mobileDevices.createDevice({id:'qa-waiter-device',name:'Garcom QA',deviceType:'WAITER',userId:'qa-waiter'},actor);
      const kitchen=runtime.mobileDevices.createDevice({id:'qa-kds-device',name:'KDS QA',deviceType:'KITCHEN'},actor);
      const waiterHttp=deviceClient(base,waiter);
      const kitchenHttp=deviceClient(base,kitchen);
      const opened=await waiterHttp('/api/v1/mobile/tables/qa-table/open',{method:'POST',headers:{'x-mutation-id':'qa-table-open'},body:{partySize:2},expected:201});
      const order=await waiterHttp('/api/v1/mobile/orders',{method:'POST',headers:{'x-mutation-id':'qa-waiter-order'},body:{sessionId:opened.body.id,items:[{productId:'qa-food',quantity:1}]},expected:201});
      const kds=await kitchenHttp('/api/v1/mobile/context',{expected:200});
      const ticket=kds.body.tickets.find(item=>item.orderId===order.body.order.id)||kds.body.tickets[0];
      assert(ticket,'Pedido do garcom nao apareceu no KDS',{tickets:kds.body.tickets,order:order.body.order});
      await kitchenHttp('/api/v1/mobile/kitchen/tickets/'+ticket.id,{method:'PATCH',body:{status:'PREPARING'},expected:200});
      await kitchenHttp('/api/v1/mobile/kitchen/tickets/'+ticket.id,{method:'PATCH',body:{status:'READY'},expected:200});
      const session=runtime.restaurant.getSession(opened.body.id);
      const storedOrder=session.orders.find(item=>item.id===order.body.order.id);
      assert(storedOrder?.status==='READY','Status READY do KDS nao voltou para a comanda',{storedOrder});
      state.restaurantSessionId=opened.body.id;
      return{sessionId:opened.body.id,orderId:order.body.order.id,ticketId:ticket.id,status:storedOrder.status};
    });

    await scenario('self-service-order',async()=>{
      const device=runtime.mobileDevices.createDevice({id:'qa-self-device',name:'Totem QA',deviceType:'SELF_SERVICE'},actor);
      runtime.selfService.configureDevice(device.id,{mode:'PICKUP',operatorId:'qa-cash-a'},actor);
      const selfHttp=deviceClient(base,device);
      const context=await selfHttp('/api/v1/mobile/context',{expected:200});
      assert(context.body.profile?.mode==='PICKUP','Totem nao carregou perfil PICKUP',{context:context.body});
      const submitted=await selfHttp('/api/v1/mobile/self-service/orders',{method:'POST',headers:{'x-mutation-id':'qa-self-order'},body:{items:[{productId:'qa-food',quantity:1}]},expected:201});
      assert(submitted.body.order,'Totem nao criou pedido',{response:submitted.body});
      return{orderId:submitted.body.order.id,mode:context.body.profile.mode,paymentMode:context.body.paymentMode};
    });

    await scenario('stress-last-unit-races',async()=>{
      const iterations=50;
      let winners=0;
      for(let i=0;i<iterations;i+=1){
        const productId='qa-stress-'+i;
        runtime.catalog.upsertProduct({id:productId,sku:'QA-S-'+i,name:'Stress '+i,categoryId:'qa-category',salePriceCents:100,costCents:20,trackStock:true,menuEnabled:false,active:true},actor);
        runtime.inventory.move({productId,type:'opening',quantityDelta:1,reason:'QA stress'},actor);
        const a=await state.cashA.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-STRESS-A-'+i},expected:201});
        const b=await state.cashB.request('/api/v1/sales',{method:'POST',body:{saleNumber:'QA-STRESS-B-'+i},expected:201});
        await state.cashA.request('/api/v1/sales/'+a.body.id+'/items',{method:'POST',body:{productId,quantity:1},expected:200});
        await state.cashB.request('/api/v1/sales/'+b.body.id+'/items',{method:'POST',body:{productId,quantity:1},expected:200});
        const attempts=await Promise.all([
          state.cashA.request('/api/v1/sales/'+a.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-stress-a-'+i},body:{payments:[{method:'PIX',amountCents:100}]}}),
          state.cashB.request('/api/v1/sales/'+b.body.id+'/complete',{method:'POST',headers:{'x-mutation-id':'qa-stress-b-'+i},body:{payments:[{method:'PIX',amountCents:100}]}})
        ]);
        const success=attempts.filter(item=>item.status===200).length;
        const stock=runtime.inventory.getBalance(productId);
        const movements=movementCount(runtime.db,productId);
        assert(success===1&&stock===0&&movements===1,'Stress detectou sobrevenda',{iteration:i,attempts,stock,movements});
        winners+=success;
      }
      return{iterations,winners};
    });

    await scenario('database-invariants',async()=>{
      const negative=runtime.db.prepare('SELECT COUNT(*) AS n FROM inventory_location_balances WHERE quantity<0').get().n;
      const orphanPayments=runtime.db.prepare('SELECT COUNT(*) AS n FROM payments p LEFT JOIN sales s ON s.id=p.sale_id WHERE s.id IS NULL').get().n;
      const completedWithoutPayment=runtime.db.prepare("SELECT COUNT(*) AS n FROM sales s WHERE s.status='COMPLETED' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.sale_id=s.id)").get().n;
      const completedWithoutCashSession=runtime.db.prepare("SELECT COUNT(*) AS n FROM sales WHERE status='COMPLETED' AND cash_session_id IS NULL").get().n;
      assert(negative===0,'Existe estoque negativo no banco',{negative});
      assert(orphanPayments===0,'Existem pagamentos orfaos',{orphanPayments});
      assert(completedWithoutPayment===0,'Existe venda concluida sem pagamento',{completedWithoutPayment});
      assert(completedWithoutCashSession===0,'Existe venda concluida sem sessao de caixa',{completedWithoutCashSession});
      return{negativeStockRows:negative,orphanPayments,completedWithoutPayment,completedWithoutCashSession};
    });
  }finally{
    await server.stop().catch(()=>{});
    runtime.close();
  }

  const failed=results.filter(item=>item.status==='FAIL');
  const report={schemaVersion:1,profile,generatedAt:new Date().toISOString(),passed:results.length-failed.length,failed:failed.length,scenarios:results};
  fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(report,null,2));
  const lines=[
    '# QA Multi-Device LAN',
    '',
    '- Perfil: **'+profile+'**',
    '- Cenarios aprovados: **'+report.passed+'**',
    '- Cenarios com falha: **'+report.failed+'**',
    '',
    '| Cenario | Resultado | Duracao |',
    '|---|---:|---:|',
    ...results.map(item=>'| '+item.name+' | '+item.status+' | '+item.durationMs+' ms |'),
    ''
  ];
  for(const item of failed){
    lines.push('## Falha: '+item.name,'','**'+item.error+'**','',JSON.stringify(item.details,null,2),'');
  }
  fs.writeFileSync(path.join(outputDir,'summary.md'),lines.join('\n'));
  if(failed.length)throw new Error('QA multi-device falhou em '+failed.length+' cenario(s): '+failed.map(item=>item.name).join(', '));
  return report;
}

const invoked=process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url));
if(invoked){
  const options=parseArgs(process.argv.slice(2));
  runMultiDeviceQa(options).then(report=>{
    console.log('QA multi-device '+report.profile+': '+report.passed+' PASS, '+report.failed+' FAIL');
  }).catch(error=>{
    console.error(error.message||error);
    process.exitCode=1;
  });
}

export {PROFILE_SCENARIOS,parseArgs,runMultiDeviceQa};
