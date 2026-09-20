'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

function run(file){
  return spawnSync(process.execPath,['--test',file],{
    cwd:process.cwd(),
    encoding:'utf8',
    env:{...process.env,NODE_ENV:'test'}
  });
}

test('Phase 6 release gate: pizzaria, delivery, fast-food e mercado/padaria passam E2E',()=>{
  const result=run('test/e43-e47-verticals.test.js');
  assert.equal(result.status,0,`${result.stdout||''}\n${result.stderr||''}`);
  for(const marker of ['E43 pizzeria','E45 delivery','E46 fast food','E47 market/bakery']) assert.match(result.stdout||'',new RegExp(marker));
});

test('Phase 6 release gate: varejo, serviços, oficina e autoatendimento passam E2E',()=>{
  const result=run('test/e48-e54-final.test.js');
  assert.equal(result.status,0,`${result.stdout||''}\n${result.stderr||''}`);
  for(const marker of ['E48 retail','E49 services','E50 workshop','E51 self-service']) assert.match(result.stdout||'',new RegExp(marker));
});
