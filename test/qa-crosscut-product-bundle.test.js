import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildProductQaSummary } from '../qa/runtime/src/product-report.js';

const readJson=relative=>JSON.parse(readFileSync(fileURLToPath(new URL(`../${relative}`,import.meta.url)),'utf8'));

test('restaurant state-sync regression is versioned as crosscut release evidence',()=>{
  const manifest=readJson('qa/artisys-qa.config.json');
  const flow=readJson('qa/flows/restaurant-module-sync-e2e.json');
  const releaseCoverage=readJson('release/e2e-coverage.json');

  assert.equal(manifest.crosscut.categories['restaurant-module-sync-e2e'],'state-sync');
  assert.equal(flow.metadata?.category,'state-sync');

  const names=flow.steps.map(step=>step.name).filter(Boolean);
  assert.ok(names.includes('restaurant-protected-probe-rejected-while-disabled'));
  assert.ok(names.includes('home-stays-active-after-disabled-probe'));
  assert.ok(names.includes('restaurant-navigation-restored'));

  assert.equal(releaseCoverage.crosscut?.gate,'qa:crosscut');
  assert.ok(releaseCoverage.crosscut?.evidence?.includes('qa/flows/restaurant-module-sync-e2e.json'));
  assert.ok(releaseCoverage.crosscut?.covers?.includes('state-sync'));
  assert.equal(releaseCoverage.phases['4'].gate,'qa:release');
  assert.equal(releaseCoverage.phases['8'].gate,'capability:check:release');
});

test('crosscut product bundle preserves aggregate evidence and blocks critical findings',()=>{
  const summary=buildProductQaSummary({
    systemId:'pdv-artisys',
    profile:'crosscut',
    checks:[
      {name:'module:RESTAURANT',category:'module-contract',status:'passed',critical:true},
      {name:'renderer-health',category:'renderer-health',status:'passed',critical:true},
    ],
    coverage:{discovered:9,covered:9,uncovered:0,uncoveredCritical:0},
    consoleErrors:[],
    networkErrors:[{type:'requestfailed',expected:true,url:'http://127.0.0.1/recovery'}],
    findings:[{code:'interactive-overlap',name:'overlap in critical action',severity:'critical'}],
    evidence:[
      {type:'qa-flow',flowId:'restaurant-module-sync-e2e',path:'qa-artifacts/restaurant-module-sync-e2e'},
      {type:'module-contract',moduleId:'RESTAURANT',path:'qa-artifacts/module-restaurant.json'},
    ],
  });

  assert.equal(summary.coverage.discovered,9);
  assert.equal(summary.findingCount,1);
  assert.equal(summary.networkErrorCount,1);
  assert.equal(summary.evidenceCount,2);
  assert.equal(summary.gate.allowed,false);
  assert.equal(summary.gate.blockers.some(item=>item.type==='critical-finding'),true);
  assert.equal(summary.gate.blockers.some(item=>item.type==='request-failure'),false);
});
