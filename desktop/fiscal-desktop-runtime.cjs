'use strict';
// Native fiscal binary is read-only (Electron resources); fiscal records and
// private certificate configuration stay in the stable per-user ArtiSys profile.
// No SaaS, cloud certificate or paid fiscal provider is auto-selected.
const fs=require('node:fs');
const path=require('node:path');
const {verifyAcbrBundle}=require('../server/acbrlib/bundle-verifier');

function ownDirectory(folder){
 if(!path.isAbsolute(String(folder||'')))throw Error('Diretório fiscal deve ser absoluto');
 if(fs.existsSync(folder)){
  const stat=fs.lstatSync(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink())
   throw Error('Armazenamento fiscal inseguro: diretório inválido');
 }else{
  fs.mkdirSync(folder,{recursive:true,mode:0o700});
 }
 return folder;
}
function resolveFiscalDesktopRuntime({resourcesPath,userData,platform=process.platform,arch=process.arch,embeddedServer=true}={}){
 // Terminals never create fiscal state: only the computer with canonical sales
 // and database can host the local fiscal issuer.
 if(!embeddedServer||platform!=='win32'||arch!=='x64')
  return {enabled:false,status:'not-applicable',nativeOptions:null};
 const verified=verifyAcbrBundle({resourcesPath,platform,arch});
 if(!verified.valid)return {enabled:false,status:'native-bundle-unavailable',nativeOptions:null};
 if(!path.isAbsolute(String(userData||'')))throw Error('Pasta de dados do ArtiSys inválida');
 const fiscalRoot=ownDirectory(path.join(userData,'fiscal'));
 const privateDir=ownDirectory(path.join(fiscalRoot,'private'));
 const inputDir=ownDirectory(path.join(fiscalRoot,'input'));
 const nfeConfig=path.join(privateDir,'ACBrLibNFe.ini');
 return Object.freeze({
  enabled:true,
  status:fs.existsSync(nfeConfig)?'configuration-present':'requires-certificate',
  bundleRevision:verified.revision,
  nativeOptions:{
   inputDir,nfeLib:verified.nfeLib,nfeConfig,workerExe:verified.workerExe,
   // In a newly installed app, nothing may contact SEFAZ until the operator
   // explicitly configures homologation and reviews the fiscal profile.
   allowHomologation:false
  }
 });
}
module.exports={resolveFiscalDesktopRuntime};
