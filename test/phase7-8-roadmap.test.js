'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const readJson=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const readText=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('phase 7 has durable release evidence for admin infrastructure',()=>{
  const coverage=readJson('release/e2e-coverage.json');
  const phase=coverage.phases?.['7'];
  assert.ok(phase,'phase 7 coverage entry is required');
  for(const capability of ['backup','restore','import-csv-xlsx','updater','hardware-simulation','printing','diagnostics']){
    assert.ok(phase.covers.includes(capability),`phase 7 missing ${capability}`);
  }
  assert.ok(phase.evidence.includes('test/release/phase7-admin-infra.test.js'));
  assert.equal(fs.existsSync(path.join(root,'test/release/phase7-admin-infra.test.js')),true);
});

test('phase 8 blocks release unless every supported customer/admin capability has complete surface and e2e evidence',()=>{
  const pkg=readJson('package.json');
  assert.equal(pkg.scripts['capability:check:release'],'node scripts/check-customer-capability-parity.js --require-e2e --max-phase 8 --require-100');
  assert.match(pkg.scripts['verify:release'],/capability:check:release/);

  const checker=readText('scripts/check-customer-capability-parity.js');
  assert.match(checker,/require100/);
  assert.match(checker,/coveragePercent/);

  const registry=readJson('release/customer-capabilities.json');
  const surface=registry.capabilities.filter(item=>item.status==='supported'&&['customer','admin'].includes(item.exposure));
  assert.ok(surface.length>0);
  for(const capability of surface){
    for(const layer of ['backend','api','client','ui','e2e']){
      assert.ok(Array.isArray(capability[layer])&&capability[layer].length>0,`${capability.id} missing ${layer}`);
      for(const reference of capability[layer]){
        assert.ok(fs.existsSync(path.join(root,reference.path)),`${capability.id} missing path ${reference.path}`);
      }
    }
  }

  const phase=readJson('release/e2e-coverage.json').phases?.['8'];
  assert.equal(phase?.gate,'capability:check:release');
  assert.equal(phase?.targetCoveragePercent,100);
});
