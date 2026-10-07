'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve('.');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const json=file=>JSON.parse(read(file));

test('printing tutorial QA exposes a simulated Windows printer instead of an error-looking empty state',()=>{
  const qaDesktop=read('qa/desktop/main.cjs');
  const config=json('qa/artisys-qa.config.json');
  assert.equal(config.environments['printer-ci'].env.ARTISYS_QA_FAKE_PRINTER,'1');
  assert.match(qaDesktop,/ARTISYS_QA_FAKE_PRINTER/);
  assert.match(qaDesktop,/Impressora Tutorial/);
});

test('printing tutorials assert the visible simulated printer state',()=>{
  for(const id of ['32-configurar-impressora','33-diagnostico-impressao']){
    const flow=json(`qa/demo/tutorials/${id}.json`);
    assert.ok(flow.steps.some(step=>step.action==='expectText'&&step.expected==='1 IMPRESSORA(S)'),id);
    assert.ok(flow.steps.some(step=>step.action==='expectText'&&step.expected==='Impressora Tutorial'),id);
  }
});
