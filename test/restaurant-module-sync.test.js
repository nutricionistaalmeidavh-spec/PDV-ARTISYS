'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('module gate reconciles every optional module changed by another client',()=>{
  const gate=read('desktop/renderer/restaurant-module-gate.js');
  assert.match(gate,/PdvModuleGate/);
  assert.match(gate,/MODULE_SETTING_PATTERN|modules\.\(\[A-Z_\]\+\)\.enabled/);
  assert.match(gate,/new Map\(|moduleStates/);
  assert.match(gate,/\[data-module-open/);
  assert.match(gate,/artisys:modules-state-changed/);
  assert.match(gate,/CustomEvent/);
  assert.match(gate,/addEventListener\(['"]focus['"][\s\S]*refresh\(/);
  assert.match(gate,/visibilitychange[\s\S]*refresh\(/);
  assert.match(gate,/setInterval[\s\S]*refresh\(/);
});

test('generic gate preserves restaurant compatibility alias and fail-closed bootstrap',()=>{
  const gate=read('desktop/renderer/restaurant-module-gate.js');
  assert.match(gate,/PdvRestaurantModuleGate/);
  assert.match(gate,/RESTAURANT/);
  assert.match(gate,/isEnabled/);
  assert.match(gate,/snapshot/);
  assert.match(gate,/setEnabled/);
  assert.match(gate,/stopImmediatePropagation\(\)/);
  assert.doesNotMatch(gate,/showRoute\?\.\('settings'\)/);
});

test('QA release profile exercises restaurant module cross-client synchronization',()=>{
  const steps=read('qa/runtime/src/steps.js');
  const config=JSON.parse(read('qa/artisys-qa.config.json'));
  assert.match(steps,/case ['"]desktopApiRequest['"]/);
  assert.equal(config.flows['restaurant-module-sync-e2e'],'flows/restaurant-module-sync-e2e.json');
  for(const profileName of ['full','release']){
    const profile=config.qaProfiles[profileName];
    assert.ok(profile.flows.includes('restaurant-module-sync-e2e'),`${profileName} deve executar restaurant-module-sync-e2e`);
    assert.ok(profile.criticalFlows.includes('restaurant-module-sync-e2e'),`${profileName} deve tratar restaurant-module-sync-e2e como critico`);
  }
});
