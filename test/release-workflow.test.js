'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

function resolveVersion(args) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/resolve-release-version.js'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

test('automatic release increments the latest published patch version', () => {
  const result = resolveVersion([
    '--package-version', '1.4.1',
    '--latest-release-tag', 'v1.4.1',
    '--latest-target', 'old-commit',
    '--current-commit', 'new-commit'
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '1.4.2');
});

test('automatic release is idempotent when rerun for the already published commit', () => {
  const result = resolveVersion([
    '--package-version', '1.4.1',
    '--latest-release-tag', 'v1.4.2',
    '--latest-target', 'same-commit',
    '--current-commit', 'same-commit'
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '1.4.2');
});

test('automatic release respects an intentional package version ahead of the latest release', () => {
  const result = resolveVersion([
    '--package-version', '1.5.0',
    '--latest-release-tag', 'v1.4.9',
    '--latest-target', 'old-commit',
    '--current-commit', 'new-commit'
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '1.5.0');
});

test('release workflow runs for relevant main changes and publishes updater metadata', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/release-windows.yml'), 'utf8');
  assert.match(workflow, /branches:\s*\n\s*- main/);
  assert.match(workflow, /- 'desktop\/\*\*'/);
  assert.match(workflow, /- 'js\/\*\*'/);
  assert.match(workflow, /- 'server\/\*\*'/);
  assert.match(workflow, /- 'package\.json'/);
  assert.match(workflow, /concurrency:/);
  assert.match(workflow, /Resolve automatic release version/);
  assert.match(workflow, /resolve-release-version\.js/);
  assert.match(workflow, /npm version .*--no-git-tag-version.*--allow-same-version/);
  assert.match(workflow, /dist\/latest\.yml/);
  assert.match(workflow, /dist\/\*\.blockmap/);
});
