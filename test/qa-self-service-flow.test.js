'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const flow=JSON.parse(fs.readFileSync(path.join(root,'qa/flows/user/20-autoatendimento.json'),'utf8'));
const selfService=fs.readFileSync(path.join(root,'js/domains/self-service/self-service.js'),'utf8');

function index(name){return flow.steps.findIndex(step=>step.name===name);}
function step(name){return flow.steps.find(item=>item.name===name);}

test('PICKUP self-service QA enables FAST_FOOD before configuring the device',()=>{
  assert.match(selfService,/mode==='TABLE'[\s\S]*else\{[\s\S]*modules\.requireEnabled\('FAST_FOOD'\)/);
  assert.ok(index('enable-fast-food')>=0,'missing FAST_FOOD activation');
  assert.ok(index('fast-food-enabled')>index('enable-fast-food'),'must confirm FAST_FOOD activation');
  assert.ok(index('enable-self-service')>index('fast-food-enabled'),'SELF_SERVICE should be enabled after its PICKUP dependency');
  assert.ok(index('self-service-enabled')>index('enable-self-service'),'must confirm SELF_SERVICE activation');
  assert.ok(index('create-self-service')>index('self-service-enabled'),'device configuration must happen only after both modules are enabled');
});

test('self-service QA waits for its own success toast instead of every success toast',()=>{
  const configured=step('self-service-configured');
  assert.equal(configured?.action,'waitFor');
  assert.equal(configured?.selector,'.toast.success:has-text("Autoatendimento configurado.")');
});
