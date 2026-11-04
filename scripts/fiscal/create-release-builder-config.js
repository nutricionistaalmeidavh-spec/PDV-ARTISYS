'use strict';
// The Windows fiscal distribution uses one product identity and updater path.
// A release build MUST have an integrity-verified ACBr OSS native bundle;
// otherwise it fails instead of quietly publishing a nonfunctional installer.
const fs=require('node:fs');
const path=require('node:path');
const {verifyAcbrBundle}=require('../../server/acbrlib/bundle-verifier');
function createWindowsFiscalInstallerConfig({packageBuild,resourcesPath}={}){
 if(!packageBuild||typeof packageBuild!=='object')throw TypeError('Configuração de instalador obrigatória');
 if(packageBuild.appId!=='com.artisys.pdv'||packageBuild.productName!=='ArtiSys PDV')
  throw Error('Identidade de instalação divergente: dados de clientes existentes devem permanecer na mesma pasta');
 const bundle=verifyAcbrBundle({resourcesPath,platform:'win32',arch:'x64'});
 if(!bundle.valid)throw Error('Bundle ACBr OSS inválido ou ausente: '+bundle.reason);
 const config=JSON.parse(JSON.stringify(packageBuild));
 if((config.extraResources||[]).length)throw Error('Recursos adicionais inesperados no instalador');
 config.extraResources=[{from:'build/fiscal',to:'fiscal',filter:['**/*']}];
 // Keep GitHub publish provider so electron-builder generates latest.yml and
 // blockmaps for the existing updater. The build CLI uses --publish never;
 // only the guarded release workflow may upload artifacts.
 if(!Array.isArray(config.publish)||!config.publish.some(p=>p.provider==='github'))
  throw Error('Canal GitHub do atualizador ArtiSys ausente');
 config.directories={...config.directories,output:'dist'};
 config.win={...config.win,artifactName:'ArtiSys-PDV-${version}-${arch}-Setup.${ext}'};
 config.nsis={...config.nsis,deleteAppDataOnUninstall:false};
 return config;
}
function writeWindowsFiscalInstallerConfig({cwd=process.cwd()}={}){
 const pkg=JSON.parse(fs.readFileSync(path.join(cwd,'package.json'),'utf8'));
 const config=createWindowsFiscalInstallerConfig({
  packageBuild:pkg.build,resourcesPath:path.join(cwd,'build')
 });
 const destination=path.join(cwd,'build','release-fiscal-electron-builder.json');
 fs.writeFileSync(destination,JSON.stringify(config,null,2)+'\n',{mode:0o600});
 return destination;
}
if(require.main===module){
 try{process.stdout.write(writeWindowsFiscalInstallerConfig()+'\n');}
 catch(error){process.stderr.write(String(error.message||'Falha no empacotamento fiscal')+'\n');process.exitCode=1;}
}
module.exports={createWindowsFiscalInstallerConfig,writeWindowsFiscalInstallerConfig};
