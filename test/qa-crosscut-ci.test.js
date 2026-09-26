import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCrosscutProfile } from '../qa/runtime/src/crosscut-profile.js';

const root=path.resolve('.');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');
const moduleFlows=['restaurant-module-sync-e2e','pizzeria-module-sync-e2e','delivery-module-sync-e2e','fast-food-module-sync-e2e','market-bakery-module-sync-e2e','retail-module-sync-e2e','services-module-sync-e2e','workshop-module-sync-e2e','self-service-module-sync-e2e'];

test('root script, CLI and GitHub e2e job expose a dedicated crosscut gate for all modules',()=>{
  const pkg=readJson('package.json');
  const cli=readText('qa/runtime/src/cli.mjs');
  const workflow=readText('.github/workflows/verify.yml');
  const config=readJson('qa/artisys-qa.config.json');
  assert.match(pkg.scripts['qa:crosscut']||'',/artisys-qa\.mjs crosscut/);
  assert.match(cli,/process\.argv\[2\]\s*===\s*['"]crosscut['"]/);
  assert.match(cli,/runCrosscutProfile/);
  assert.match(workflow,/Run crosscut QA gate[\s\S]*xvfb-run -a npm run qa:crosscut/);
  assert.match(workflow,/qa-artifacts-crosscut/);
  assert.deepEqual(config.crosscut?.flows,moduleFlows);
  assert.deepEqual(config.crosscut?.criticalFlows,moduleFlows);
  for(const flowId of moduleFlows){
    assert.equal(config.crosscut.categories[flowId],'state-sync');
    const file=config.flows[flowId];
    assert.equal(fs.existsSync(path.join(root,'qa',file)),true,`${flowId} file must exist`);
    const flow=readJson(path.join('qa',file));
    assert.ok(flow.steps.some(step=>step.action==='desktopApiRequest'&&step.expectedStatus===409),`${flowId} must verify backend rejection`);
    assert.ok(flow.steps.some(step=>step.action==='waitFor'&&step.state==='hidden'),`${flowId} must verify launcher removal`);
  }
  assert.doesNotMatch(pkg.scripts['qa:crosscut']||'',/qa:(?:full|release)/);
});

test('crosscut manifest asset paths resolve relative to the QA config directory',()=>{
  const configPath=path.join(root,'qa/artisys-qa.config.json');const config=JSON.parse(fs.readFileSync(configPath,'utf8'));const manifestRoot=path.dirname(configPath);
  for(const key of ['moduleRegistry','moduleProbeConfig']){const relative=config.crosscut?.[key];assert.equal(typeof relative,'string');assert.equal(fs.existsSync(path.resolve(manifestRoot,relative)),true,`${key} must resolve: ${relative}`);}
});

test('runCrosscutProfile executes only configured crosscut flows and builds an independent product gate',async()=>{
  const calls=[];const manifest={systemId:'fixture',mode:'web',defaultEnvironment:'ci',defaultViewport:'desktop',environments:{ci:{baseURL:'http://local.test'}},flows:{cross:'flows/cross.json',unrelated:'flows/unrelated.json'},crosscut:{flows:['cross'],policy:{maxConsoleErrors:0,maxHttp5xx:0,maxRequestFailures:0}}};
  const result=await runCrosscutProfile({manifest,rootDir:process.cwd(),outputRoot:path.join(process.cwd(),'tmp-crosscut-artifacts'),flowRunner:async({flowName})=>{calls.push(flowName);return{outputDir:path.join(process.cwd(),'fake-'+flowName),summary:{status:'passed',flow:flowName}};},telemetryReader:async()=>[],bundleWriter:async({summary})=>({outputDir:'fixture-bundle',files:{summaryJson:'fixture-summary.json'},summary})});
  assert.deepEqual(calls,['cross']);assert.equal(result.summary.status,'PASS');assert.equal(result.summary.gate.allowed,true);assert.equal(result.summary.checks.some(item=>item.name==='flow:cross'&&item.status==='passed'),true);assert.equal(result.summary.checks.some(item=>item.name==='renderer-health'&&item.status==='passed'),true);
});

test('runCrosscutProfile fails fast when no dedicated crosscut flows are configured',async()=>{await assert.rejects(()=>runCrosscutProfile({manifest:{systemId:'fixture',mode:'web',defaultEnvironment:'ci',defaultViewport:'desktop',environments:{ci:{baseURL:'http://local.test'}},flows:{smoke:'flows/smoke.json'}},rootDir:process.cwd()}),/crosscut flows/i);});
