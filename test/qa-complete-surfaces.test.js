'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const flow=()=>JSON.parse(read('qa/flows/all-pages-audit.json'));

test('P0 UI gate captures Reports, staff mobile, KDS and public QR surfaces',()=>{
  const steps=flow().steps;
  const screenshots=new Set(steps.filter(step=>step.action==='screenshot').map(step=>step.name));
  for(const name of ['relatorios','equipe-mobile','kds-mobile','cardapio-qr']) assert.equal(screenshots.has(name),true,name);

  const overflow=new Set(steps.filter(step=>step.action==='expectNoHorizontalOverflow').map(step=>step.name));
  for(const name of ['relatorios-sem-overflow','equipe-mobile-sem-overflow','kds-mobile-sem-overflow','cardapio-qr-sem-overflow']) assert.equal(overflow.has(name),true,name);
});

test('QA runtime can carry server-generated IDs, credentials and QR URLs between steps',()=>{
  const runtime=read('qa/runtime/src/steps.js');
  assert.match(runtime,/runtimeContext\.vars/);
  assert.match(runtime,/saveAs/);
  assert.match(runtime,/valueFrom/);
  assert.match(runtime,/urlFrom/);
});

test('extended coverage proves useful content instead of screenshots only',()=>{
  const steps=flow().steps;
  const names=new Set(steps.map(step=>step.name));
  for(const name of [
    'relatorios-ui',
    'equipe-mobile-conectada',
    'kds-mobile-lanes',
    'cardapio-qr-mesa',
    'cardapio-qr-produtos'
  ]) assert.equal(names.has(name),true,name);
});
