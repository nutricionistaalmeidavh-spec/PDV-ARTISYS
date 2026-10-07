async function setupFood(page,scenario,runtimeContext){
  const state=await page.evaluate(async scenario=>{
    const api=new window.PdvApiClient.ApiClient();
    const config=await api.initialize();
    const current=await api.currentSession();
    const operatorId=current?.user?.id||current?.userId||'qa-admin';
    const req=(path,options={})=>api.request(path,options);
    await api.setModule('FOOD',true);

    async function product(input){
      return api.saveProduct({categoryId:null,unit:'UN',minimumStock:0,active:true,...input});
    }
    async function ensureStation(){
      try{return await req('/api/v1/restaurant/kitchen/stations',{method:'POST',body:{id:'tutorial-kds',name:'Cozinha principal',printEnabled:false}});}
      catch{
        const rows=await req('/api/v1/restaurant/kitchen/stations');
        return rows.find(row=>row.id==='tutorial-kds')||rows[0];
      }
    }
    async function ensureFoodCatalog(){
      const station=await ensureStation();
      await product({id:'tutorial-food-main',name:'Hambúrguer Artesanal',sku:'FOOD-001',usageType:'DIRECT',salePriceCents:2790,costCents:980,trackStock:false,menuEnabled:true});
      await product({id:'tutorial-food-drink',name:'Refrigerante Lata',sku:'FOOD-002',usageType:'DIRECT',salePriceCents:700,costCents:250,trackStock:false,menuEnabled:true});
      await req('/api/v1/restaurant/kitchen/routing',{method:'POST',body:{productId:'tutorial-food-main',mode:'PRODUCTION',stationId:station.id||'tutorial-kds'}});
      await req('/api/v1/restaurant/kitchen/routing',{method:'POST',body:{productId:'tutorial-food-drink',mode:'DIRECT'}});
      await req('/api/v1/restaurant/public-ordering/menu/tutorial-food-main',{method:'PATCH',body:{description:'Hambúrguer da casa com acompanhamento.',visible:true}});
      await req('/api/v1/restaurant/public-ordering/menu/tutorial-food-drink',{method:'PATCH',body:{description:'Bebida gelada.',visible:true}});
      return station;
    }
    async function ensureTable(){
      try{return await req('/api/v1/restaurant/tables',{method:'POST',body:{id:'tutorial-table-08',label:'Mesa 08',capacity:4,active:true}});}
      catch{
        const rows=await req('/api/v1/restaurant/tables');
        return rows.find(row=>row.id==='tutorial-table-08')||rows[0];
      }
    }
    async function openTable(){
      const table=await ensureTable();
      if(table.sessionId)return {table,session:{id:table.sessionId}};
      try{
        const session=await req('/api/v1/restaurant/tables/tutorial-table-08/open',{method:'POST',body:{operatorId,waiterId:operatorId,partySize:2}});
        return {table,session};
      }catch{
        const rows=await req('/api/v1/restaurant/tables');
        const fresh=rows.find(row=>row.id==='tutorial-table-08');
        return {table:fresh,session:{id:fresh.sessionId}};
      }
    }
    async function createOrder(sessionId){
      return req(`/api/v1/restaurant/sessions/${encodeURIComponent(sessionId)}/orders`,{
        method:'POST',body:{operatorId,items:[
          {productId:'tutorial-food-main',quantity:1},
          {productId:'tutorial-food-drink',quantity:1}
        ]}
      });
    }
    async function device(id,name,deviceType){
      try{return await req('/api/v1/restaurant/devices',{method:'POST',body:{id,name,deviceType}});}
      catch{return null;}
    }

    if(scenario==='recipe'){
      await ensureStation();
      await product({id:'tutorial-ingredient-bread',name:'Pão Brioche',sku:'INS-001',usageType:'INGREDIENT',salePriceCents:0,costCents:350,trackStock:true,menuEnabled:false});
      await product({id:'tutorial-ingredient-meat',name:'Hambúrguer 160g',sku:'INS-002',usageType:'INGREDIENT',salePriceCents:0,costCents:780,trackStock:true,menuEnabled:false});
      return {terminalId:config.terminalId,operatorId};
    }

    await ensureFoodCatalog();
    await ensureTable();
    await req('/api/v1/restaurant/public-ordering/config',{method:'PUT',body:{autoOpenTable:true,menuLayout:scenario==='appearance'?'COMPACT':'PREMIUM'}});

    const vars={terminalId:config.terminalId,operatorId};
    if(['customer-order','appearance','qr'].includes(scenario)){
      const qr=await req('/api/v1/restaurant/public-ordering/tables/tutorial-table-08/qr');
      vars.foodMenuUrl=qr.url;
    }

    if(['waiter','kds','sync','checkout'].includes(scenario)){
      const opened=await openTable();
      vars.restaurantSessionId=opened.session.id;
      await createOrder(opened.session.id);
    }

    if(['waiter','sync'].includes(scenario)){
      const waiter=await device('tutorial-waiter','Garçom Tutorial','WAITER');
      vars.waiterId=waiter?.id||'tutorial-waiter';
      vars.waiterKey=waiter?.credential||'';
    }
    if(['kds','sync'].includes(scenario)){
      const kitchen=await device('tutorial-kitchen','KDS Cozinha','KITCHEN');
      vars.kitchenId=kitchen?.id||'tutorial-kitchen';
      vars.kitchenKey=kitchen?.credential||'';
    }

    if(scenario==='checkout'){
      let cash=null;try{cash=await api.openCash(config.terminalId);}catch{}
      if(!cash){const opened=await api.createCash({terminalId:config.terminalId,initialCashCents:10000});cash=opened.session||opened;}
      vars.cashSessionId=cash.id;
    }
    return vars;
  },scenario);

  runtimeContext.vars={...(runtimeContext.vars||{}),...state};
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});
  await page.locator('#app-topbar').waitFor({state:'visible',timeout:15000});
}

export default {capabilities:{
  'tutorial.food.setup':async({page,step,runtimeContext})=>setupFood(page,step.scenario||'base',runtimeContext)
}};
