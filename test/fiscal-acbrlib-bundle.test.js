'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {verifyAcbrBundle}=require('../server/acbrlib/bundle-verifier');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acbr-bundle-pdv-'));
 const fiscal=path.join(root,'fiscal');fs.mkdirSync(path.join(fiscal,'deps'),{recursive:true});
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const files={};
 function put(name,text){
  const p=path.join(fiscal,name);fs.writeFileSync(p,text);
  files[name]=createHash('sha256').update(text).digest('hex');
 }
 put('ACBrNFe64.dll','ACBrLib nativa simulada sem execução -'.repeat(20));
 put('acbrlib-worker.exe','Executor nativo simulado sem execução -'.repeat(20));
 put('deps/xml2.dll','Biblioteca dependência simulada -'.repeat(20));
 put('THIRD_PARTY_LICENSES.txt','Licenças OSS e fontes da compilação');
 const manifest={schemaVersion:1,architecture:'x64',revision:'48608',source:'https://svn.code.sf.net/p/acbr/code/trunk2',files};
 fs.writeFileSync(path.join(fiscal,'acbr-bundle.json'),JSON.stringify(manifest));
 return {root,fiscal,manifest};
}
test('bundle verifier returns disabled when package is absent',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'acbr-empty-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const result=verifyAcbrBundle({resourcesPath:root,platform:'win32',arch:'x64'});
 assert.equal(result.valid,false);
 assert.equal(result.reason,'missing');
});
test('validates the complete offline LGPL native bundle before exposing paths',t=>{
 const f=fixture(t);const result=verifyAcbrBundle({resourcesPath:f.root,platform:'win32',arch:'x64'});
 assert.equal(result.valid,true);
 assert.equal(result.workerExe,path.join(f.fiscal,'acbrlib-worker.exe'));
 assert.equal(result.nfeLib,path.join(f.fiscal,'ACBrNFe64.dll'));
 assert.equal(result.revision,'48608');
 assert.equal(result.licenseFile,path.join(f.fiscal,'THIRD_PARTY_LICENSES.txt'));
});
test('tampered binaries, wrong OS/architecture and wrong schema always fail closed',t=>{
 const f=fixture(t);
 assert.equal(verifyAcbrBundle({resourcesPath:f.root,platform:'darwin',arch:'x64'}).valid,false);
 assert.equal(verifyAcbrBundle({resourcesPath:f.root,platform:'win32',arch:'ia32'}).valid,false);
 fs.appendFileSync(path.join(f.fiscal,'ACBrNFe64.dll'),'MODIFICADO');
 assert.equal(verifyAcbrBundle({resourcesPath:f.root,platform:'win32',arch:'x64'}).valid,false);
});
test('manifest never accepts traversal or symlinked DLLs',t=>{
 const f=fixture(t);const manifestPath=path.join(f.fiscal,'acbr-bundle.json');
 f.manifest.files['../escape.dll']='a'.repeat(64);
 fs.writeFileSync(manifestPath,JSON.stringify(f.manifest));
 assert.equal(verifyAcbrBundle({resourcesPath:f.root,platform:'win32',arch:'x64'}).valid,false);
 delete f.manifest.files['../escape.dll'];
 fs.writeFileSync(manifestPath,JSON.stringify(f.manifest));
 const dll=path.join(f.fiscal,'ACBrNFe64.dll'),outside=path.join(f.root,'outside.dll');
 fs.renameSync(dll,outside);fs.symlinkSync(outside,dll);
 assert.equal(verifyAcbrBundle({resourcesPath:f.root,platform:'win32',arch:'x64'}).valid,false);
});
