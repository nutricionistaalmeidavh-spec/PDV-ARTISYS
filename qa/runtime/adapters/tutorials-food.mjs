const DEMO_PHOTO_URLS=Object.freeze({
  burger:'https://upload.wikimedia.org/wikipedia/commons/4/48/Hamburger_meat_patty_patties_lettuce_tomatoes_buns.jpg',
  pizza:'https://upload.wikimedia.org/wikipedia/commons/6/6e/Pepperoni_Pizza.jpg'
});

async function fetchDemoPhoto(kind){
  const url=DEMO_PHOTO_URLS[kind];
  if(!url)return null;
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(6000),headers:{'user-agent':'ArtiSys-QA/1.0'}});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    if(!bytes.length||bytes.length>8*1024*1024)throw new Error('invalid demo photo size');
    const mimeType=String(response.headers.get('content-type')||'image/jpeg').split(';')[0];
    if(!['image/jpeg','image/png','image/webp'].includes(mimeType))throw new Error('unsupported demo photo type');
    return{mimeType,originalBase64:bytes.toString('base64')};
  }catch{return null;}
}

async function attachDemoPhoto(page,{productId=null,productName=null,kind='burger',publish=false,description=''}={}){
  const remote=await fetchDemoPhoto(kind);
  return page.evaluate(async input=>{
    const api=new window.PdvApiClient.ApiClient();
    const products=await api.products(true);
    const product=input.productId
      ? products.find(item=>item.id===input.productId)
      : products.find(item=>item.name===input.productName);
    if(!product)throw new Error(`Produto para foto não encontrado: ${input.productId||input.productName}`);

    if(input.publish&&!product.menuEnabled){
      await api.saveProduct({
        id:product.id,name:product.name,sku:product.sku||'',barcode:product.barcode||'',
        categoryId:product.categoryId||null,unit:product.unit||'UN',usageType:product.usageType||'DIRECT',
        salePriceCents:Number(product.salePriceCents||0),costCents:Number(product.costCents||0),
        minimumStock:Number(product.minimumStock||0),trackStock:Boolean(product.trackStock),
        menuEnabled:true,active:product.active!==false
      });
    }

    const makeFallback=kind=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
      const ctx=canvas.getContext('2d');
      const gradient=ctx.createLinearGradient(0,0,640,480);
      gradient.addColorStop(0,kind==='pizza'?'#fff1dc':'#f7ead7');
      gradient.addColorStop(1,kind==='pizza'?'#dca35f':'#b97845');
      ctx.fillStyle=gradient;ctx.fillRect(0,0,640,480);
      ctx.fillStyle='rgba(255,255,255,.9)';ctx.beginPath();ctx.ellipse(320,255,245,175,0,0,Math.PI*2);ctx.fill();
      if(kind==='pizza'){
        ctx.fillStyle='#c98544';ctx.beginPath();ctx.arc(320,250,155,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#d84632';ctx.beginPath();ctx.arc(320,250,138,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#f6d77b';ctx.beginPath();ctx.arc(320,250,128,0,Math.PI*2);ctx.fill();
        ctx.fillStyle='#b8322e';
        for(const [x,y] of [[270,205],[355,200],[310,270],[390,275],[245,300],[335,330]]){ctx.beginPath();ctx.arc(x,y,22,0,Math.PI*2);ctx.fill();}
        ctx.strokeStyle='#f4e1bd';ctx.lineWidth=8;
        ctx.beginPath();ctx.arc(290,235,52,.4,2.2);ctx.stroke();ctx.beginPath();ctx.arc(360,300,45,3.4,5.5);ctx.stroke();
        ctx.fillStyle='#507a32';ctx.font='bold 24px sans-serif';ctx.fillText('orégano',270,258);
      }else{
        const x=185,w=270;
        ctx.fillStyle='#d9a348';ctx.beginPath();ctx.roundRect(x,130,w,78,42);ctx.fill();
        ctx.fillStyle='#54a143';ctx.fillRect(x+12,205,w-24,28);
        ctx.fillStyle='#d74a3b';ctx.fillRect(x+18,230,w-36,25);
        ctx.fillStyle='#f2cc50';ctx.beginPath();ctx.moveTo(x+20,252);ctx.lineTo(x+w-20,252);ctx.lineTo(x+w-55,292);ctx.lineTo(x+55,292);ctx.closePath();ctx.fill();
        ctx.fillStyle='#70412c';ctx.fillRect(x+10,282,w-20,58);
        ctx.fillStyle='#ecdd79';ctx.fillRect(x+20,342,w-40,15);
        ctx.fillStyle='#c47e36';ctx.beginPath();ctx.roundRect(x,352,w,72,34);ctx.fill();
      }
      return canvas;
    };

    let full=makeFallback(input.kind);
    let originalBase64='';
    let mimeType='image/png';
    if(input.remote?.originalBase64){
      try{
        const image=new Image();
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=`data:${input.remote.mimeType};base64,${input.remote.originalBase64}`;});
        const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;const ctx=canvas.getContext('2d');
        const scale=Math.max(canvas.width/image.naturalWidth,canvas.height/image.naturalHeight);
        const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
        ctx.drawImage(image,(canvas.width-width)/2,(canvas.height-height)/2,width,height);
        full=canvas;originalBase64=input.remote.originalBase64;mimeType=input.remote.mimeType;
      }catch{}
    }
    if(!originalBase64)originalBase64=full.toDataURL('image/png').split(',')[1];

    const thumb=document.createElement('canvas');thumb.width=320;thumb.height=240;
    thumb.getContext('2d').drawImage(full,0,0,320,240);
    const thumbnailBase64=thumb.toDataURL('image/png').split(',')[1];
    await api.request(`/api/v1/product-photos/${encodeURIComponent(product.id)}`,{
      method:'POST',body:{mimeType,originalBase64,thumbnailBase64}
    });
    if(input.description){
      await api.request(`/api/v1/restaurant/public-ordering/menu/${encodeURIComponent(product.id)}`,{
        method:'PATCH',body:{description:input.description,visible:true}
      }).catch(()=>{});
    }
    return product.id;
  },{productId,productName,kind,publish,description,remote});
}

async function setupFood(page,scenario,runtimeContext){
  const desktopUrl=page.url();
  const state=await page.evaluate(async scenario=>{
    const api=new window.PdvApiClient.ApiClient();
    const config=await api.initialize();
    const current=await api.currentSession();
    const operatorId=current?.user?.id||current?.userId||'qa-admin';
    const req=(path,options={})=>api.request(path,options);
    await api.setModule('FOOD',true);
    if(scenario==='qr'){
      try{
        const server=await window.artisysDesktop.dataServer.state();
        await window.artisysDesktop.dataServer.save({mode:'lan-host',host:'127.0.0.1',port:Number(server?.port||4174)},api.sessionToken);
      }catch{}
    }

    async function category(id,name){
      try{return await req('/api/v1/categories',{method:'POST',body:{id,name,active:true}});}catch{return null;}
    }
    async function product(input){
      return api.saveProduct({categoryId:null,unit:'UN',minimumStock:0,active:true,...input});
    }
    async function ingredient(id,name,sku,costCents,unit='UN'){
      const saved=await product({id,name,sku,unit,usageType:'INGREDIENT',salePriceCents:0,costCents,trackStock:true,menuEnabled:false});
      try{await api.saveInventoryMovement({productId:id,type:'adjustment-in',quantityDelta:20,reason:'Estoque tutorial Alimentação'});}catch{}
      return saved;
    }
    async function preparedRecipe({id,name,sku,components,notes=''}) {
      await product({id,name,sku,usageType:'DIRECT',salePriceCents:0,costCents:0,trackStock:false,menuEnabled:false});
      await req(`/api/v1/vertical/recipes/${encodeURIComponent(id)}`,{method:'PUT',body:{
        yieldQuantity:1,yieldUnit:'UN',portionQuantity:1,prepTimeMinutes:0,preparationNotes:notes,
        components:components.map(component=>({conversionFactor:1,lossPercent:0,...component}))
      }});
      return id;
    }
    async function ensureStation(){
      try{return await req('/api/v1/restaurant/kitchen/stations',{method:'POST',body:{id:'tutorial-kds',name:'Cozinha principal',printEnabled:false}});}
      catch{
        const rows=await req('/api/v1/restaurant/kitchen/stations');
        return rows.find(row=>row.id==='tutorial-kds')||rows[0];
      }
    }
    async function ensureBurgerIngredients(){
      await category('tutorial-cat-lanches','Lanches');
      await ingredient('tutorial-ingredient-bread','Pão Brioche','INS-BREAD',180);
      await ingredient('tutorial-ingredient-meat','Hambúrguer 160g','INS-MEAT',650);
      await ingredient('tutorial-ingredient-cheese','Queijo','INS-CHEESE',120);
      await ingredient('tutorial-ingredient-lettuce','Alface','INS-LETTUCE',60);
      await ingredient('tutorial-ingredient-tomato','Tomate','INS-TOMATO',90);
      await ingredient('tutorial-ingredient-sauce','Molho da casa','INS-SAUCE',80);
    }
    async function ensurePizzaIngredients(){
      await category('tutorial-cat-pizzas','Pizzas');
      await ingredient('tutorial-pizza-dough','Massa de pizza','PIZ-DOUGH',450);
      await ingredient('tutorial-pizza-tomato-sauce','Molho de tomate','PIZ-SAUCE',280,'LT');
      await ingredient('tutorial-pizza-mozzarella','Mussarela','PIZ-CHEESE',3500,'KG');
      await ingredient('tutorial-pizza-calabresa','Calabresa','PIZ-CAL',2800,'KG');
      await ingredient('tutorial-pizza-onion','Cebola','PIZ-ONION',500,'KG');
      await ingredient('tutorial-pizza-oregano','Orégano','PIZ-OREGANO',3000,'KG');
      await ingredient('tutorial-pizza-tomato','Tomate','PIZ-TOMATO',700,'KG');
      await ingredient('tutorial-pizza-basil','Manjericão','PIZ-BASIL',2500,'KG');
      await ingredient('tutorial-pizza-catupiry','Catupiry','PIZ-CATUPIRY',3200,'KG');
    }
    async function ensureFoodCatalog(){
      const station=await ensureStation();
      await category('tutorial-cat-lanches','Lanches');
      await product({id:'tutorial-food-main',name:'Hambúrguer Artesanal',sku:'FOOD-001',categoryId:'tutorial-cat-lanches',usageType:'DIRECT',salePriceCents:2790,costCents:980,trackStock:false,menuEnabled:true});
      await product({id:'tutorial-food-drink',name:'Refrigerante Lata',sku:'FOOD-002',usageType:'DIRECT',salePriceCents:700,costCents:250,trackStock:false,menuEnabled:true});
      await req('/api/v1/restaurant/kitchen/routing',{method:'POST',body:{productId:'tutorial-food-main',mode:'PRODUCTION',stationId:station.id||'tutorial-kds'}});
      await req('/api/v1/restaurant/kitchen/routing',{method:'POST',body:{productId:'tutorial-food-drink',mode:'DIRECT'}});
      await req('/api/v1/restaurant/public-ordering/menu/tutorial-food-main',{method:'PATCH',body:{description:'Pão brioche, hambúrguer 160g, queijo, alface, tomate e molho da casa.',visible:true}});
      await req('/api/v1/restaurant/public-ordering/menu/tutorial-food-drink',{method:'PATCH',body:{description:'Bebida gelada.',visible:true}});
      return station;
    }
    async function ensurePizzaCatalog(){
      const station=await ensureStation();
      await ensurePizzaIngredients();
      await product({id:'tutorial-pizza-main',name:'Pizza Artesanal',sku:'PIZZA-001',categoryId:'tutorial-cat-pizzas',usageType:'DIRECT',salePriceCents:3500,costCents:0,trackStock:false,menuEnabled:true});
      await req('/api/v1/vertical/recipes/tutorial-pizza-main',{method:'PUT',body:{
        yieldQuantity:1,yieldUnit:'UN',portionQuantity:1,prepTimeMinutes:20,
        preparationNotes:'Abrir a massa, aplicar o molho e finalizar conforme os sabores escolhidos.',
        components:[
          {productId:'tutorial-pizza-dough',quantity:1,unit:'UN',conversionFactor:1,lossPercent:0},
          {productId:'tutorial-pizza-tomato-sauce',quantity:0.2,unit:'LT',conversionFactor:1,lossPercent:0}
        ]
      }});
      await preparedRecipe({id:'tutorial-pizza-flavor-calabresa',name:'Sabor Calabresa',sku:'PIZ-FL-CAL',notes:'Cobertura de Calabresa.',components:[
        {productId:'tutorial-pizza-mozzarella',quantity:0.2,unit:'KG'},
        {productId:'tutorial-pizza-calabresa',quantity:0.15,unit:'KG'},
        {productId:'tutorial-pizza-onion',quantity:0.05,unit:'KG'},
        {productId:'tutorial-pizza-oregano',quantity:0.002,unit:'KG'}
      ]});
      await preparedRecipe({id:'tutorial-pizza-flavor-marguerita',name:'Sabor Marguerita',sku:'PIZ-FL-MAR',notes:'Cobertura de Marguerita.',components:[
        {productId:'tutorial-pizza-mozzarella',quantity:0.18,unit:'KG'},
        {productId:'tutorial-pizza-tomato',quantity:0.12,unit:'KG'},
        {productId:'tutorial-pizza-basil',quantity:0.01,unit:'KG'},
        {productId:'tutorial-pizza-oregano',quantity:0.002,unit:'KG'}
      ]});
      await preparedRecipe({id:'tutorial-pizza-crust-catupiry',name:'Borda Catupiry',sku:'PIZ-CR-CAT',notes:'Recheio da borda.',components:[
        {productId:'tutorial-pizza-catupiry',quantity:0.12,unit:'KG'}
      ]});
      await req('/api/v1/restaurant/kitchen/routing',{method:'POST',body:{productId:'tutorial-pizza-main',mode:'PRODUCTION',stationId:station.id||'tutorial-kds'}});
      await req('/api/v1/restaurant/public-ordering/menu/tutorial-pizza-main',{method:'PATCH',body:{description:'Massa artesanal e molho da casa. Escolha tamanho, sabores e borda.',visible:true}});
      return station;
    }
    async function ensurePizzaConfigured(){
      await ensurePizzaCatalog();
      await req('/api/v1/vertical/pizzeria/profile',{method:'POST',body:{productId:'tutorial-pizza-main',pricingPolicy:'HIGHEST_FLAVOR'}});
      await req('/api/v1/vertical/pizzeria/catalog',{method:'POST',body:{kind:'size',id:'tutorial-pizza-size-grande',productId:'tutorial-pizza-main',name:'Grande',maxFlavors:2,priceDeltaCents:500,recipeMultiplier:1.5}});
      await req('/api/v1/vertical/pizzeria/catalog',{method:'POST',body:{kind:'flavor',id:'tutorial-pizza-flavor-cal',productId:'tutorial-pizza-main',name:'Calabresa',priceDeltaCents:400,recipeProductId:'tutorial-pizza-flavor-calabresa'}});
      await req('/api/v1/vertical/pizzeria/catalog',{method:'POST',body:{kind:'flavor',id:'tutorial-pizza-flavor-mar',productId:'tutorial-pizza-main',name:'Marguerita',priceDeltaCents:200,recipeProductId:'tutorial-pizza-flavor-marguerita'}});
      await req('/api/v1/vertical/pizzeria/catalog',{method:'POST',body:{kind:'crust',id:'tutorial-pizza-crust-cat',productId:'tutorial-pizza-main',name:'Catupiry',priceDeltaCents:600,recipeProductId:'tutorial-pizza-crust-catupiry'}});
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
      await ensureStation();await ensureBurgerIngredients();
      return {terminalId:config.terminalId,operatorId};
    }
    if(scenario==='pizza-recipe'){
      await ensureStation();await ensurePizzaIngredients();
      return {terminalId:config.terminalId,operatorId};
    }
    if(scenario==='pizza-config'){
      await ensurePizzaCatalog();
      return {terminalId:config.terminalId,operatorId,demoPhotoProductId:'tutorial-pizza-main',demoPhotoKind:'pizza'};
    }
    if(['pizza-waiter','pizza-qr','pizza-kds-checkout'].includes(scenario)){
      await ensurePizzaConfigured();
      await ensureTable();
      await req('/api/v1/restaurant/public-ordering/config',{method:'PUT',body:{autoOpenTable:true,menuLayout:'PREMIUM'}});
      const vars={terminalId:config.terminalId,operatorId,demoPhotoProductId:'tutorial-pizza-main',demoPhotoKind:'pizza'};
      const qr=await req('/api/v1/restaurant/public-ordering/tables/tutorial-table-08/qr');vars.foodMenuUrl=qr.url;
      if(['pizza-waiter','pizza-kds-checkout'].includes(scenario)){
        const opened=await openTable();vars.restaurantSessionId=opened.session.id;
        const waiter=await device('tutorial-waiter','Garçom Tutorial','WAITER');vars.waiterId=waiter?.id||'tutorial-waiter';vars.waiterKey=waiter?.credential||'';
      }
      if(scenario==='pizza-kds-checkout'){
        const kitchen=await device('tutorial-kitchen','KDS Cozinha','KITCHEN');vars.kitchenId=kitchen?.id||'tutorial-kitchen';vars.kitchenKey=kitchen?.credential||'';
        await req(`/api/v1/restaurant/sessions/${encodeURIComponent(vars.restaurantSessionId)}/orders`,{method:'POST',body:{operatorId,items:[{
          productId:'tutorial-pizza-main',quantity:1,selections:[
            'tutorial-pizza-size-grande','tutorial-pizza-flavor-cal','tutorial-pizza-flavor-mar','tutorial-pizza-crust-cat'
          ],comboSelections:[]
        }]}});
        let cash=null;try{cash=await api.openCash(config.terminalId);}catch{}
        if(!cash){const openedCash=await api.createCash({terminalId:config.terminalId,initialCashCents:10000});cash=openedCash.session||openedCash;}
        vars.cashSessionId=cash.id;
      }
      return vars;
    }

    await ensureFoodCatalog();
    await ensureTable();
    await req('/api/v1/restaurant/public-ordering/config',{method:'PUT',body:{autoOpenTable:true,menuLayout:scenario==='appearance'?'COMPACT':'PREMIUM'}});

    const vars={terminalId:config.terminalId,operatorId,demoPhotoProductId:'tutorial-food-main',demoPhotoKind:'burger'};
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

  if(state.demoPhotoProductId){
    await attachDemoPhoto(page,{productId:state.demoPhotoProductId,kind:state.demoPhotoKind||'burger'});
  }
  runtimeContext.vars={...(runtimeContext.vars||{}),...state,desktopUrl};
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});
  await page.locator('#app-topbar').waitFor({state:'visible',timeout:15000});
}

export default {capabilities:{
  'tutorial.food.setup':async({page,step,runtimeContext})=>setupFood(page,step.scenario||'base',runtimeContext),
  'tutorial.food.photo':async({page,step,runtimeContext})=>{
    const productId=await attachDemoPhoto(page,{
      productId:step.productId||null,
      productName:step.productName||null,
      kind:step.kind||'burger',
      publish:step.publish!==false,
      description:step.description||''
    });
    runtimeContext.vars={...(runtimeContext.vars||{}),lastPhotoProductId:productId};
  }
}};
