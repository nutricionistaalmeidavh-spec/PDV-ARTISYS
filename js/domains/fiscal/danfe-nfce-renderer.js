'use strict';

function money(cents){return (Number(cents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function groupKey(value){return String(value||'').replace(/\D/g,'').replace(/(.{4})/g,'$1 ').trim();}
function fit(value,width){const text=String(value??'');return text.length<=width?text:`${text.slice(0,Math.max(0,width-1))}…`;}
function center(value,width){const text=fit(value,width);const left=Math.max(0,Math.floor((width-text.length)/2));return `${' '.repeat(left)}${text}`;}
function line(width,char='-'){return char.repeat(width);}
function wrap(value,width){const words=String(value??'').trim().split(/\s+/).filter(Boolean);if(!words.length)return[];const lines=[];let current='';for(const word of words){if(!current){current=word;continue;}if(`${current} ${word}`.length<=width){current+=` ${word}`;}else{lines.push(fit(current,width));current=word;}}if(current)lines.push(fit(current,width));return lines;}
function quantity(value){return Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});}

function renderDanfeNfce({document,width=42}={}){
  const cols=[32,42,48].includes(Number(width))?Number(width):42;
  if(!document||document.documentType!=='nfce')throw new Error('DANFE NFC-e exige documento NFC-e.');
  if(!['AUTHORIZED','CANCELLED'].includes(String(document.lifecycleStatus||'')))throw new Error('DANFE NFC-e exige documento autorizado ou cancelado.');
  const payload=document.requestPayload||{};const issuer=payload.issuer||{};const identification=payload.identification||{};const items=Array.isArray(payload.items)?payload.items:[];const totals=payload.totals||{};const payments=Array.isArray(payload.payments)?payload.payments:[];
  if(!document.accessKey)throw new Error('DANFE NFC-e exige chave de acesso.');
  const out=[];
  out.push(center('DANFE NFC-e',cols),center('Documento Auxiliar da NFC-e',cols),line(cols));
  if(document.lifecycleStatus==='CANCELLED')out.push(center('*** DOCUMENTO CANCELADO ***',cols),line(cols));
  out.push(...wrap(issuer.tradeName||issuer.legalName||'Emitente',cols));
  if(issuer.cnpj)out.push(`CNPJ: ${fit(issuer.cnpj,cols-6)}`);
  out.push(`NFC-e nº ${identification.number||document.number||'—'}  Série ${identification.series||document.series||'—'}`,line(cols));
  out.push('ITEM  QTD x UNIT.                  TOTAL');
  for(const item of items){
    out.push(...wrap(`${item.code||''} ${item.description||'Item'}`.trim(),cols));
    const left=`${quantity(item.quantity)} x ${money(item.unitPriceCents)}`;const right=`R$ ${money(item.totalCents)}`;const spaces=Math.max(1,cols-left.length-right.length);out.push(fit(`${left}${' '.repeat(spaces)}${right}`,cols));
    if(Number(item.discountCents||0)>0)out.push(fit(`  Desconto: R$ ${money(item.discountCents)}`,cols));
  }
  out.push(line(cols),fit(`Subtotal: R$ ${money(totals.subtotalCents)}`,cols));
  if(Number(totals.discountCents||0)>0)out.push(fit(`Desconto: R$ ${money(totals.discountCents)}`,cols));
  out.push(fit(`TOTAL: R$ ${money(totals.totalCents)}`,cols));
  for(const payment of payments)out.push(fit(`Pagamento ${payment.method||'OUTRO'}: R$ ${money(payment.amountCents)}`,cols));
  if(Number(totals.changeCents||0)>0)out.push(fit(`Troco: R$ ${money(totals.changeCents)}`,cols));
  out.push(line(cols),'CHAVE DE ACESSO',...wrap(groupKey(document.accessKey),cols));
  if(document.authorizationProtocol)out.push(...wrap(`Protocolo de autorização: ${document.authorizationProtocol}`,cols));
  const qr=document.providerResponse?.qrCodeUrl||document.providerResponse?.qrcode||document.providerResponse?.qrCode||null;
  if(qr)out.push(line(cols),'Consulta via QR Code:',...wrap(qr,cols));else out.push(line(cols),...wrap('Consulte a NFC-e pela chave de acesso no portal fiscal aplicável.',cols));
  out.push(line(cols));
  return `${out.join('\n')}\n`;
}

module.exports={renderDanfeNfce};
