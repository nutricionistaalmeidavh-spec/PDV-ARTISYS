'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { buildEvidence } = require('../scripts/release-evidence.cjs');

test('buildEvidence records product, version, commit and SHA-256 artifacts', () => {
  const artifacts = [
    { name:'ArtiSys-PDV-1.3.2-x64-Setup.exe', data:Buffer.from('exe') },
    { name:'latest.yml', data:Buffer.from('yaml') }
  ];
  const evidence = buildEvidence({ product:'PDV-ARTISYS', version:'1.3.2', commit:'abc123', artifacts });
  assert.equal(evidence.product,'PDV-ARTISYS');
  assert.equal(evidence.version,'1.3.2');
  assert.equal(evidence.commit,'abc123');
  assert.equal(evidence.artifacts.length,2);
  assert.equal(evidence.artifacts[0].sha256,createHash('sha256').update('exe').digest('hex'));
  assert.equal(evidence.artifacts[0].bytes,3);
});

test('buildEvidence rejects empty artifact sets', () => {
  assert.throws(()=>buildEvidence({product:'PDV',version:'1',commit:'a',artifacts:[]}),/artifact/i);
});
