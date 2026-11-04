'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createPayGoControlPayProvider}=require('../js/domains/payments/paygo-controlpay-provider');
const {createLocalTefProvider}=require('../js/domains/payments/tef-local-provider');

const PAYGO_DOWNLOAD_URL='https://paygodev.readme.io/docs/kit-de-integracao-api';

/**
 * Secrets for optional TEF. The userData file is encrypted by Electron
 * safeStorage (Windows DPAPI/macOS keychain). NEVER use the settings SQLite
 * table, the renderer, command-line flags or the installer to persist keys.
 * Fresh installs simply return mode=manual.
 */
function createPaymentProviderStore({app,safeStorage}={}){
  if(!app?.getPath||!safeStorage)throw new TypeError('Electron app and safeStorage are required.');
  const file=path.join(app.getPath('userData'),'payment-provider.bin');

  function encryptedAvailable(){
    try{return Boolean(safeStorage.isEncryptionAvailable());}catch{return false;}
  }
  function requireEncryption(){
    if(!encryptedAvailable())throw new Error('Armazenamento seguro do sistema operacional indisponivel para chave TEF.');
  }
  function read(){
    if(!fs.existsSync(file))return{mode:'manual'};
    requireEncryption();
    try{
      const decoded=safeStorage.decryptString(fs.readFileSync(file));
      const data=JSON.parse(decoded);
      if(!data||typeof data!=='object'||Array.isArray(data)||
        !['paygo','bridge'].includes(data.mode))throw new Error('invalid');
      return data;
    }catch{throw new Error('Configuracao TEF protegida ilegivel; desative ou configure novamente.');}
  }
  function validatePaygo(input,previous={}){
    const integrationKey=String(input.integrationKey||'').trim()||
      (previous.mode==='paygo'?String(previous.integrationKey||'').trim():'');
    if(!integrationKey)throw new Error('Chave de integracao PayGo obrigatoria.');
    if(integrationKey.length>1024)throw new Error('Chave de integracao PayGo muito longa.');
    const baseUrl=String(input.baseUrl||'').trim();
    let url;
    try{url=new URL(baseUrl);}catch{throw new Error('Endereco PayGo HTTPS invalido.');}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||
      !url.pathname.endsWith('/'))throw new Error('Endpoint PayGo exige HTTPS e barra final, sem segredo na URL.');
    const terminalId=String(input.terminalId||'').trim();
    const terminalMap=input.terminalMap==null?null:input.terminalMap;
    if(terminalMap!==null&&(typeof terminalMap!=='object'||Array.isArray(terminalMap)))
      throw new Error('Mapa de terminais PayGo invalido.');
    if(terminalMap!==null){
      const items=Object.entries(terminalMap);
      if(!items.length||items.length>100)throw new Error('Mapa de terminais PayGo vazio ou muito longo.');
      const unique=new Set();
      for(const [local,remote] of items){
        if(!/^[A-Za-z0-9_-]{1,40}$/.test(local)||!/^[A-Za-z0-9_-]{1,40}$/.test(String(remote||'')))
          throw new Error('Terminal do mapa PayGo invalido.');
        if(unique.has(String(remote)))throw new Error('PinPad PayGo duplicado em mais de um terminal.');
        unique.add(String(remote));
      }
    }
    if(terminalMap===null&&!/^[A-Za-z0-9_-]{1,40}$/.test(terminalId))
      throw new Error('Terminal PayGo obrigatorio.');
    return{mode:'paygo',baseUrl,terminalId:terminalMap?null:terminalId,
      terminalMap,integrationKey};
  }
  function validateBridge(input){
    const executable=String(input.executable||'').trim();
    if(!path.isAbsolute(executable)||!fs.existsSync(executable)||
      !fs.statSync(executable).isFile()||path.extname(executable).toLowerCase()!=='.exe')
      throw new Error('Selecione um arquivo executavel TEF .exe instalado neste computador.');
    // A native bridge is NOT bundled or presented as PayGo/SiTef homologated.
    return{mode:'bridge',executable};
  }
  function publicStatus(config,error=null){
    return{
      mode:config.mode||'manual',configured:['paygo','bridge'].includes(config.mode),
      encryptionAvailable:encryptedAvailable(),downloadUrl:PAYGO_DOWNLOAD_URL,
      ...(config.mode==='paygo'?{
        baseUrl:config.baseUrl,terminalId:config.terminalId||'',terminalMap:config.terminalMap||null,
        integrationKeyConfigured:Boolean(config.integrationKey)
      }:{}),
      ...(config.mode==='bridge'?{executable:config.executable}:{}),
      ...(error?{error}: {})
    };
  }
  function status(){
    try{return publicStatus(read());}
    catch(error){return publicStatus({mode:'manual'},error.message);}
  }
  function save(input={}){
    const mode=String(input.mode||'manual');
    if(mode==='manual'){
      fs.rmSync(file,{force:true});
      return publicStatus({mode:'manual'});
    }
    requireEncryption();
    const previous=fs.existsSync(file)?read():{mode:'manual'};
    const config=mode==='paygo'?validatePaygo(input,previous):
      mode==='bridge'?validateBridge(input):null;
    if(!config)throw new Error('Modo de pagamento desconhecido.');
    const encrypted=safeStorage.encryptString(JSON.stringify(config));
    if(!Buffer.isBuffer(encrypted)||!encrypted.length)throw new Error('Criptografia TEF falhou.');
    fs.mkdirSync(path.dirname(file),{recursive:true});
    const temporary=file+'.tmp';
    try{
      fs.writeFileSync(temporary,encrypted,{mode:0o600,flag:'w'});
      fs.renameSync(temporary,file);
    }finally{
      if(fs.existsSync(temporary))fs.rmSync(temporary,{force:true});
    }
    return publicStatus(config);
  }
  function runtimeOptions({localTerminalId=null}={}){
    const config=read();
    if(config.mode==='manual')return{};
    if(config.mode==='paygo'){
      const valid=validatePaygo(config);
      return{tefProvider:createPayGoControlPayProvider({
        baseUrl:valid.baseUrl,integrationKey:valid.integrationKey,
        terminalId:valid.terminalId,terminalMap:valid.terminalMap
      })};
    }
    const valid=validateBridge(config);
    return{tefProvider:createLocalTefProvider({executable:valid.executable,allowedTerminalId:localTerminalId})};
  }
  return{status,save,runtimeOptions};
}
module.exports={createPaymentProviderStore,PAYGO_DOWNLOAD_URL};
