'use strict';
// Pix BR Code merchant-presented, no paid dependency.
// BCB Manual de Padroes para Iniciacao do Pix, static QR.
function field(id,value){
  const text=String(value);
  if(!/^\d{2}$/.test(id)||Buffer.byteLength(text,'utf8')>99)throw new Error('Campo BR Code invalido.');
  return id+String(Buffer.byteLength(text,'utf8')).padStart(2,'0')+text;
}
function crc16(data){
  let crc=0xffff;
  for(const byte of Buffer.from(data,'utf8')){
    crc^=byte<<8;
    for(let n=0;n<8;n++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4,'0');
}
function emvText(value,max,label){
  const clean=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9 .\-/]/g,' ').replace(/\s+/g,' ').trim().toUpperCase();
  if(!clean||Buffer.byteLength(clean)>max)throw new Error(label+' invalido.');
  return clean;
}
function buildStaticPix({key,merchantName,merchantCity,amountCents,txid='***'}={}){
  const pixKey=String(key||'').trim();
  if(!pixKey||Buffer.byteLength(pixKey,'utf8')>77||/[\x00-\x1f\x7f]/.test(pixKey))throw new Error('Chave Pix invalida.');
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>9999999999)throw new Error('Valor Pix invalido.');
  const identifier=String(txid||'***').trim();
  if(!/^(\*\*\*|[A-Za-z0-9]{1,25})$/.test(identifier))throw new Error('Identificador Pix invalido.');
  const account=field('00','br.gov.bcb.pix')+field('01',pixKey);
  const payload=field('00','01')+field('26',account)+field('52','0000')+field('53','986')
    +field('54',(amountCents/100).toFixed(2))+field('58','BR')
    +field('59',emvText(merchantName,25,'Nome do recebedor'))
    +field('60',emvText(merchantCity,15,'Cidade do recebedor'))
    +field('62',field('05',identifier))+'6304';
  return payload+crc16(payload);
}
module.exports={buildStaticPix,crc16};
