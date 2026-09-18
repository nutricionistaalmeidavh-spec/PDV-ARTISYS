'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

test('release QA gates all 26 user journeys plus installed EXE smoke', () => {
  const flowDir = path.join(root, 'qa', 'flows', 'user');
  const flows = fs.readdirSync(flowDir)
    .filter(name => /^\d\d-.*\.json$/i.test(name) && !name.startsWith('25-'))
    .sort();

  assert.equal(flows.length, 26, `esperados 26 fluxos de usuario, encontrados ${flows.length}`);
  assert.equal(flows[0], '00-smoke.json');
  assert.equal(flows.at(-1), '26-finance-integracao.json');

  const release = JSON.parse(read('.artisys/release.json'));
  assert.match(String(release.steps.qa), /qa-release-full\.ps1/);

  const gate = read('scripts/qa-release-full.ps1');
  assert.match(gate, /\$passed\s+-ne\s+26/);
  assert.match(gate, /\$failed\s+-ne\s+0/);
  assert.match(gate, /26\/26 fluxos/);
  assert.match(gate, /qa-installed-smoke\.ps1/);
  assert.match(gate, /ArtiSys-PDV-\*-Setup\.exe/);
});
