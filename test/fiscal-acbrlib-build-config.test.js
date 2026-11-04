'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {createLabConfig}=require('../scripts/fiscal/create-lab-builder-config');
const root=path.join(__dirname,'..');
test('official commercial installer remains nonfiscal and experimental build is isolated',()=>{
 const pkg=require('../package.json');
 assert.deepEqual(pkg.build.extraResources,[]);
 assert.equal(pkg.build.directories.output,'dist');
 assert.throws(()=>createLabConfig({packageBuild:pkg.build,resourcesPath:'/definitely/missing'}),/ausente|inválido/);
 const main=fs.readFileSync(path.join(root,'desktop/main.cjs'),'utf8');
 assert.match(main,/!app\.isPackaged && process\.env\.ARTISYS_FISCAL_PREVIEW/);
});
test('manual Windows lab config includes only verified OSS DLLs as extra resources',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'acbr-lab-config-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bundle=path.join(dir,'fiscal');fs.mkdirSync(path.join(bundle,'deps'),{recursive:true});
 const files={};for(const [name,text] of Object.entries({
  'acbrlib-worker.exe':'worker'.repeat(90),'ACBrNFe64.dll':'DLL'.repeat(140),'THIRD_PARTY_LICENSES.txt':'Open source LGPL notice','deps/xml2.dll':'xml2'.repeat(100)
 })){fs.writeFileSync(path.join(bundle,name),text);files[name]=createHash('sha256').update(text).digest('hex');}
 fs.writeFileSync(path.join(bundle,'acbr-bundle.json'),JSON.stringify({schemaVersion:1,architecture:'x64',source:'https://svn.code.sf.net/p/acbr/code/trunk2',revision:'48608',files}));
 const pkg=require('../package.json');const config=createLabConfig({packageBuild:pkg.build,resourcesPath:dir});
 assert.equal(config.directories.output,'dist-fiscal-lab');
 assert.equal(config.extraResources.length,1);
 assert.equal(config.extraResources[0].from,'build/fiscal');
 assert.match(config.win.artifactName,/FISCAL-LAB/);
 assert.deepEqual(config.publish,[]);
 assert.deepEqual(pkg.build.extraResources,[]);
});

test('native ACBr target is a named record, never a flattened PowerShell array',()=>{
 const script=fs.readFileSync(path.join(root,'scripts/fiscal/build-acbr-native.ps1'),'utf8');
 assert.match(script,/Directory='NFe'; File='ACBrLibNFe\.lpi'; Binary='ACBrNFe64\.dll'/);
 assert.doesNotMatch(script,/\$item\[[012]\]/);
});
