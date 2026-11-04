'use strict';
// QR Model 2 Version 10-L: offline, 57x57, 274 payload codewords, four RS blocks.
// Dedicated to Pix BR Codes, which exceed the capacity of the smaller LAN QR utility.
const VERSION=10,SIZE=57,DATA_CODEWORDS=274,ECC_WORDS=18;
function gfMul(x,y){let z=0;for(let i=7;i>=0;i--){z=(z<<1)^((z>>>7)*0x11d);if(((y>>>i)&1)!==0)z^=x;}return z&255;}
function generator(degree){const result=new Uint8Array(degree);result[degree-1]=1;let root=1;for(let i=0;i<degree;i++){for(let j=0;j<degree;j++){result[j]=gfMul(result[j],root);if(j+1<degree)result[j]^=result[j+1];}root=gfMul(root,2);}return result;}
function ecc(data){const divisor=generator(ECC_WORDS),rem=new Uint8Array(ECC_WORDS);for(const byte of data){const factor=byte^rem[0];rem.copyWithin(0,1);rem[ECC_WORDS-1]=0;for(let i=0;i<ECC_WORDS;i++)rem[i]^=gfMul(divisor[i],factor);}return rem;}
function pushBits(bits,value,length){for(let i=length-1;i>=0;i--)bits.push((value>>>i)&1);}
function codewords(text){
  const bytes=Buffer.from(String(text),'utf8');
  if(bytes.length>271)throw new Error('Pix BR Code excede capacidade do QR local.');
  const bits=[];pushBits(bits,4,4);pushBits(bits,bytes.length,16);
  for(const byte of bytes)pushBits(bits,byte,8);
  pushBits(bits,0,Math.min(4,DATA_CODEWORDS*8-bits.length));
  while(bits.length%8)bits.push(0);
  const data=[];for(let i=0;i<bits.length;i+=8){let value=0;for(let j=0;j<8;j++)value=(value<<1)|bits[i+j];data.push(value);}
  for(let i=0;data.length<DATA_CODEWORDS;i++)data.push(i%2?0x11:0xec);
  const lengths=[68,68,69,69],blocks=[],parity=[];let offset=0;
  for(const length of lengths){const part=data.slice(offset,offset+length);blocks.push(part);parity.push(ecc(part));offset+=length;}
  const result=[];for(let i=0;i<69;i++)for(const block of blocks)if(i<block.length)result.push(block[i]);
  for(let i=0;i<ECC_WORDS;i++)for(const block of parity)result.push(block[i]);
  if(result.length!==346)throw new Error('QR local: quantidade de codewords inesperada.');
  return result;
}
function formatBits(mask=0){
  const data=(1<<3)|mask;let rem=data<<10;
  for(let i=14;i>=10;i--)if(((rem>>>i)&1)!==0)rem^=0x537<<(i-10);
  return((data<<10)|(rem&0x3ff))^0x5412;
}
function versionBits(){
  let rem=VERSION<<12;for(let i=17;i>=12;i--)if(((rem>>>i)&1)!==0)rem^=0x1f25<<(i-12);
  return(VERSION<<12)|(rem&0xfff);
}
function makeMatrix(text){
  const modules=Array.from({length:SIZE},()=>Array(SIZE).fill(false));
  const reserved=Array.from({length:SIZE},()=>Array(SIZE).fill(false));
  const set=(x,y,dark=true)=>{if(x>=0&&y>=0&&x<SIZE&&y<SIZE){modules[y][x]=Boolean(dark);reserved[y][x]=true;}};
  function finder(cx,cy){
    for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){
      const distance=Math.max(Math.abs(dx),Math.abs(dy));
      set(cx+dx,cy+dy,distance!==2&&distance!==4);
    }
  }
  finder(3,3);finder(SIZE-4,3);finder(3,SIZE-4);
  for(let i=0;i<SIZE;i++){if(!reserved[6][i])set(i,6,i%2===0);if(!reserved[i][6])set(6,i,i%2===0);}
  for(const y of [6,28,50])for(const x of [6,28,50]){
    if((x===6&&y===6)||(x===6&&y===50)||(x===50&&y===6))continue;
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)
      set(x+dx,y+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
  }
  // Reserve format-information modules before data placement.
  for(let i=0;i<=5;i++)set(8,i,false);
  set(8,7,false);set(8,8,false);set(7,8,false);
  for(let i=9;i<15;i++)set(14-i,8,false);
  for(let i=0;i<8;i++)set(SIZE-1-i,8,false);
  for(let i=8;i<15;i++)set(8,SIZE-15+i,false);
  set(8,SIZE-8,true);
  const ver=versionBits();
  for(let i=0;i<18;i++){const x=SIZE-11+(i%3),y=Math.floor(i/3),bit=((ver>>>i)&1)!==0;set(x,y,bit);set(y,x,bit);}
  const bits=[];for(const byte of codewords(text))pushBits(bits,byte,8);
  let index=0,upward=true;
  for(let right=SIZE-1;right>=1;right-=2){
    if(right===6)right--;
    for(let vert=0;vert<SIZE;vert++){
      const y=upward?SIZE-1-vert:vert;
      for(let j=0;j<2;j++){
        const x=right-j;if(reserved[y][x])continue;
        let dark=index<bits.length?Boolean(bits[index++]):false;
        if((x+y)%2===0)dark=!dark;
        modules[y][x]=dark;
      }
    }
    upward=!upward;
  }
  const fmt=formatBits();const bit=i=>((fmt>>>i)&1)!==0;
  for(let i=0;i<=5;i++)set(8,i,bit(i));
  set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
  for(let i=9;i<15;i++)set(14-i,8,bit(i));
  for(let i=0;i<8;i++)set(SIZE-1-i,8,bit(i));
  for(let i=8;i<15;i++)set(8,SIZE-15+i,bit(i));
  set(8,SIZE-8,true);
  return modules;
}
function escapeXml(value){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));}
function pixQrSvg(text,{scale=5,border=4}={}){
  const matrix=makeMatrix(text),size=SIZE+border*2,rects=[];
  for(let y=0;y<SIZE;y++)for(let x=0;x<SIZE;x++)if(matrix[y][x])rects.push('<rect x="'+(x+border)+'" y="'+(y+border)+'" width="1" height="1"/>');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+size+' '+size+'" width="'+size*scale+'" height="'+size*scale+'" shape-rendering="crispEdges" data-qr-payload="'+escapeXml(text)+'"><rect width="100%" height="100%" fill="white"/><g fill="black">'+rects.join('')+'</g></svg>';
}
module.exports={pixQrSvg,makeMatrix,codewords,VERSION,SIZE};
