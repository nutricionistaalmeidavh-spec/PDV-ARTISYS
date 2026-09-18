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

test('release QA always exports its structured summary before failing the wrapper', () => {
  const gate = read('scripts/qa-release-full.ps1');
  assert.match(gate, /qa-summary\.json/i);
  assert.match(gate, /Copy-Item/i);

  const copyIndex = gate.indexOf('Copy-Item');
  const wrapperFailureIndex = gate.indexOf('qa:user:all falhou');
  assert.ok(copyIndex >= 0, 'o resumo do QA deve ser copiado para artifacts/');
  assert.ok(wrapperFailureIndex >= 0, 'o wrapper deve manter erro explícito de qa:user:all');
  assert.ok(copyIndex < wrapperFailureIndex, 'o resumo estruturado precisa ser exportado antes do throw');
});

test('release QA preserves raw log and synthesizes reporter summary when runtime summary is missing', () => {
  const gate = read('scripts/qa-release-full.ps1');
  assert.match(gate, /qa-user-all\.log/);
  assert.match(gate, /Write-FallbackQaSummary/);
  assert.match(gate, /lastFlow/);
  assert.match(gate, /lastFailure/);
  assert.match(gate, /qa-summary-missing/);
  assert.match(gate, /qa-exit-without-failed-flow/);
  assert.doesNotMatch(gate, /throw \"QA-SUMMARY\.json nao encontrado apos qa:user:all/);
});
