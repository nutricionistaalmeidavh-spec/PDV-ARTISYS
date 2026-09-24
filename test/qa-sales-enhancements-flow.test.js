'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('release QA uses current reporting v2 flow',()=>{
  const config=readJson('qa/artisys-qa.config.json');
  assert.equal(config.flows['reports-v2-complete'],'flows/reports-v2-complete.json');
  assert.ok(config.qaProfiles.release.flows.includes('reports-v2-complete'));
  assert.ok(config.qaProfiles.release.flows.includes('core-business-e2e'));
});

test('reporting v2 QA covers customer-facing commercial reports',()=>{
  const flow=readJson('qa/flows/reports-v2-complete.json');
  const names=new Set(flow.steps.map(step=>step.name).filter(Boolean));
  for(const name of ['reports-v2-heading','reports-v2-customers','reports-v2-products','reports-v2-payments','reports-v2-inventory','reports-v2-cash','reports-v2-commissions','reports-v2-export','reports-v2-print']) assert.ok(names.has(name),`missing QA step ${name}`);
  assert.ok(flow.steps.some(step=>step.selector==='#report-v2-filter'));
  assert.ok(flow.steps.some(step=>step.selector==="[data-report-view='products']"));
});

test('seller selector synchronizes backend users when checkout is rendered',()=>{
  const source=readText('desktop/renderer/seller-select-sync.js');
  assert.match(source,/seller-select/);
  assert.match(source,/api\.sellers\(\)/);
  assert.match(source,/replaceChildren/);
});

test('QA Electron launcher isolates userData through QA wrapper',()=>{
  const config=readJson('qa/artisys-qa.config.json');
  assert.equal(config.electron.entry,'desktop/main.cjs');
  const launcher=readText('qa/desktop/main.cjs');
  assert.match(launcher,/ARTISYS_QA/);
  assert.match(launcher,/app\.setPath\(['"]userData['"]/);
  assert.match(launcher,/os\.tmpdir\(\)/);
  assert.match(launcher,/require\(['"]\.\.\/\.\.\/desktop\/main\.cjs['"]\)/);
  assert.equal(config.environments.ci.env.PDV_ENABLE_LAN,'false');
  assert.equal(config.environments.ci.env.PDV_AUTO_PRINT,'false');
});
