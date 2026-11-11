'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const matrix=require('../release/hardware-compatibility.json');

test('specific hardware field evidence is never generalized to all models',()=>{
  const urano=matrix.entries.find(x=>x.manufacturer==='Urano'&&x.model==='US 31/2 POP-S');
  const smx=matrix.entries.find(x=>x.manufacturer==='SMX'&&x.model==='SMX-T80E / POS80');
  const generic=matrix.entries.find(x=>x.manufacturer==='Generic');
  assert.equal(urano.status,'FIELD_VERIFIED');
  assert.match(urano.evidence,/PR #47/);
  assert.equal(smx.status,'PARTIAL');
  assert.match(smx.limitations,/não registra homologação física/);
  assert.equal(generic.status,'UNTESTED_MODEL');
  assert.ok(matrix.entries.filter(x=>x.status==='FIELD_VERIFIED').length===1);
});
