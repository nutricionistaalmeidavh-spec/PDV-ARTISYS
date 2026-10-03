'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve('.');
const json=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));
const text=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('P0 tutorial demos are executable QA flows mapped to the tutorial catalog',()=>{
  const config=json('qa/artisys-qa.config.json');
  const catalog=json('qa/tutorials/catalog.json');
  const p0=catalog.tutorials.filter(item=>item.phase==='P0');
  assert.equal(p0.length,12);

  for(const tutorial of p0){
    const demo=config.demos[tutorial.id];
    assert.ok(demo, tutorial.id);
    assert.equal(demo.durationTargetSec,tutorial.durationTargetSec);
    assert.equal(demo.profile,'tutorials-p0');
    const flow=json(path.join('qa',demo.file));
    assert.equal(flow.metadata?.qaAutoAdmin,true,tutorial.id);
    assert.equal(flow.steps[0]?.action,'capability',tutorial.id);
    assert.equal(flow.steps[0]?.name,'tutorial.setup',tutorial.id);
    assert.ok(flow.steps.some(step=>step.action==='expectVisible'||step.action==='expectText'),tutorial.id);
  }
});

test('P0 tutorial capture workflow records edits and publishes all 12 MP4 artifacts',()=>{
  const workflow=text('.github/workflows/tutorial-capture-p0.yml');
  for(let n=1;n<=12;n++) assert.match(workflow,new RegExp(String(n).padStart(2,'0')+'-[a-z0-9-]+'));
  assert.match(workflow,/artisys-qa\.mjs demo/);
  assert.match(workflow,/--profile tutorials-p0/);
  assert.match(workflow,/qa:tutorials:edit/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
});

test('tutorial P0 adapter seeds only synthetic demo data and supports prompt-driven cash actions',()=>{
  const adapter=text('qa/runtime/adapters/tutorials-p0.mjs');
  assert.match(adapter,/tutorial\.setup/);
  assert.match(adapter,/tutorial\.cashPromptAction/);
  assert.match(adapter,/Produto Tutorial/);
  assert.match(adapter,/Cliente Tutorial/);
  assert.doesNotMatch(adapter,/gmail|hotmail|cpf|cnpj/i);
});
