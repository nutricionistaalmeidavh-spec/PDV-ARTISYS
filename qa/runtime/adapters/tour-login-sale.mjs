import base from './tutorials-p1-p3.mjs';

// Playwright drives the real first-use tour; no duplicated tour screens or fake sale.
async function recordFullTour({page,runtimeContext}) {
  const panel=page.locator('.first-use-tour-panel');
  await panel.waitFor({state:'visible',timeout:15000});
  const visited=[];
  for(let index=0;index<10;index++){
    const title=(await panel.locator('h2').innerText()).trim();
    if(!title)throw new Error('Tour sem título no passo '+(index+1));
    visited.push(title);
    await page.waitForTimeout(1700);
    const next=panel.locator('[data-tour-next]');
    const final=(await next.innerText()).includes('Concluir');
    await next.click();
    if(final){
      await panel.waitFor({state:'detached',timeout:10000});
      break;
    }
    await panel.waitFor({state:'visible',timeout:10000});
    await page.waitForTimeout(250);
  }
  if(await panel.count())throw new Error('Tour não foi concluído em até 10 etapas');
  for(const expected of ['ponto de partida','Balcão','caixa']){
    if(!visited.some(title=>title.toLocaleLowerCase('pt-BR').includes(expected.toLocaleLowerCase('pt-BR'))))
      throw new Error('Etapa do tour ausente: '+expected+'. Visitas: '+visited.join(', '));
  }
  runtimeContext.vars={...(runtimeContext.vars||{}),tourVisited:visited};
  await page.waitForTimeout(950);
}

async function prepareCashOnly({page}) {
  // Isolated test fixture, never touches a customer installation.
  await page.evaluate(async()=>{
    const api=new window.PdvApiClient.ApiClient();
    const config=await api.initialize();
    const opened=await api.openCash(config.terminalId).catch(error=>{
      if(error?.status===404)return null;
      throw error;
    });
    if(!opened)await api.createCash({terminalId:config.terminalId,initialCashCents:10000});
  });
}

async function assertSaleCompleted({page}){
  const status=await page.evaluate(async()=>{
    const api=new window.PdvApiClient.ApiClient();
    const completed=await api.sales('COMPLETED',5);
    const rows=Array.isArray(completed)?completed:completed?.items||[];
    return rows.some(sale=>String(sale.status||'').toUpperCase()==='COMPLETED');
  });
  if(!status)throw new Error('Nenhuma venda concluída foi encontrada após a confirmação');
  await page.waitForTimeout(1300);
}

export default {
  ...base,
  capabilities:{
    ...base.capabilities,
    'tour.record':recordFullTour,
    'tutorial.cashFixture':prepareCashOnly,
    'tutorial.assertSaleCompleted':assertSaleCompleted
  }
};
