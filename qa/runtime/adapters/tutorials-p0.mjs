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

async function cashPromptAction(page,step){
  const action=String(step.cashAction||'').trim();
  if(!['supply','withdraw','close'].includes(action))throw new Error('tutorial.cashPromptAction requires supply, withdraw or close');
  const responses=Array.isArray(step.responses)?step.responses.map(String):[];
  let index=0;
  const handler=async dialog=>{await dialog.accept(responses[index++]??'');};
  page.on('dialog',handler);
  try{
    await page.locator(`[data-cash-action="${action}"]`).click();
    await page.waitForTimeout(Number(step.waitMs??700));
  }finally{
    page.off('dialog',handler);
  }
}

export default {
  capabilities:{
    'tutorial.setup':async({page,step,runtimeContext})=>{
      runtimeContext.tutorialState=await setupTutorial(page,step.scenario||'base');
    },
    'tutorial.cashPromptAction':async({page,step})=>cashPromptAction(page,step)
  }
};
