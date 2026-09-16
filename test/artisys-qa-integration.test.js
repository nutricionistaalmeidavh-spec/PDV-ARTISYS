import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('.');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
const readText = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('pins the synchronized ArtiSys QA 2.4.1 runtime to an exact central revision', () => {
  const lock = readJson('qa/artisys-qa.lock.json');
  const runtime = readJson('qa/runtime/package.json');
  assert.equal(lock.schemaVersion, 2);
  assert.equal(lock.module, '@artisys/qa');
  assert.equal(lock.version, '2.4.1');
  assert.equal(lock.sourceRepository, 'nutricionistaalmeidavh-spec/utilidades');
  assert.equal(lock.sourcePath, 'modules/artisys-qa');
  assert.equal(lock.sourceCommit, '850db8188bf49c8083441a3b5e814b3f61fc0fe8');
  assert.equal(lock.sourceTree, 'f2bd3bd048207d9bf5a442287f0ad779e436cd8a');
  assert.equal(lock.consumption, 'vendored-runtime');
  assert.equal(lock.policy.runtimeParity, 'src/** matches the pinned central module revision');
  assert.equal(lock.policy.runtimeSelection, 'qaProfiles');
  assert.equal(lock.policy.ciNeedsSourceRepositoryAccess, false);
  assert.equal(lock.policy.updateCommand, 'npm run qa:update');
  assert.equal(runtime.name, '@artisys/qa');
  assert.equal(runtime.version, '2.4.1');
});

test('vendors the 2.4.1 runtime capabilities used by CI and optional local QA', () => {
  for (const relative of [
    'qa/runtime/src/cli.mjs',
    'qa/runtime/src/profile-runner.js',
    'qa/runtime/src/profiles.js',
    'qa/runtime/src/visual.js',
    'qa/runtime/src/remote-control.js',
    'qa/runtime/src/agent-cli.mjs',
    'qa/runtime/src/agent-state.js',
    'qa/runtime/src/agent-updater.js',
    'qa/runtime/src/agent-supervisor.js',
    'qa/runtime/src/agent-console.js',
    'qa/runtime/src/telemetry-store.js',
    'qa/runtime/src/cloud-observability.js',
    'qa/runtime/src/bridge-jobs.js',
    'qa/runtime/src/bridge-worker.js',
    'qa/runtime/src/project-bootstrap.js',
    'qa/runtime/src/drive-uploader.js',
    'qa/runtime/src/artifact-index.js',
    'qa/runtime/src/progress-protocol.js',
    'qa/runtime/src/release-gate.js',
    'qa/runtime/src/desktop.js',
    'qa/runtime/src/network.js',
  ]) assert.equal(fs.existsSync(path.join(root, relative)), true, relative);

  const wrapper = readText('qa/runtime/artisys-qa.mjs');
  assert.match(wrapper, /import ['"]\.\/src\/cli\.mjs['"]/);
});

test('PDV selects QA behavior through repository-owned profiles', () => {
  const config = readJson('qa/artisys-qa.config.json');
  assert.deepEqual(config.qaProfiles.quick.flows, ['smoke']);
  assert.deepEqual(config.qaProfiles.full.flows, ['smoke', 'home', 'sales-enhancements']);
  assert.deepEqual(config.qaProfiles.release.criticalFlows, ['smoke', 'home', 'sales-enhancements']);
  assert.equal(config.qaProfiles.quick.includeVisual, false);
  assert.equal(config.qaProfiles.quick.includeDesktop, false);
  assert.equal(config.qaProfiles.quick.includeNetwork, false);
});

test('future QA updates are explicit, local-first and preserve consumer configuration', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.scripts['qa:update'], 'node scripts/sync-artisys-qa.mjs');
  assert.match(pkg.scripts['qa:quick'], /artisys-qa\.mjs quick/);
  assert.match(pkg.scripts['qa:full'], /artisys-qa\.mjs full/);
  assert.match(pkg.scripts['qa:release'], /artisys-qa\.mjs release/);

  const sync = readText('scripts/sync-artisys-qa.mjs');
  assert.match(sync, /ARTISYS_QA_SOURCE/);
  assert.match(sync, /qa\/artisys-qa\.config\.json/);
  assert.match(sync, /bridge\/projects\.json/);
  assert.equal(sync.includes('bridge/jobs/pending/*.json'), true);
});

test('CircleCI runs release verification before the configured quick QA profile', () => {
  const circle = readText('.circleci/config.yml');
  assert.match(circle, /command: npm run verify:release/);
  assert.match(circle, /xvfb-run -a npm run qa:quick/);
  assert.match(circle, /qa_smoke:\s*\n\s*requires:\s*\n\s*- verify/);
  assert.doesNotMatch(circle, /--flow smoke/);
});

test('GitHub QA capture remains compatible with run and demo commands', () => {
  const workflow = readText('.github/workflows/qa-capture.yml');
  assert.match(workflow, /artisys-qa\.mjs demo/);
  assert.match(workflow, /artisys-qa\.mjs run/);
});
