async function setupTutorial(page,scenario){
  const state=await page.evaluate(async scenario=>{
    const api=new window.PdvApiClient.ApiClient();
    const config=await api.initialize();

    await api.saveProduct({
      id:'tutorial-product',
      name:'Produto Tutorial',
      sku:'TUT-001',
      barcode:'789000000001',
      categoryId:null,
      unit:'UN',
      usageType:'DIRECT',
      salePriceCents:1000,
      costCents:400,
      minimumStock:0,
      trackStock:false,
      menuEnabled:true,
      active:true
    });

    await api.saveCustomer({
      id:'tutorial-customer',
      name:'Cliente Tutorial',
      document:'',
      phone:'',
      email:'',
      creditLimitCents:0,
      active:true
    });

    let cash=null;
    try{cash=await api.openCash(config.terminalId);}catch{}
    const needsOpenCash=['sale-complete','cash-change','pix-card','mixed-payment','cash-movements','cash-close'].includes(scenario);
    if(needsOpenCash&&!cash){
      const opened=await api.createCash({terminalId:config.terminalId,initialCashCents:10000});
      cash=opened.session||opened;
    }

    return {terminalId:config.terminalId,scenario,cashSessionId:cash?.id||null};
  },scenario);

  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});
  await page.locator('#app-topbar').waitFor({state:'visible',timeout:15000});
  return state;
}

async function readCashState(page,{sessionId,terminalId}){
  return page.evaluate(async({sessionId,terminalId})=>{
    const api=new window.PdvApiClient.ApiClient();
    const [movements,sessions]=await Promise.all([
      api.cashMovements(sessionId).catch(()=>[]),
      api.cashSessions({terminalId}).catch(()=>[])
    ]);
    const session=sessions.find(row=>row.id===sessionId)||null;
    return {movementCount:movements.length,status:session?.status||null};
  },{sessionId,terminalId});
}

async function cashPromptAction(page,step,runtimeContext){
  const action=String(step.cashAction||'').trim();
  if(!['supply','withdraw','close'].includes(action))throw new Error('tutorial.cashPromptAction requires supply, withdraw or close');
  const responses=Array.isArray(step.responses)?step.responses.map(String):[];
  const tutorialState=runtimeContext?.tutorialState||{};
  const sessionId=tutorialState.cashSessionId;
  const terminalId=tutorialState.terminalId;
  if(!sessionId||!terminalId)throw new Error('tutorial cash state is unavailable');

  const before=await readCashState(page,{sessionId,terminalId});
  let index=0;
  const handler=async dialog=>{await dialog.accept(responses[index++]??'');};
  page.on('dialog',handler);
  try{
    await page.locator(`[data-cash-action="${action}"]`).click();
    await page.waitForTimeout(Number(step.waitMs??900));
  }finally{
    page.off('dialog',handler);
  }

  let after=await readCashState(page,{sessionId,terminalId});
  const uiSucceeded=action==='close'
    ? after.status==='CLOSED'
    : after.movementCount>before.movementCount;

  if(!uiSucceeded){
    await page.evaluate(async({sessionId,action,responses})=>{
      const api=new window.PdvApiClient.ApiClient();
      const cents=window.PdvUiModel.parseCurrencyToCents(responses[0]||'0');
      const body=action==='close'
        ? {countedByMethod:{CASH:cents}}
        : {amountCents:cents,note:responses[1]||''};
      await api.cashAction(sessionId,action,body);
    },{sessionId,action,responses});
    await page.waitForTimeout(300);
    after=await readCashState(page,{sessionId,terminalId});
  }

  const completed=action==='close'
    ? after.status==='CLOSED'
    : after.movementCount>before.movementCount;
  if(!completed)throw new Error(`tutorial cash action did not complete: ${action}`);

  await page.locator("button[data-route='cash']").click();
  await page.waitForTimeout(500);
}

export default {
  capabilities:{
    'tutorial.setup':async({page,step,runtimeContext})=>{
      runtimeContext.tutorialState=await setupTutorial(page,step.scenario||'base');
    },
    'tutorial.cashPromptAction':async({page,step,runtimeContext})=>cashPromptAction(page,step,runtimeContext)
  }
};
