import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runCrosscutProfile } from '../qa/runtime/src/crosscut-profile.js';

const root=path.resolve('.');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('root script, CLI and GitHub e2e job expose a dedicated crosscut gate',()=>{
  const pkg=readJson('package.json');
  const cli=readText('qa/runtime/src/cli.mjs');
  const workflow=readText('.github/workflows/verify.yml');
  const config=readJson('qa/artisys-qa.config.json');

  assert.match(pkg.scripts['qa:crosscut']||'',/artisys-qa\.mjs crosscut/);
  assert.match(cli,/process\.argv\[2\]\s*===\s*['"]crosscut['"]/);
  assert.match(cli,/runCrosscutProfile/);
  assert.match(workflow,/Run crosscut QA gate[\s\S]*xvfb-run -a npm run qa:crosscut/);
  assert.match(workflow,/qa-artifacts-crosscut/);
  assert.deepEqual(config.crosscut?.flows,['restaurant-module-sync-e2e']);
  assert.doesNotMatch(pkg.scripts['qa:crosscut']||'',/qa:(?:full|release)/);
});

test('crosscut manifest asset paths resolve relative to the QA config directory',()=>{
  const configPath=path.join(root,'qa/artisys-qa.config.json');
  const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
  const manifestRoot=path.dirname(configPath);

  for(const key of ['moduleRegistry','moduleProbeConfig']){
    const relative=config.crosscut?.[key];
    assert.equal(typeof relative,'string',`${key} must be configured`);
    assert.equal(
      fs.existsSync(path.resolve(manifestRoot,relative)),
      true,
      `${key} must resolve from qa/artisys-qa.config.json: ${relative}`
    );
  }
});

test('runCrosscutProfile executes only configured crosscut flows and builds an independent product gate',async()=>{
  const calls=[];
  const manifest={
    systemId:'fixture',
    mode:'web',
    defaultEnvironment:'ci',
    defaultViewport:'desktop',
    environments:{ci:{baseURL:'http://local.test'}},
    flows:{cross:'flows/cross.json',unrelated:'flows/unrelated.json'},
    crosscut:{flows:['cross'],policy:{maxConsoleErrors:0,maxHttp5xx:0,maxRequestFailures:0}}
  };
  const result=await runCrosscutProfile({
    manifest,
    rootDir:process.cwd(),
    outputRoot:path.join(process.cwd(),'tmp-crosscut-artifacts'),
    flowRunner:async({flowName})=>{
      calls.push(flowName);
      return{outputDir:path.join(process.cwd(),'fake-'+flowName),summary:{status:'passed',flow:flowName}};
    },
    telemetryReader:async()=>[],
    bundleWriter:async({summary})=>({outputDir:'fixture-bundle',files:{summaryJson:'fixture-summary.json'},summary})
  });

  assert.deepEqual(calls,['cross']);
  assert.equal(result.summary.status,'PASS');
  assert.equal(result.summary.gate.allowed,true);
  assert.equal(result.summary.checks.some(item=>item.name==='flow:cross'&&item.status==='passed'),true);
  assert.equal(result.summary.checks.some(item=>item.name==='renderer-health'&&item.status==='passed'),true);
});

test('runCrosscutProfile fails fast when no dedicated crosscut flows are configured',async()=>{
  await assert.rejects(
    ()=>runCrosscutProfile({
      manifest:{systemId:'fixture',mode:'web',defaultEnvironment:'ci',defaultViewport:'desktop',environments:{ci:{baseURL:'http://local.test'}},flows:{smoke:'flows/smoke.json'}},
      rootDir:process.cwd()
    }),
    /crosscut flows/i
  );
});
