'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');

function run(file){
  const env={...process.env,NODE_ENV:'test'};
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath,['--test',file],{
    cwd:process.cwd(),
    encoding:'utf8',
    env
  });
}

function outputOf(result){
  return `${result.stdout||''}\n${result.stderr||''}`;
}

test('Phase 6 release gate: pizzaria, delivery, fast-food e mercado/padaria passam E2E',()=>{
  const result=run('test/e43-e47-verticals.test.js');
  const output=outputOf(result);
  assert.equal(result.status,0,output);
  for(const marker of ['E43 pizzeria','E45 delivery','E46 fast food','E47 market/bakery']) assert.match(output,new RegExp(marker));
});

test('Phase 6 release gate: varejo, serviços, oficina e autoatendimento passam E2E',()=>{
  const result=run('test/e48-e54-final.test.js');
  const output=outputOf(result);
  assert.equal(result.status,0,output);
  for(const marker of ['E48 retail','E49 services','E50 workshop','E51 self-service']) assert.match(output,new RegExp(marker));
});
