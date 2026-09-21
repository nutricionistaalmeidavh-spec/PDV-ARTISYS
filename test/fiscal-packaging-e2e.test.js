'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {createFiscalSidecarRuntime}=require('../desktop/fiscal-sidecar-runtime.cjs');
const {resolveFiscalRuntimePaths}=require('../desktop/fiscal-runtime-paths.cjs');
const {createFiscalPackService}=require('../js/domains/fiscal/fiscal-pack-store');
function sha256(content){return crypto.createHash('sha256').update(content).digest('hex');}

test('E2E P20-P21: installed external runtime starts authenticated sidecar and imported pack survives service restart',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-install-e2e-'));const resourcesPath=path.join(root,'resources');const installedFiscalRoot=path.join(resourcesPath,'fiscal');fs.mkdirSync(installedFiscalRoot,{recursive:true});
 fs.cpSync(path.join(__dirname,'..','server','fiscal-sidecar'),path.join(installedFiscalRoot,'sidecar'),{recursive:true});fs.cpSync(path.join(__dirname,'..','fiscal-runtime','acbr'),path.join(installedFiscalRoot,'acbr'),{recursive:true});fs.cpSync(path.join(__dirname,'..','fiscal-runtime','configs'),path.join(installedFiscalRoot,'configs'),{recursive:true});fs.cpSync(path.join(__dirname,'..','fiscal-runtime','schemas'),path.join(installedFiscalRoot,'schemas'),{recursive:true});fs.copyFileSync(path.join(__dirname,'..','fiscal-runtime','manifest.json'),path.join(installedFiscalRoot,'manifest.json'));
 const paths=resolveFiscalRuntimePaths({isPackaged:true,resourcesPath});assert.equal(fs.existsSync(paths.sidecarEntry),true);assert.equal(paths.sidecarEntry.includes('app.asar'),false);assert.equal(fs.existsSync(paths.manifestPath),true);assert.equal(fs.existsSync(paths.configsRoot),true);assert.equal(fs.existsSync(paths.schemasRoot),true);assert.equal(fs.existsSync(paths.acbrRoot),true);
 const runtime=createFiscalSidecarRuntime({entryPath:paths.sidecarEntry,env:{...process.env,ARTISYS_FISCAL_SIDECAR_MODE:'mock-success'},port:0,restartDelayMs:25,maxRestarts:1,readyTimeoutMs:5000,onError:()=>{}});
 try{await runtime.start();const response=await fetch(`${runtime.getBaseUrl()}/v1/health`,{headers:{authorization:`Bearer ${runtime.getAuthToken()}`}});const health=await response.json();assert.equal(response.ok,true);assert.equal(health.healthy,true);assert.equal(health.loopbackOnly,true);assert.equal(health.authenticated,true);}finally{await runtime.stop();}
 const packSource=path.join(root,'incoming-pack');const parametersDir=path.join(packSource,'parameters');fs.mkdirSync(parametersDir,{recursive:true});const payload='{"uf":"SP","purpose":"packaging-e2e"}';fs.writeFileSync(path.join(parametersDir,'runtime.json'),payload);fs.writeFileSync(path.join(packSource,'manifest.json'),JSON.stringify({formatVersion:1,id:'e2e-local',version:'2026.9.0',createdAt:'2026-09-20T00:00:00.000Z',files:[{path:'parameters/runtime.json',kind:'parameters',sha256:sha256(payload)}]},null,2));
 const storeRoot=path.join(root,'userData','fiscal-packs');const firstService=createFiscalPackService({storeRoot});const imported=firstService.importPack(packSource);assert.equal(imported.installed,true);const afterRestart=createFiscalPackService({storeRoot});assert.deepEqual(afterRestart.listInstalled().map(pack=>`${pack.id}@${pack.version}`),['e2e-local@2026.9.0']);assert.equal(fs.existsSync(path.join(storeRoot,'e2e-local','2026.9.0','parameters','runtime.json')),true);fs.rmSync(root,{recursive:true,force:true});
});