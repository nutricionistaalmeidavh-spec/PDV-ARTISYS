'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {resolveFiscalDesktopRuntime}=require('../desktop/acbrlib-desktop-runtime.cjs');
const {createWindowsFiscalInstallerConfig}=require('../scripts/fiscal/create-release-builder-config.js');

function bundle(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-dist-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const directory=path.join(root,'fiscal');
 fs.mkdirSync(path.join(directory,'deps'),{recursive:true});
 const entries={};
 for(const [name,body] of Object.entries({
  'ACBrNFe64.dll':'acbr'.repeat(100),
  'acbrlib-worker.exe':'worker'.repeat(100),
  'deps/xml2.dll':'xml2'.repeat(100),
  'THIRD_PARTY_LICENSES.txt':'Licença LGPL e fontes correspondentes'
 })){
  fs.writeFileSync(path.join(directory,name),body);
  entries[name]=createHash('sha256').update(body).digest('hex');
 }
 fs.writeFileSync(path.join(directory,'acbr-bundle.json'),JSON.stringify({
   schemaVersion:1,architecture:'x64',source:'https://svn.code.sf.net/p/acbr/code/trunk2',
   revision:'48608',files:entries
 }));
 return root;
}
test('a new Windows machine uses one stable ArtiSys data directory, never application resources or cwd for fiscal state',t=>{
 const resources=bundle(t), userData=path.join(resources,'profile');
 const runtime=resolveFiscalDesktopRuntime({resourcesPath:resources,userData,platform:'win32',arch:'x64',embeddedServer:true});
 assert.equal(runtime.enabled,true);
 assert.equal(runtime.nativeOptions.allowHomologation,false);
 assert.equal(runtime.nativeOptions.inputDir,path.join(userData,'fiscal','input'));
 assert.equal(runtime.nativeOptions.nfeConfig,path.join(userData,'fiscal','private','ACBrLibNFe.ini'));
 assert.equal(runtime.nativeOptions.nfeLib,path.join(resources,'fiscal','ACBrNFe64.dll'));
 assert.equal(runtime.nativeOptions.workerExe,path.join(resources,'fiscal','acbrlib-worker.exe'));
 assert.ok(fs.existsSync(runtime.nativeOptions.inputDir));
 assert.ok(!fs.existsSync(runtime.nativeOptions.nfeConfig));
 assert.ok(!fs.existsSync(path.join(resources,'fiscal','pdv-artisys.sqlite')));
 assert.equal(runtime.status,'requires-certificate');
});
test('old installation and new machine share the original appId, productName, exe and updater family',t=>{
 const resources=bundle(t),pkg=require('../package.json');
 const config=createWindowsFiscalInstallerConfig({packageBuild:pkg.build,resourcesPath:resources});
 assert.equal(pkg.build.appId,'com.artisys.pdv');
 assert.equal(pkg.build.productName,'ArtiSys PDV');
 assert.equal(pkg.build.files.some(pattern=>pattern==='!desktop/fiscal-*.cjs'),false,
  'The standard Windows app must ship modules required by desktop/main.cjs or it crashes at startup');
 assert.ok(pkg.build.files.some(pattern=>pattern==='desktop/**/*'));
 assert.equal(config.appId,pkg.build.appId);
 assert.equal(config.productName,pkg.build.productName);
 assert.equal(config.win.artifactName,'ArtiSys-PDV-${version}-${arch}-Setup.${ext}');
 assert.equal(config.extraResources[0].from,'build/fiscal');
 assert.equal(config.extraResources[0].to,'fiscal');
 assert.equal(config.nsis.deleteAppDataOnUninstall,false);
 assert.deepEqual(config.publish,pkg.build.publish);
 assert.equal(config.publish[0].provider,'github');
 assert.deepEqual(pkg.build.extraResources,[]);
});
test('no signed native bundle means the fiscal service stays disabled instead of exposing a broken fiscal feature',t=>{
 const resources=bundle(t), userData=path.join(resources,'old-install');
 const manifest=path.join(resources,'fiscal','acbr-bundle.json');
 fs.rmSync(manifest);
 const state=resolveFiscalDesktopRuntime({resourcesPath:resources,userData,platform:'win32',arch:'x64',embeddedServer:true});
 assert.equal(state.enabled,false);
 assert.equal(state.nativeOptions,null);
 assert.equal(fs.existsSync(userData),false);
 assert.throws(()=>createWindowsFiscalInstallerConfig({packageBuild:require('../package.json').build,resourcesPath:resources}),/ACBr|bundle|incompleto|ausente|inválido/i);
});
test('fiscal state is never created on a LAN-only terminal, macOS or unsupported Windows architecture',t=>{
 const resources=bundle(t),userData=path.join(resources,'userData');
 for(const opts of [{platform:'darwin',arch:'x64',embeddedServer:true},
  {platform:'win32',arch:'arm64',embeddedServer:true},
  {platform:'win32',arch:'x64',embeddedServer:false}]){
  const state=resolveFiscalDesktopRuntime({resourcesPath:resources,userData,...opts});
  assert.equal(state.enabled,false);
  assert.equal(state.nativeOptions,null);
 }
 assert.equal(fs.existsSync(userData),false);
});
test('fiscal profile from existing installation is preserved and never replaced during relaunch',t=>{
 const resources=bundle(t),userData=path.join(resources,'profile'),privateDir=path.join(userData,'fiscal','private');
 fs.mkdirSync(privateDir,{recursive:true});
 const marker=path.join(privateDir,'ACBrLibNFe.ini');
 fs.writeFileSync(marker,'existing-user-owned-configuration');
 resolveFiscalDesktopRuntime({resourcesPath:resources,userData,platform:'win32',arch:'x64',embeddedServer:true});
 assert.equal(fs.readFileSync(marker,'utf8'),'existing-user-owned-configuration');
});

test('same data path permits fiscal opt-in after restart without resetting SQLite or stock records',t=>{
 const resources=bundle(t),userData=path.join(resources,'profile');
 fs.mkdirSync(userData,{recursive:true});
 const db=path.join(userData,'pdv-artisys.sqlite');
 fs.writeFileSync(db,'UNCHANGED-SQLITE-BYTES');
 const first=resolveFiscalDesktopRuntime({resourcesPath:resources,userData,platform:'win32',arch:'x64',embeddedServer:true});
 assert.equal(first.nativeOptions.allowHomologation,false);
 const privateDir=path.join(userData,'fiscal','private');
 fs.writeFileSync(path.join(privateDir,'ACBrLibNFe.ini'),'existing-certificate-config');
 fs.writeFileSync(path.join(privateDir,'homologation-enabled.json'),JSON.stringify({enabled:true}));
 const second=resolveFiscalDesktopRuntime({resourcesPath:resources,userData,platform:'win32',arch:'x64',embeddedServer:true});
 assert.equal(second.nativeOptions.allowHomologation,true);
 assert.equal(fs.readFileSync(db,'utf8'),'UNCHANGED-SQLITE-BYTES');
 assert.equal(first.nativeOptions.inputDir,second.nativeOptions.inputDir);
 assert.equal(first.nativeOptions.workerExe,second.nativeOptions.workerExe);
});
