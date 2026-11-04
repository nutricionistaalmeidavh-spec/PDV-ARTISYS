'use strict';
// Generates a SEPARATE, manual Windows lab installer configuration.
// Commercial package.json stays unchanged; never publishes or enables production.
const fs=require('node:fs');
const path=require('node:path');
const {verifyAcbrBundle}=require('../../server/acbrlib/bundle-verifier');
function createLabConfig({packageBuild,resourcesPath}={}){
 if(!packageBuild||typeof packageBuild!=='object')throw TypeError('Configuração de build do PDV obrigatória');
 const verified=verifyAcbrBundle({resourcesPath,platform:'win32',arch:'x64'});
 if(!verified.valid)throw Error('Pacote ACBr OSS ausente ou inválido: '+verified.reason);
 const config=JSON.parse(JSON.stringify(packageBuild));
 config.directories={...config.directories,output:'dist-fiscal-lab'};
 config.extraResources=[{from:'build/fiscal',to:'fiscal',filter:['**/*']}];
 config.publish=[];
 config.win={...config.win,artifactName:'ArtiSys-PDV-FISCAL-LAB-${version}-${arch}-Setup.${ext}'};
 // Only development builds expose the prep preview; a packaged application
 // remains explicitly disabled regardless of bundled DLLs.
 return config;
}
function writeLabConfig({cwd=process.cwd()}={}){
 const pkg=JSON.parse(fs.readFileSync(path.join(cwd,'package.json'),'utf8'));
 const config=createLabConfig({packageBuild:pkg.build,resourcesPath:path.join(cwd,'build')});
 const destination=path.join(cwd,'build','fiscal-lab-electron-builder.json');
 fs.writeFileSync(destination,JSON.stringify(config,null,2)+'\n');
 return destination;
}
if(require.main===module){
 try{const file=writeLabConfig();process.stdout.write(file+'\n');}
 catch(error){process.stderr.write(error.message+'\n');process.exitCode=1;}
}
module.exports={createLabConfig,writeLabConfig};
