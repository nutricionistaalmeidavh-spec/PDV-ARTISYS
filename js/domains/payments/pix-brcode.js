'use strict';

function emv(id, value) {
  const text=String(value??'');
  const length=Buffer.byteLength(text,'utf8');
  if(length>99)throw new Error(`Campo Pix ${id} excede 99 bytes.`);
  return `${id}${String(length).padStart(2,'0')}${text}`;
}

function normalizeMerchant(value,maxLength){
  return String(value||'')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toUpperCase().replace(/[^A-Z0-9 .\-]/g,' ')
    .replace(/\s+/g,' ').trim().slice(0,maxLength);
}

function normalizeTxid(value){
  const text=String(value||'***').replace(/[^A-Za-z0-9]/g,'').slice(0,25);
  return text||'***';
}

function crc16Ccitt(text){
  let crc=0xffff;
  const bytes=Buffer.from(String(text),'utf8');
  for(const byte of bytes){
    crc^=byte<<8;
    for(let bit=0;bit<8;bit++)crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1);
    crc&=0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}

function buildPixPayload({pixKey,merchantName,merchantCity,amountCents,txid='***',description=''}={}){
  const key=String(pixKey||'').trim();if(!key)throw new Error('Chave Pix obrigatoria.');
  const name=normalizeMerchant(merchantName,25);if(!name)throw new Error('Nome do recebedor Pix obrigatorio.');
  const city=normalizeMerchant(merchantCity,15);if(!city)throw new Error('Cidade do recebedor Pix obrigatoria.');
  const cents=Number(amountCents);if(!Number.isSafeInteger(cents)||cents<=0)throw new Error('Valor Pix invalido.');
  const merchantAccount=[emv('00','BR.GOV.BCB.PIX'),emv('01',key)];
  const desc=String(description||'').trim();if(desc)merchantAccount.push(emv('02',normalizeMerchant(desc,60)));
  const additional=emv('05',normalizeTxid(txid));
  const amount=(cents/100).toFixed(2);
  const base=[
    emv('00','01'),
    emv('26',merchantAccount.join('')),
    emv('52','0000'),
    emv('53','986'),
    emv('54',amount),
    emv('58','BR'),
    emv('59',name),
    emv('60',city),
    emv('62',additional),
    '6304'
  ].join('');
  return `${base}${crc16Ccitt(base)}`;
}

module.exports={emv,crc16Ccitt,buildPixPayload,normalizeMerchant,normalizeTxid};
