import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildModuleContractPlan, validateModuleProbeConfig } from '../qa/runtime/src/module-contracts.js';

const require=createRequire(import.meta.url);
const {MODULES}=require('../js/core/modules/module-registry.js');

function probes(){
  return JSON.parse(fs.readFileSync(new URL('../qa/crosscut/modules.json',import.meta.url),'utf8')).probes;
}

test('builds one data-driven QA contract for every optional module in the real registry',()=>{
  const plan=buildModuleContractPlan({modules:MODULES,probes:probes()});
  assert.equal(MODULES.length,9);
  assert.equal(plan.contracts.length,MODULES.length);
  assert.equal(plan.coverage.discovered,MODULES.length);

  const restaurant=plan.contracts.find(item=>item.moduleId==='RESTAURANT');
  assert.ok(restaurant);
  assert.equal(restaurant.supportsLiveSync,true);
  assert.equal(restaurant.launcherSelector,'#route-content [data-restaurant-route]');
  assert.equal(restaurant.protectedProbe?.path,'/api/v1/restaurant/tables');

  const workshop=plan.contracts.find(item=>item.moduleId==='WORKSHOP');
  assert.deepEqual(workshop.dependsOn,['SERVICES']);
  assert.ok(workshop.checks.some(check=>check.kind==='dependency'&&check.dependency==='SERVICES'));

  const unmapped=plan.contracts.find(item=>item.moduleId==='PIZZERIA');
  assert.equal(unmapped.launcher.status,'not-applicable');
  assert.match(unmapped.launcher.reason,/not mapped|not exposed|safe QA/i);
  assert.equal(unmapped.protected.status,'not-applicable');
  assert.ok(unmapped.protected.reason.length>3);
});

test('validates unknown probes and missing module dependencies',()=>{
  const unknown=validateModuleProbeConfig({
    modules:MODULES,
    probes:{...probes(),NOT_A_MODULE:{reason:'invalid fixture'}}
  });
  assert.equal(unknown.ok,false);
  assert.ok(unknown.errors.includes('unknown module probe: NOT_A_MODULE'));

  const missingDependency=validateModuleProbeConfig({
    modules:[{id:'WORKSHOP',dependsOn:['SERVICES'],defaultEnabled:false}],
    probes:{}
  });
  assert.equal(missingDependency.ok,false);
  assert.ok(missingDependency.errors.includes('unknown dependency for WORKSHOP: SERVICES'));
});

test('requires explicit reasons for unmapped QA subcapabilities',()=>{
  const invalid=validateModuleProbeConfig({
    modules:[{id:'SAMPLE',dependsOn:[],defaultEnabled:false}],
    probes:{SAMPLE:{critical:false}}
  });
  assert.equal(invalid.ok,false);
  assert.ok(invalid.errors.some(error=>error.includes('SAMPLE')&&error.includes('reason')));
});
