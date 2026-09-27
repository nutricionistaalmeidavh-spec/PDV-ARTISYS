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

test('builds fully covered crosscut contracts for all real optional modules',()=>{
  const plan=buildModuleContractPlan({modules:MODULES,probes:probes()});
  assert.equal(MODULES.length,9);
  assert.equal(plan.contracts.length,9);
  assert.deepEqual(plan.coverage,{discovered:9,covered:9,uncovered:0,uncoveredCritical:0});

  const expected={
    RESTAURANT:{launcher:'#route-content [data-restaurant-route]',path:'/api/v1/restaurant/tables',heading:'Restaurante'},
    PIZZERIA:{launcher:'[data-module-open="PIZZERIA"]',path:'/api/v1/vertical/pizzeria/products/__qa_missing__',heading:'Pizzaria'},
    DELIVERY:{launcher:'[data-module-open="DELIVERY"]',path:'/api/v1/vertical/delivery',heading:'Delivery'},
    FAST_FOOD:{launcher:'[data-module-open="FAST_FOOD"]',path:'/api/v1/vertical/fast-food',heading:'Fast-food / Lanchonete'},
    MARKET_BAKERY:{launcher:'[data-module-open="MARKET_BAKERY"]',path:'/api/v1/vertical/market/price-weight',heading:'Mercado / Conveniência / Padaria'},
    RETAIL:{launcher:'[data-module-open="RETAIL"]',path:'/api/v1/vertical/retail/variants?query=__qa__',heading:'Varejo'},
    SERVICES:{launcher:'[data-module-open="SERVICES"]',path:'/api/v1/vertical/services/commissions',heading:'Serviços'},
    WORKSHOP:{launcher:'[data-module-open="WORKSHOP"]',path:'/api/v1/vertical/workshop/orders/__qa_missing__',heading:'Oficina'},
    SELF_SERVICE:{launcher:'[data-module-open="SELF_SERVICE"]',path:'/api/v1/vertical/self-service/devices/__qa_missing__',heading:'Autoatendimento'}
  };

  for(const contract of plan.contracts){
    const item=expected[contract.moduleId];
    assert.ok(item,`unexpected module ${contract.moduleId}`);
    assert.equal(contract.critical,true,`${contract.moduleId} must be release critical`);
    assert.equal(contract.launcher.status,'covered',`${contract.moduleId} launcher`);
    assert.equal(contract.launcherSelector,item.launcher);
    assert.equal(contract.protected.status,'covered',`${contract.moduleId} protected probe`);
    assert.equal(contract.protectedProbe?.path,item.path);
    assert.equal(contract.supportsLiveSync,true,`${contract.moduleId} live sync`);
    assert.equal(contract.workspaceSelector,`[data-module-workspace="${contract.moduleId}"]`);
    assert.equal(contract.workspaceHeading,item.heading);
  }

  const workshop=plan.contracts.find(item=>item.moduleId==='WORKSHOP');
  assert.deepEqual(workshop.dependsOn,['SERVICES']);
  assert.ok(workshop.checks.some(check=>check.kind==='dependency'&&check.dependency==='SERVICES'));
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
