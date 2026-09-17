'use strict';

function integer(value,fallback=0){
  if(value===undefined||value===null||value==='')return fallback;
  const number=Number(value);
  if(!Number.isInteger(number))throw new Error('Configuracao financeira deve usar numeros inteiros.');
  return number;
}

function feeBps(value){
  const result=integer(value,0);
  if(result<0||result>=10000)throw new Error('Taxa da adquirente deve ficar entre 0 e 9999 bps.');
  return result;
}

function days(value,fallback=0){
  const result=integer(value,fallback);
  if(result<0||result>3650)throw new Error('Prazo financeiro invalido.');
  return result;
}

function addDays(iso,count){
  const date=new Date(iso);
  if(!Number.isFinite(date.getTime()))throw new Error('Data de conclusao da venda invalida.');
  date.setUTCDate(date.getUTCDate()+count);
  return date.toISOString();
}

function splitCents(total,count){
  if(!Number.isInteger(total)||total<0)throw new Error('Valor em centavos invalido.');
  if(!Number.isInteger(count)||count<1)throw new Error('Quantidade de parcelas invalida.');
  const base=Math.floor(total/count);
  return Array.from({length:count},(_,index)=>index===count-1?total-base*(count-1):base);
}

function resolveAcquiringPolicy({method,amountCents,completedAt,metadata=null,settings={}}={}){
  const normalized=String(method||'').trim().toUpperCase();
  const amount=Number(amountCents);
  if(!Number.isInteger(amount)||amount<=0)throw new Error('Valor do recebivel deve ser maior que zero.');

  if(normalized==='DEBIT_CARD'){
    const bps=feeBps(settings.debitFeeBps);
    const fee=Math.round(amount*bps/10000);
    const net=amount-fee;
    if(net<=0)throw new Error('Taxa da adquirente consome todo o recebivel.');
    return [{
      sourceSuffix:'1',grossAmountCents:amount,feeAmountCents:fee,netAmountCents:net,
      dueAt:addDays(completedAt,days(settings.debitSettlementDays,0)),installmentNumber:1,installmentCount:1
    }];
  }

  if(normalized!=='CREDIT_CARD')throw new Error(`Politica de adquirencia nao suporta ${normalized||'forma vazia'}.`);
  const rawInstallments=metadata&&Object.prototype.hasOwnProperty.call(metadata,'installments')?Number(metadata.installments):1;
  if(!Number.isInteger(rawInstallments)||rawInstallments<1||rawInstallments>24)throw new Error('Quantidade de parcelas deve ficar entre 1 e 24.');
  if(rawInstallments>amount)throw new Error('Quantidade de parcelas excede o valor disponivel em centavos.');
  const bps=feeBps(settings.creditFeeBps);
  const totalFee=Math.round(amount*bps/10000);
  const totalNet=amount-totalFee;
  if(totalNet<=0)throw new Error('Taxa da adquirente consome todo o recebivel.');
  const grossParts=splitCents(amount,rawInstallments);
  const feeParts=splitCents(totalFee,rawInstallments);
  const firstDays=days(settings.creditFirstSettlementDays,0);
  const intervalDays=days(settings.creditIntervalDays,30);
  return grossParts.map((gross,index)=>{
    const fee=feeParts[index];
    return {
      sourceSuffix:String(index+1),
      grossAmountCents:gross,
      feeAmountCents:fee,
      netAmountCents:gross-fee,
      dueAt:addDays(completedAt,firstDays+index*intervalDays),
      installmentNumber:index+1,
      installmentCount:rawInstallments
    };
  });
}

module.exports={resolveAcquiringPolicy,splitCents,addDays};
