'use strict';
const https=require('node:https');
const {readFileSync}=require('node:fs');

function createPixApiProvider({
  baseUrl,pixKey,tokenProvider,certPath=null,keyPath=null,caPath=null,
  requestImpl=null,timeoutMs=15000
}={}){
  const origin=new URL(String(baseUrl||''));
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.search||origin.hash)
    throw new Error('API Pix exige endpoint HTTPS sem credenciais na URL.');
  if(!pixKey||typeof tokenProvider!=='function')throw new Error('Chave e tokenProvider do banco Pix sao obrigatorios.');
  const agent=new https.Agent({keepAlive:false,cert:certPath?readFileSync(certPath):undefined,
    key:keyPath?readFileSync(keyPath):undefined,ca:caPath?readFileSync(caPath):undefined,
    rejectUnauthorized:true});
  async function nativeRequest(method,path,body,token){
    const endpoint=new URL(path,origin.href.endsWith('/')?origin.href:origin.href+'/');
    if(endpoint.origin!==origin.origin)throw new Error('URL Pix fora do provedor configurado.');
    return new Promise((resolve,reject)=>{
      const req=https.request(endpoint,{method,agent,timeout:timeoutMs,headers:{
        'authorization':'Bearer '+token,'accept':'application/json',
        ...(body?{'content-type':'application/json'}:{})
      }},res=>{
        const chunks=[];let size=0;
        res.on('data',part=>{size+=part.length;if(size>1024*1024){req.destroy(new Error('Resposta Pix excede limite.'));return;}chunks.push(part);});
        res.on('end',()=>{let response={};try{response=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reject(new Error('Banco Pix retornou JSON invalido.'));}
          if(res.statusCode<200||res.statusCode>=300)return reject(new Error('Banco Pix rejeitou requisicao (HTTP '+res.statusCode+').'));
          resolve(response);
        });
      });
      req.once('error',reject);req.once('timeout',()=>req.destroy(new Error('Timeout bancario indeterminado.')));
      req.end(body?JSON.stringify(body):undefined);
    });
  }
  async function request(method,path,body){
    const token=await tokenProvider();
    if(typeof token!=='string'||token.length<12)throw new Error('Token bancario nao configurado.');
    return(requestImpl||nativeRequest)(method,path,body,token);
  }
  const amount=centavos=>{
    if(!Number.isSafeInteger(centavos)||centavos<=0)throw new Error('Valor Pix invalido.');
    return(centavos/100).toFixed(2);
  };
  return{
    async start({txid,amountCents}){
      if(!/^[A-Za-z0-9]{26,35}$/.test(String(txid)))throw new Error('txid invalido.');
      const cob=await request('PUT','cob/'+encodeURIComponent(txid),{
        calendario:{expiracao:3600},valor:{original:amount(amountCents)},chave:String(pixKey)
      });
      if(cob.txid!==txid)throw new Error('Banco respondeu com txid divergente.');
      let brCode=cob.pixCopiaECola||cob.qrcode||'';
      if(!brCode&&cob.loc?.id){
        const qr=await request('GET','loc/'+encodeURIComponent(cob.loc.id)+'/qrcode');
        brCode=qr.qrcode||qr.pixCopiaECola||'';
      }
      if(!brCode)throw new Error('Banco nao forneceu Pix Copia e Cola.');
      return{txid,brCode:String(brCode)};
    },
    async verify({txid,amountCents}){
      const cob=await request('GET','cob/'+encodeURIComponent(txid));
      if(cob.txid!==txid)throw new Error('Cobranca bancaria com txid divergente.');
      if(cob.status!=='CONCLUIDA')return{status:'PENDING',txid};
      const entries=Array.isArray(cob.pix)?cob.pix:[];
      const cents=v=>{
        if(!/^\d+\.\d{2}$/.test(String(v)))throw new Error('Valor bancario invalido.');
        const [whole,fraction]=String(v).split('.');
        return Number(whole)*100+Number(fraction);
      };
      if(entries.length!==1||!entries[0].endToEndId||cents(entries[0].valor)!==amountCents)
        throw new Error('Cobranca com liquidacao multipla ou valor divergente: reconciliacao manual.');
      return{status:'PAID',txid,amountCents,endToEndId:String(entries[0].endToEndId)};
    }
  };
}
module.exports={createPixApiProvider};
