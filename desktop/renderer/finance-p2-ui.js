'use strict';

(()=>{
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  const installmentsByIndex=new Map();
  let settingsMounting=false;

  function toast(message,type='success'){
    const root=document.getElementById('toast-root');
    if(!root)return;
    const node=document.createElement('div');
    node.className=`toast ${type}`;
    node.textContent=message;
    root.appendChild(node);
    setTimeout(()=>node.remove(),3500);
  }

  function paymentLineIsCredit(line){
    return /Cartão crédito|Cartao credito|CREDIT_CARD/i.test(String(line?.textContent||''));
  }

  function installmentOptions(selected=1){
    return Array.from({length:24},(_,i)=>i+1).map(value=>`<option value="${value}" ${value===selected?'selected':''}>${value}x</option>`).join('');
  }

  function shiftAfterRemoval(index){
    const next=new Map();
    for(const [key,value] of installmentsByIndex.entries()){
      if(key<index)next.set(key,value);
      else if(key>index)next.set(key-1,value);
    }
    installmentsByIndex.clear();
    for(const [key,value] of next)installmentsByIndex.set(key,value);
  }

  function enhancePaymentModal(){
    const confirm=document.getElementById('confirm-payment');
    if(!confirm)return;
    const add=document.querySelector('.payment-add');
    const method=document.getElementById('new-payment-method');
    if(add&&method&&!document.getElementById('new-payment-installments-field')){
      const field=document.createElement('div');
      field.className='field';
      field.id='new-payment-installments-field';
      field.hidden=method.value!=='CREDIT_CARD';
      field.innerHTML=`<label>Parcelas</label><select id="new-payment-installments">${installmentOptions(1)}</select>`;
      const valueField=document.getElementById('new-payment-value')?.closest('.field');
      if(valueField)valueField.insertAdjacentElement('afterend',field);else add.appendChild(field);
      method.addEventListener('change',()=>{field.hidden=method.value!=='CREDIT_CARD';});
    }

    document.querySelectorAll('.payment-line').forEach((line,index)=>{
      if(!paymentLineIsCredit(line)||line.querySelector('[data-finance-installments]'))return;
      const selected=installmentsByIndex.get(index)||1;
      installmentsByIndex.set(index,selected);
      const select=document.createElement('select');
      select.className='ops-input compact';
      select.dataset.financeInstallments=String(index);
      select.setAttribute('aria-label',`Parcelas do pagamento ${index+1}`);
      select.innerHTML=installmentOptions(selected);
      select.addEventListener('change',()=>installmentsByIndex.set(index,Number(select.value)||1));
      const remove=line.querySelector('[data-remove-payment]');
      if(remove)line.insertBefore(select,remove);else line.appendChild(select);
    });
  }

  document.addEventListener('click',event=>{
    const add=event.target.closest?.('#add-payment');
    if(add){
      const method=document.getElementById('new-payment-method')?.value;
      if(method==='CREDIT_CARD'){
        const index=document.querySelectorAll('.payment-line').length;
        const installments=Number(document.getElementById('new-payment-installments')?.value||1);
        installmentsByIndex.set(index,installments);
      }
      return;
    }
    const remove=event.target.closest?.('[data-remove-payment]');
    if(remove&&document.getElementById('confirm-payment')){
      shiftAfterRemoval(Number(remove.dataset.removePayment));
      return;
    }
    if(event.target.closest?.('[data-close-modal]')&&document.getElementById('confirm-payment'))installmentsByIndex.clear();
  },true);

  const originalCompleteSale=ApiClient.prototype.completeSale;
  ApiClient.prototype.completeSale=function(id,payments){
    const enriched=(payments||[]).map((payment,index)=>{
      if(payment.method!=='CREDIT_CARD')return payment;
      const metadata = { ...(payment.metadata||{}), installments:installmentsByIndex.get(index)||1 };
      return {...payment,metadata};
    });
    const result=originalCompleteSale.call(this,id,enriched);
    return Promise.resolve(result).then(value=>{installmentsByIndex.clear();return value;});
  };

  function parsePercent(value){
    const number=Number(String(value??'0').trim().replace(',','.'));
    if(!Number.isFinite(number)||number<0||number>=100)throw new Error('Taxa deve ficar entre 0 e 99,99%.');
    return Math.round(number*100);
  }
  function parseDays(value,label){
    const number=Number(value);
    if(!Number.isInteger(number)||number<0||number>3650)throw new Error(`${label} deve ser um número inteiro entre 0 e 3650.`);
    return number;
  }

  async function ensureSettingsCard(){
    const page=document.querySelector('.ops-page');
    const title=page?.querySelector('.ops-head h1')?.textContent?.trim();
    if(title!=='Configurações'||document.getElementById('ops-acquiring-form')||settingsMounting)return;
    settingsMounting=true;
    const settings=await api.settings({prefix:'finance.acquiring.'}).catch(()=>null);
    if(!settings){settingsMounting=false;return;}
    if(document.getElementById('ops-acquiring-form')){settingsMounting=false;return;}
    const values=Object.fromEntries(settings.map(row=>[row.key,row.value]));
    const debitFee=Number(values['finance.acquiring.debit.feeBps']||0)/100;
    const debitDays=Number(values['finance.acquiring.debit.settlementDays']||0);
    const creditFee=Number(values['finance.acquiring.credit.feeBps']||0)/100;
    const creditFirst=Number(values['finance.acquiring.credit.firstSettlementDays']||0);
    const creditInterval=Number(values['finance.acquiring.credit.intervalDays']??30);
    const card=document.createElement('section');
    card.className='ops-card';
    card.id='ops-acquiring-card';
    card.innerHTML=`<h2>Cartões e recebíveis</h2><p class="ops-muted">Configure taxa e prazo da adquirente. O Caixa continua operacional; estes valores alimentam apenas os recebíveis do Financeiro.</p>
      <form id="ops-acquiring-form" class="ops-form">
        <label>Taxa débito (%)<input class="ops-input" name="debitFee" inputmode="decimal" value="${debitFee.toFixed(2).replace('.',',')}"></label>
        <label>Recebimento débito (dias)<input class="ops-input" name="debitDays" type="number" min="0" max="3650" value="${debitDays}"></label>
        <label>Taxa crédito (%)<input class="ops-input" name="creditFee" inputmode="decimal" value="${creditFee.toFixed(2).replace('.',',')}"></label>
        <label>Primeiro recebimento crédito (dias)<input class="ops-input" name="creditFirst" type="number" min="0" max="3650" value="${creditFirst}"></label>
        <label>Intervalo entre parcelas (dias)<input class="ops-input" name="creditInterval" type="number" min="0" max="3650" value="${creditInterval}"></label>
        <button class="ops-primary" type="submit">Salvar recebíveis</button>
      </form>`;
    page.appendChild(card);
    card.querySelector('#ops-acquiring-form').addEventListener('submit',async event=>{
      event.preventDefault();
      const form=new FormData(event.currentTarget);
      try{
        const entries=[
          ['finance.acquiring.debit.feeBps',parsePercent(form.get('debitFee'))],
          ['finance.acquiring.debit.settlementDays',parseDays(form.get('debitDays'),'Prazo do débito')],
          ['finance.acquiring.credit.feeBps',parsePercent(form.get('creditFee'))],
          ['finance.acquiring.credit.firstSettlementDays',parseDays(form.get('creditFirst'),'Primeiro recebimento do crédito')],
          ['finance.acquiring.credit.intervalDays',parseDays(form.get('creditInterval'),'Intervalo do crédito')]
        ];
        await Promise.all(entries.map(([key,value])=>api.saveSetting(key,value,'global')));
        toast('Configuração de recebíveis salva.','success');
      }catch(error){toast(error.message,'error');}
    });
    settingsMounting=false;
  }

  const observer=new MutationObserver(()=>{enhancePaymentModal();void ensureSettingsCard();});
  observer.observe(document.body,{subtree:true,childList:true});
  enhancePaymentModal();
  void ensureSettingsCard();
})();
