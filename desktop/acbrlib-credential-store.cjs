'use strict';
// A1/CSC are local user-owned data. OS safeStorage encrypts secrets at rest;
// PFX is already password-protected. ACBr INI is materialized only for runtime.
// No fiscal credentials are transferred to HTTP, GitHub, a SaaS or a build.
const fs=require('node:fs');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const UFS=new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
function ownDirectory(dir){
 if(!path.isAbsolute(String(dir||'')))throw Error('Diretório privado fiscal inválido');
 if(fs.existsSync(dir)){
  const stat=fs.lstatSync(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Diretório de certificado inseguro');
 }else fs.mkdirSync(dir,{recursive:true,mode:0o700});
 return dir;
}
function atomic(file,buffer){
 const tmp=file+'.'+randomUUID()+'.tmp';
 try{
  fs.writeFileSync(tmp,buffer,{flag:'wx',mode:0o600});
  fs.renameSync(tmp,file);
 }finally{try{fs.rmSync(tmp,{force:true});}catch{}}
}
function field(value,name,max=512){
 const s=String(value??'');
 if(!s.trim()||s.length>max||/[\r\n\0]/.test(s))
  throw Error(name+' fiscal obrigatório ou contém caractere inválido');
 return s;
}
function createFiscalCredentialStore({userData,safeStorage}={}){
 if(!safeStorage||typeof safeStorage.encryptString!=='function'||typeof safeStorage.decryptString!=='function')
  throw TypeError('Armazenamento seguro do sistema operacional é obrigatório');
 if(!path.isAbsolute(String(userData||'')))throw Error('Pasta local do ArtiSys inválida');
 const root=path.join(userData,'fiscal'),privateDir=path.join(root,'private');
 const sealedPath=path.join(privateDir,'credentials.bin');
 const certPath=path.join(privateDir,'certificate.pfx');
 const iniPath=path.join(privateDir,'ACBrLibNFe.ini');
 const enabledPath=path.join(privateDir,'homologation-enabled.json');
 function available(){try{return safeStorage.isEncryptionAvailable()===true;}catch{return false;}}
 function status(){
  const configured=available()&&fs.existsSync(sealedPath)&&fs.existsSync(certPath);
  let enabled=false;
  if(configured){
   try{enabled=JSON.parse(fs.readFileSync(enabledPath,'utf8')).enabled===true;}catch{}
  }
  return Object.freeze({configured,homologationEnabled:enabled,encryptionAvailable:available()});
 }
 function disableHomologation(){
  try{fs.rmSync(enabledPath,{force:true});}catch{}
  return {homologationEnabled:false};
 }
 function removeRuntimeConfig(){try{fs.rmSync(iniPath,{force:true});}catch{}}
 function importCertificate({certificatePath,password,uf,csc='',idCsc=''}={}){
  if(!available())throw Error('Armazenamento seguro/criptografado do Windows indisponível');
  if(!path.isAbsolute(String(certificatePath||''))||!/\.(pfx|p12)$/i.test(certificatePath))
   throw Error('Certificado A1 deve ser um arquivo local .pfx ou .p12');
  const source=fs.realpathSync(certificatePath),stat=fs.statSync(source);
  if(!stat.isFile()||stat.size<512||stat.size>256*1024)
   throw Error('Arquivo PFX do certificado está vazio ou inválido');
  const normalizedUf=field(uf,'UF do certificado',2).toUpperCase();
  if(!UFS.has(normalizedUf))throw Error('UF do emitente inválida');
  const pwd=field(password,'Senha do certificado digital');
  const token=String(csc||'').trim(),id=String(idCsc||'').trim();
  if(token&&(token.length>256||/[\r\n\0]/.test(token)))
   throw Error('CSC da NFC-e inválido');
  if((token&&!/^[0-9]{1,8}$/.test(id))||(id&&!token))
   throw Error('CSC e IdCSC devem ser informados juntos');
  const secret={password:pwd,uf:normalizedUf,csc:token,idCsc:id};
  const encrypted=safeStorage.encryptString(JSON.stringify(secret));
  if(!Buffer.isBuffer(encrypted)||encrypted.length<24)throw Error('Criptografia do certificado falhou');
  ownDirectory(root);ownDirectory(privateDir);
  disableHomologation();removeRuntimeConfig();
  // Store only the password-protected certificate bytes and encrypted secrets.
  atomic(certPath,fs.readFileSync(source));
  atomic(sealedPath,encrypted);
  return {configured:true,uf:normalizedUf,homologationEnabled:false,
   certificatePresent:true,cscConfigured:Boolean(token)};
 }
 function materialize(){
  if(!status().configured)throw Error('Certificado digital A1 ainda não configurado');
  const secret=JSON.parse(safeStorage.decryptString(fs.readFileSync(sealedPath)));
  const uf=field(secret.uf,'UF',2).toUpperCase();
  if(!UFS.has(uf))throw Error('UF fiscal inválida');
  const password=field(secret.password,'Senha do certificado digital');
  const csc=String(secret.csc||''),id=String(secret.idCsc||'');
  if(/[\r\n\0]/.test(certPath))throw Error('Caminho de certificado inválido');
  const content=[
   '[Principal]','TipoResposta=0','LogNivel=0','',
   '[NFe]','Ambiente=1','FormaEmissao=0',
   ...(csc?['CSC='+field(csc,'CSC',256),'IdCSC='+field(id,'IdCSC',8)]:[]),'',
   '[DFe]','UF='+uf,'ArquivoPFX='+certPath,'Senha='+password,
   'VerificarValidade=1','',
   '[DANFE]','PathPDF='+ownDirectory(path.join(root,'danfe')),'',
  ].join('\n');
  ownDirectory(root);ownDirectory(privateDir);
  atomic(iniPath,Buffer.from(content,'utf8'));
  return iniPath;
 }
 function enableHomologation(){
  // Validate the private A1 locally, but never leave the plaintext INI at rest.
  try {
   materialize();
   atomic(enabledPath,Buffer.from(JSON.stringify({enabled:true,at:new Date().toISOString()})));
   return {homologationEnabled:true,restartRequired:true};
  } finally {removeRuntimeConfig();}
 }
 return Object.freeze({
  status,importCertificate,materialize,enableHomologation,disableHomologation,
  removeRuntimeConfig,paths:{iniPath,certPath,root,privateDir}
 });
}
module.exports={createFiscalCredentialStore};
