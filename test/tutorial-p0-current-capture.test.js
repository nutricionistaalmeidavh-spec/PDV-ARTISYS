'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve('.');
const json=relative=>JSON.parse(fs.readFileSync(path.join(root,relative),'utf8'));

test('core P0 tutorials 01 through 12 run against the current dialog-based UI',()=>{
  const catalog=json('qa/tutorials/catalog.json');
  const config=json('qa/artisys-qa.config.json');
  const core=catalog.tutorials.filter(item=>{
    const n=Number(String(item.id).slice(0,2));
    return n>=1&&n<=12;
  });
  assert.equal(core.length,12);
  for(const tutorial of core){
    const demo=config.demos?.[tutorial.id];
    assert.ok(demo,tutorial.id);
    assert.equal(demo.durationTargetSec,tutorial.durationTargetSec,tutorial.id);
    assert.equal(demo.profile,'tutorials-p0',tutorial.id);
    const flow=json(path.join('qa',demo.file));
    assert.equal(flow.metadata?.qaAutoAdmin,true,tutorial.id);
    assert.equal(flow.steps[0]?.action,'authenticateLocalQa',tutorial.id);
    assert.ok(flow.steps.some(step=>step.action==='expectVisible'||step.action==='expectText'),tutorial.id);
  }
});

test('cash tutorials use ArtiSys dialogs and verify the live expected balance',()=>{
  const supply=json('qa/demo/tutorials/11-sangria-suprimento.json');
  const close=json('qa/demo/tutorials/12-fechar-caixa.json');
  const combined=JSON.stringify([supply,close]);
  assert.match(combined,/\.ux-dialog/);
  assert.doesNotMatch(combined,/tutorial\.cashPromptAction|prompt\(/);
  assert.ok(supply.steps.some(step=>step.expected==='120,00'));
  assert.ok(supply.steps.some(step=>step.expected==='110,00'));
  assert.ok(close.steps.some(step=>step.selector==='.ux-dialog .ux-dialog__confirm'));
});
