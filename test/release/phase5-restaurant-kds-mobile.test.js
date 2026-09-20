'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

test('Phase 5 release gate: restaurante, KDS e mobile LAN passam no fluxo E2E durável',()=>{
  const result=spawnSync(process.execPath,['--test','test/e30-e39-restaurant.test.js'],{
    cwd:process.cwd(),
    encoding:'utf8',
    env:{...process.env,NODE_ENV:'test'}
  });
  assert.equal(result.status,0,`${result.stdout||''}\n${result.stderr||''}`);
  assert.match(result.stdout||'',/E30-E39: migration, comanda, KDS, prebill, checkout and sale close form one durable flow/);
  assert.match(result.stdout||'',/mobile credentials are hashed, revocable and authorize only the local device flows/);
  assert.match(result.stdout||'',/repeated mutation id produces one waiter open and one tablet order/);
});
