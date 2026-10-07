'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve('.');
const json=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const text=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('current P0 tutorial demos are executable QA flows mapped to the catalog',()=>{
  const config=json('qa/artisys-qa.config.json');
  const catalog=json('qa/tutorials/catalog.json');
  const p0=catalog.tutorials.filter(item=>item.phase==='P0');
  assert.equal(p0.length,12);
  for(const tutorial of p0){
    const demo=config.demos?.[tutorial.id];
    assert.ok(demo,tutorial.id);
    assert.equal(demo.durationTargetSec,tutorial.durationTargetSec,tutorial.id);
    assert.equal(demo.profile,'tutorials-p0',tutorial.id);
    const flow=json(path.join('qa',demo.file));
    assert.equal(flow.metadata?.qaAutoAdmin,true,tutorial.id);
    assert.equal(flow.steps[0]?.action,'authenticateLocalQa',tutorial.id);
    assert.equal(flow.steps[1]?.action,'capability',tutorial.id);
    assert.equal(flow.steps[1]?.name,'tutorial.setup',tutorial.id);
    assert.ok(flow.steps.some(step=>step.name==='app-ready'),tutorial.id);
    assert.ok(flow.steps.some(step=>step.action==='expectVisible'||step.action==='expectText'),tutorial.id);
  }
});

test('current P0/P1 workflow captures exactly tutorials 01 through 21',()=>{
  const workflow=text('.github/workflows/tutorial-capture-p0-p1-current.yml');
  const catalog=json('qa/tutorials/catalog.json');
  const wanted=catalog.tutorials.filter(item=>['P0','P1'].includes(item.phase));
  assert.equal(wanted.length,21);
  for(const tutorial of wanted)assert.ok(workflow.includes(tutorial.id),tutorial.id);
  assert.match(workflow,/artisys-qa\.mjs demo/);
  assert.match(workflow,/tutorials-p0/);
  assert.match(workflow,/tutorials-p1-p3/);
  assert.match(workflow,/qa:tutorials:edit/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
});

test('P0 adapter uses only synthetic tutorial data',()=>{
  const adapter=text('qa/runtime/adapters/tutorials-p0.mjs');
  assert.match(adapter,/tutorial\.setup/);
  assert.match(adapter,/tutorial\.cashPromptAction/);
  assert.match(adapter,/Produto Tutorial/);
  assert.match(adapter,/Cliente Tutorial/);
  assert.doesNotMatch(adapter,/gmail|hotmail|cpf|cnpj/i);
});
