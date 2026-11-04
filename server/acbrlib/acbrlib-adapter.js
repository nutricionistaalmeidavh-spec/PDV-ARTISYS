'use strict';
// ACBrLib native adapter. Ported from ArtiSys Oficina's local ACBrLib integration.
// This bridge is OFF by default and cannot enable fiscal issuance by itself.
// Official SEFAZ authorization and production homologation are separate gates.
const {spawn}=require('node:child_process');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const REF=/^[A-Za-z0-9._-]{1,80}$/;
const HASH=/^[a-f0-9]{64}$/;
const CNPJ=/^[A-Z0-9]{14}$/;
const ACCESS_KEY=/^\d{44}$/;
const PROVIDER_ID='acbrlib-native';
function localFile(file,label){
  if(!path.isAbsolute(String(file||'')))throw Error(label+': caminho absoluto obrigatório');
  const actual=fs.realpathSync(file);
  if(!fs.statSync(actual).isFile())throw Error(label+': arquivo inválido');
  return actual;
}
function localDirectory(dir){
  if(!path.isAbsolute(String(dir||'')))throw Error('Diretório fiscal absoluto obrigatório');
  const actual=fs.realpathSync(dir);
  if(!fs.statSync(actual).isDirectory())throw Error('Diretório fiscal inválido');
  return actual;
}
function inside(dir,file){
  const relative=path.relative(dir,file);
  return relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);
}
function readManifest(dir,reference){
  if(!REF.test(String(reference||'')))throw Error('Referência fiscal inválida');
  const ini=localFile(path.join(dir,reference+'.ini'),'INI fiscal');
  const manifestFile=localFile(path.join(dir,reference+'.json'),'Manifesto fiscal');
  if(!inside(dir,ini)||!inside(dir,manifestFile))throw Error('Arquivo fiscal fora do diretório autorizado');
  if(fs.statSync(ini).size<12||fs.statSync(ini).size>1024*1024||fs.statSync(manifestFile).size>16384)
    throw Error('Tamanho de INI/manifesto fiscal inválido');
  const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(!manifest||Array.isArray(manifest)||typeof manifest!=='object')throw Error('Manifesto fiscal inválido');
  const contentHash=createHash('sha256').update(fs.readFileSync(ini)).digest('hex');
  if(!HASH.test(String(manifest.iniSha256||''))||manifest.iniSha256!==contentHash)
    throw Error('INI fiscal diverge do SHA-256 aprovado');
  if(manifest.reference!==reference||!['nfe','nfce'].includes(manifest.documentType)||
     !HASH.test(String(manifest.snapshotHash||''))||
     !Number.isSafeInteger(manifest.amountCents)||manifest.amountCents<=0||
     !CNPJ.test(String(manifest.issuerCnpj||'').toUpperCase())||
     !['homologation','production'].includes(manifest.environment)||
     !Number.isSafeInteger(manifest.lot)||manifest.lot<=0||manifest.lot>999999999||
     !Number.isSafeInteger(manifest.number)||manifest.number<1||manifest.number>999999999||
     !Number.isSafeInteger(manifest.series)||manifest.series<1||manifest.series>999||
     !/^\d{8}$/.test(String(manifest.cNF||''))||
     !Number.isSafeInteger(manifest.model)||
     manifest.model!==(manifest.documentType==='nfce'?65:55))
    throw Error('Manifesto fiscal incompleto ou inconsistente');
  return{iniPath:ini,manifest};
}
function sameSnapshot(document,manifest){
  if(!document||typeof document!=='object'||Array.isArray(document))return false;
  return ['reference','documentType','snapshotHash','amountCents','issuerCnpj','environment','lot','model','number','series','cNF']
    .every(key=>document[key]===manifest[key]);
}
function unknown(){
  return{ok:false,status:503,indeterminate:true,data:null,error:'Resultado fiscal não confirmado. Consulte a situação na SEFAZ antes de qualquer reenvio.'};
}
function blocked(reason){
  return{ok:false,status:503,data:null,error:reason};
}
function xmlField(xml,field){
  const expression=new RegExp('<(?:[A-Za-z0-9_]+:)?'+field+'(?:\\s[^>]*)?>\\s*([^<]+)\\s*</(?:[A-Za-z0-9_]+:)?'+field+'\\s*>','i');
  return expression.exec(xml)?.[1]?.trim()||'';
}
function xmlValueCents(text){
  const match=/^([0-9]{1,13})\.([0-9]{2})$/.exec(String(text||''));
  if(!match)return null;
  const cents=Number(match[1])*100+Number(match[2]);
  return Number.isSafeInteger(cents)?cents:null;
}
function accessKeyMatches(key,manifest){
 if(!ACCESS_KEY.test(key))return false;
 let weight=2,sum=0;
 for(let i=42;i>=0;i--){sum+=Number(key[i])*weight;weight=weight===9?2:weight+1;}
 const v=11-(sum%11),digit=v>=10?0:v;
 return Number(key[43])===digit&&
  key.slice(6,20)===manifest.issuerCnpj&&
  key.slice(20,22)===String(manifest.model)&&
  Number(key.slice(22,25))===manifest.series&&
  Number(key.slice(25,34))===manifest.number&&
  key.slice(34,35)==='1'&&
  key.slice(35,43)===manifest.cNF;
}
function validated(result,manifest){
  if(!result||typeof result!=='object'||result.status!=='AUTORIZADA')return unknown();
  const xml=String(result.xml||'');
  const key=String(result.accessKey||'');
  const protocol=String(result.protocol||'');
  const environment=manifest.environment==='homologation'?'HOMOLOGACAO':'PRODUCAO';
  const xmlEnvironment=environment==='HOMOLOGACAO'?'2':'1';
  // The native worker separately parses and verifies signature, protocol and XML totals.
  // These checks prevent a malformed worker response becoming AUTHORIZED in the PDV.
  if(!accessKeyMatches(key,manifest)||!/^\d{10,20}$/.test(protocol)||result.environment!==environment||
     xmlField(xml,'mod')!==String(manifest.model)||
     Number(xmlField(xml,'nNF'))!==manifest.number||
     Number(xmlField(xml,'serie'))!==manifest.series||
     xmlField(xml,'CNPJ')!==manifest.issuerCnpj||
     xmlField(xml,'chNFe')!==key||
     Number(result.number)!==manifest.number||
     Number(result.series)!==manifest.series||
     xmlField(xml,'tpAmb')!==xmlEnvironment||
     xmlValueCents(xmlField(xml,'vNF'))!==manifest.amountCents||
     !xml.includes('NFe'+key)||!/<(?:\w+:)?Signature(?:\s|\/|>)/.test(xml)||
     !/<(?:\w+:)?infProt(?:\s|>)/.test(xml)||
     !new RegExp('<(?:\\w+:)?nProt>\\s*'+protocol+'\\s*</').test(xml)||
     !/<(?:\w+:)?cStat>\s*100\s*</.test(xml))
    return unknown();
  return{ok:true,status:200,data:{
    cStat:100,chave_nfe:key,chave_nfce:manifest.documentType==='nfce'?key:null,
    protocolo:protocol,numero:String(result.number||''),serie:String(result.series||''),
    xml,environment:manifest.environment,provider:PROVIDER_ID
  },error:null};
}
function executeWorker(data,{workerExe,timeoutMs=90000}={}){
  return new Promise((resolve,reject)=>{
    const proc=spawn(workerExe,[],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    let settled=false,out='',errBytes=0;
    let timer;
    const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);proc.kill();reject(Error('Executor ACBr não confirmou o resultado'));};
    timer=setTimeout(fail,Math.min(120000,Math.max(3000,Number(timeoutMs)||90000)));
    proc.on('error',fail);
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data',chunk=>{out+=chunk;if(Buffer.byteLength(out,'utf8')>4*1024*1024)fail();});
    proc.stderr.on('data',chunk=>{errBytes+=chunk.length;if(errBytes>8192)fail();});
    proc.on('close',code=>{clearTimeout(timer);if(settled)return;settled=true;
      if(code!==0)return reject(Error('Executor ACBr falhou'));
      try{const parsed=JSON.parse(out);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();resolve(parsed);}
      catch{reject(Error('Retorno ACBr inválido'));}
    });
    proc.stdin.on('error',()=>{});
    proc.stdin.end(JSON.stringify(data));
  });
}
function createAcbrLibAdapter(options={}){
  const configured=Boolean(options.inputDir&&options.nfeLib&&options.nfeConfig&&options.workerExe);
  // No paid provider, installation or external host is selected implicitly.
  function prepare({type,reference,environment,payload,requirePayload=false}={}){
    if(!configured)throw Error('ACBrLib nativa não configurada (recurso opcional)');
    const dir=localDirectory(options.inputDir);
    const libraryPath=localFile(options.nfeLib,'ACBrNFe');
    const configPath=localFile(options.nfeConfig,'Configuração ACBrLib');
    const workerExe=localFile(options.workerExe,'Executor ACBrLib local');
    const {iniPath,manifest}=readManifest(dir,reference);
    if(type!==manifest.documentType||environment!==manifest.environment)
      throw Error('Tipo/ambiente diferem do manifesto fiscal');
    if(environment==='production'&&options.allowProduction!==true)
      throw Error('Produção fiscal bloqueada até homologação e ativação explícita');
    if(requirePayload&&!sameSnapshot(payload?.document,manifest))
      throw Error('Snapshot da venda diverge do manifesto fiscal');
    return {iniPath,manifest,command:{
      kind:'NFE',operation:null,libraryPath,configPath,iniPath,
      issuerCnpj:manifest.issuerCnpj,environment:manifest.environment==='homologation'?'HOMOLOGACAO':'PRODUCAO',
      amountCents:manifest.amountCents,lot:manifest.lot,model:manifest.model,
      number:manifest.number,series:manifest.series,cNF:manifest.cNF
    },workerExe};
  }
  const runner=options.runner||((args)=>executeWorker(args,{workerExe:options.workerExe,timeoutMs:options.timeoutMs}));
  async function call(request,operation){
    try{
      const context=prepare({...request,requirePayload:operation==='transmit'});
      // A signed XML is persisted before sending: NEVER blindly resend an unknown invoice.
      if(operation==='transmit'&&fs.existsSync(path.join(path.dirname(context.iniPath),path.basename(context.iniPath,'.ini')+'.signed.xml')))
        return unknown();
      const response=await runner({...context.command,operation,
        ...(operation==='consult'?{accessKey:request.accessKey||null}:{})});
      return validated(response,context.manifest);
    }catch(error){
      if(/não configurada|bloqueada|inválid|incompleto|inconsistente|diverge|obrigatório|fora do diretório|ENOENT|missing/i.test(String(error.message||'')))
        return blocked('Preparação fiscal inválida ou incompleta. Nenhuma emissão foi realizada.');
      return unknown();
    }
  }
  async function issue(request){return call(request,'transmit');}
  async function query(request){return call(request,'consult');}
  async function cancel(){return{ok:false,status:501,data:null,error:'Cancelamento fiscal ainda não homologado na ACBrLib nativa.'};}
  async function status(){return{ok:true,status:200,data:{provider:PROVIDER_ID,configured,productionEnabled:options.allowProduction===true,mode:'local-offline-optional'}};}
  return Object.freeze({status,issue,query,cancel});
}
module.exports={createAcbrLibAdapter,executeWorker,readManifest};
