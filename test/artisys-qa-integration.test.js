import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('pins ArtiSys QA 1.2.0 from the approved central commit', () => {
  const lock = readJson('qa/artisys-qa.lock.json');
  const runtime = readJson('qa/runtime/package.json');
  assert.equal(lock.module, '@artisys/qa');
  assert.equal(lock.version, '1.2.0');
  assert.equal(lock.sourceCommit, '2af6556937c7a4074f641069a2e1a6bb02bf942f');
  assert.equal(runtime.version, '1.2.0');
});

test('vendors the modular 1.2 demo platform and common flow library', () => {
  for (const relative of [
    'qa/runtime/src/cli.mjs',
    'qa/runtime/src/adapters.js',
    'qa/runtime/src/demo-profile.js',
    'qa/runtime/src/fixture-registry.js',
    'qa/runtime/src/flow-library.js',
    'qa/runtime/src/redaction.js',
    'qa/runtime/flows/common/login.json',
    'qa/runtime/flows/common/dashboard-tour.json',
  ]) assert.equal(fs.existsSync(path.join(root, relative)), true, relative);

  const wrapper = fs.readFileSync(path.join(root, 'qa/runtime/artisys-qa.mjs'), 'utf8');
  assert.match(wrapper, /import ['"]\.\/src\/cli\.mjs['"]/);
});

test('QA workflow invokes the 1.2 CLI with explicit run and demo commands', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/qa-capture.yml'), 'utf8');
  assert.match(workflow, /artisys-qa\.mjs demo/);
  assert.match(workflow, /artisys-qa\.mjs run/);
});
