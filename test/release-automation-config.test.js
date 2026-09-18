'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname,'..');

test('release profile requires security, evidence and publish only on release', () => {
  const config = JSON.parse(fs.readFileSync(path.join(root,'.artisys','release.json'),'utf8'));
  assert.deepEqual(config.requiredStepsByProfile.release,['security','evidence','publish']);
  assert.deepEqual(config.steps.security.profiles,['release']);
  assert.deepEqual(config.steps.evidence.profiles,['release']);
  assert.deepEqual(config.steps.publish.profiles,['release']);
});

test('desktop package contains auto-update publishing metadata', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  assert.equal(pkg.main,'desktop/updater-main.cjs');
  assert.ok(pkg.dependencies['electron-updater']);
  assert.equal(pkg.build.publish[0].provider,'github');
  assert.equal(pkg.build.publish[0].repo,'PDV-ARTISYS');
});
