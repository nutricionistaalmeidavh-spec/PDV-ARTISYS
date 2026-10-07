async function setupTutorial(page,scenario,runtimeContext){
  const state=await page.evaluate(async scenario=>{
    const api=new window.PdvApiClient.ApiClient();
    const config=await api.initialize();
    await api.saveProduct({
      id:'tutorial-product',name:'Produto Tutorial',sku:'TUT-001',barcode:'789000000001',
      categoryId:null,unit:'UN',usageType:'DIRECT',salePriceCents:1000,costCents:400,
      minimumStock:0,trackStock:false,menuEnabled:true,active:true
    });
    await api.saveCustomer({
      id:'tutorial-customer',name:'Cliente Tutorial',document:'',phone:'',email:'',
      creditLimitCents:0,active:true
    });

    let cash=null;try{cash=await api.openCash(config.terminalId);}catch{}
    if(scenario==='cash-closed'&&cash){
      const expected=Number(cash.expectedCashCents??cash.initialCashCents??0);
      await api.cashAction(cash.id,'close',{countedByMethod:{CASH:expected}});
      cash=null;
    }
    const needsOpenCash=['sale-complete','cash-change','pix-card','mixed-payment','cash-movements','cash-close'].includes(scenario);
    if(needsOpenCash&&!cash){
      const opened=await api.createCash({terminalId:config.terminalId,initialCashCents:10000});
      cash=opened.session||opened;
    }
    return {terminalId:config.terminalId,scenario,cashSessionId:cash?.id||null};
  },scenario);

  runtimeContext.vars={...(runtimeContext.vars||{}),...state};
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});
  await page.locator('#app-topbar').waitFor({state:'visible',timeout:15000});
}

export default {capabilities:{
  'tutorial.setup':async({page,step,runtimeContext})=>setupTutorial(page,step.scenario||'base',runtimeContext)
}};
