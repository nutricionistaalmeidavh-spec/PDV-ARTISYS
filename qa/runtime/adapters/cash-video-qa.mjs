// Test-only adapter. All financial operations run against the isolated Electron QA database.
// Browser navigation and every edit/annulment are performed through actual UI controls.
const base=async(page)=>new Promise(()=>page.waitForTimeout(100));
const saved = (context)=>context.vars||{};
async function videoFixture({page,runtimeContext}){
 const state=await page.evaluate(async()=>{
  const api=new window.PdvApiClient.ApiClient();
  const config=await api.initialize();
  let existing=null;
  try{existing=await api.openCash(config.terminalId)}catch(e){if(e.status!==404)throw e}
  if(existing)throw Error('Isolated QA must start without an active cash session');
  const opened=await api.createCash({terminalId:config.terminalId,initialCashCents:0});
  const session=opened.session||opened;
  if(!session?.id)throw Error('Cash fixture session id missing');
  const product=await api.saveProduct({
    id:'cash-video-product',name:'Produto Exemplo do Caixa',sku:'CASH-VIDEO',
    barcode:'7890000123456',categoryId:null,unit:'UN',usageType:'DIRECT',
    salePriceCents:1000,costCents:500,minimumStock:0,trackStock:true,menuEnabled:true,active:true
  });
  await api.saveInventoryMovement({
    productId:product.id,type:'adjustment-in',quantityDelta:3,reason:'Teste tutorial de caixas'
  });
  const sale=await api.openSale({
    saleNumber:'CX-VIDEO-'+Date.now(),terminalId:config.terminalId,
    sellerId:(await api.currentSession()).user?.id||'qaadmin'
  });
  const withItem=await api.addSaleItem(sale.id,product.id,1);
  await api.completeSale(withItem.id,[{method:'PIX',amountCents:1000}]);
  await api.cashAction(session.id,'close',{countedByMethod:{CASH:0}});
  const details=await api.cashDetails(session.id);
  if(details.status!=='CLOSED'||details.canAnnul!==false)
    throw Error('Sale-backed cash must be closed and protected from annulment: '+JSON.stringify({status:details.status,canAnnul:details.canAnnul}));
  return {linkedCashId:session.id,terminalId:config.terminalId};
 });
 runtimeContext.vars={...saved(runtimeContext),...state};
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});
 await page.locator('#app-topbar').waitFor({state:'visible',timeout:15000});
}
async function openDetails({page,runtimeContext,which}){
 const key=which==='linked'?'linkedCashId':'emptyCashId';
 const id=saved(runtimeContext)[key];
 if(!id)throw Error('Cash ID not prepared: '+key);
 const button=page.locator('[data-cash-details]').filter({visible:true}).and(page.locator('[data-cash-details="'+id+'"]'));
 await button.waitFor({state:'visible',timeout:10000});
 await button.click();
 const host=page.locator('#ops-cash-details');
 await host.getByText('Detalhes do caixa '+id).waitFor({state:'visible',timeout:10000});
 await host.locator('.ops-card-head').scrollIntoViewIfNeeded();
 await page.waitForTimeout(750);
}
async function blocked({page,runtimeContext}){
 const id=saved(runtimeContext).linkedCashId;
 const ui=page.locator('#ops-cash-details');
 const text=await ui.innerText();
 if(!text.includes('Anulação indisponível')||await ui.locator('[data-manage-cash="annul"]').count())
  throw Error('Sale-backed cash unexpectedly offers annulment');
 const d=await page.evaluate(async id=>new window.PdvApiClient.ApiClient().cashDetails(id),id);
 if(d.canAnnul!==false)throw Error('Server does not protect completed sale');
 await page.waitForTimeout(1300);
}
async function corrected({page,runtimeContext}){
 const id=saved(runtimeContext).linkedCashId;
 const d=await page.evaluate(async id=>new window.PdvApiClient.ApiClient().cashDetails(id),id);
 if(d.status!=='CLOSED'||!d.corrections?.some(c=>c.countedCashCents===200))
  throw Error('Correction not persisted with audit');
 const host=page.locator('#ops-cash-details');
 await host.getByText('Correções auditadas').scrollIntoViewIfNeeded();
 if(!(await host.innerText()).includes('Conferência de teste'))throw Error('Correction missing from visible audit');
 await page.waitForTimeout(1400);
}
async function trackEmpty({page,runtimeContext}){
 const s=await page.evaluate(async()=> {
  const api=new window.PdvApiClient.ApiClient();const cfg=await api.initialize();
  return api.openCash(cfg.terminalId);
 });
 if(!s?.id)throw Error('No new open test cash found');
 runtimeContext.vars={...saved(runtimeContext),emptyCashId:s.id};
 await page.waitForTimeout(450);
}
async function verifiedAnnul({page,runtimeContext}){
 const id=saved(runtimeContext).emptyCashId;
 const data=await page.evaluate(async id=>{
   const api=new window.PdvApiClient.ApiClient();
   const detail=await api.cashDetails(id);
   const sessions=await api.cashSessions({});
   return {detail,listed:sessions.some(s=>s.id===id&&s.status==='ANNULLED')};
 },id);
 if(data.detail.status!=='ANNULLED'||!data.listed)
   throw Error('Empty cash was not annulled and preserved in history');
 const body=await page.locator('#ops-cash-details').innerText();
 if(!body.includes('Anulado')||!body.includes('Anulação'))
   throw Error('Annulment audit not shown in UI');
 await page.locator('#ops-cash-details .ops-card-head').scrollIntoViewIfNeeded();
 await page.waitForTimeout(1400);
}
export default {capabilities:{
  'cash.videoFixture':videoFixture,
  'cash.openLinkedDetails':arg=>openDetails({...arg,which:'linked'}),
  'cash.blockedAnnul':blocked,
  'cash.verifiedCorrection':corrected,
  'cash.trackEmptyOpen':trackEmpty,
  'cash.openEmptyDetails':arg=>openDetails({...arg,which:'empty'}),
  'cash.verifiedAnnul':verifiedAnnul
}};
