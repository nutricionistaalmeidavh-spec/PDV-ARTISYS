'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));

test('release profile gates publication after build, installer and QA', () => {
  const config = readJson('.artisys/release.json');
  assert.equal(config.version, '1.3.4');
  assert.deepEqual(config.requiredSteps, ['deps','lint','test','build','installer','qa']);
  assert.deepEqual(config.requiredStepsByProfile.release, ['security','evidence','publish']);
  assert.match(config.steps.qa, /qa:full/);
  assert.match(config.steps.security.command, /security-gate\.ps1/);
  assert.match(config.steps.evidence.command, /release-evidence\.cjs/);
  assert.match(config.steps.publish.command, /publish-github-release\.ps1/);
});

test('Woodpecker publication is tag-only and uses the release profile', () => {
  const pipeline = read('.woodpecker/pdv-publish.yaml');
  assert.match(pipeline, /event: tag/);
  assert.match(pipeline, /refs\/tags\/v\*/);
  assert.match(pipeline, /-Profile release/);
  assert.doesNotMatch(pipeline, /event: push/);
  assert.match(pipeline, /GITHUB_RELEASE_TOKEN|GITHUB_REPORT_TOKEN/);
});

test('publisher requires updater assets and blocks publication outside tag events', () => {
  const publisher = read('scripts/publish-github-release.ps1');
  assert.match(publisher, /latest\\\.yml|latest\.yml/);
  assert.match(publisher, /blockmap/);
  assert.match(publisher, /ArtiSys-PDV/);
  assert.match(publisher, /CI_PIPELINE_EVENT/);
  assert.match(publisher, /-ne 'tag'/);
});

test('release evidence hashes installer and updater metadata', () => {
  const evidence = read('scripts/release-evidence.cjs');
  assert.match(evidence, /sha256/);
  assert.match(evidence, /latest\\\.yml|latest\.yml/);
  assert.match(evidence, /blockmap/);
});

test('host hardening checks the self-hosted Woodpecker stack', () => {
  const health = read('infra/woodpecker/health-check.ps1');
  assert.match(health, /woodpecker-agent/);
  assert.match(health, /cloudflared/);
  assert.match(health, /artisys-release/);
  assert.match(health, /artisys-ci-reporter/);
  assert.match(health, /ci\.artisys\.dev\/healthz/);
});
