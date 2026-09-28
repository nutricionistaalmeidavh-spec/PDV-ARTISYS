'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('legacy build promotes Electron 22 native runtimes to production dependencies before packaging', () => {
  const prepare = read('scripts/prepare-legacy-runtime.cjs');
  const workflow = read('.github/workflows/build-windows-legacy.yml');

  assert.match(prepare, /--save-prod/);
  assert.doesNotMatch(prepare, /--no-save/);
  assert.match(workflow, /node scripts\/prepare-legacy-runtime\.cjs/);
  assert.doesNotMatch(workflow, /npm install --no-save[^\n]*better-sqlite3/);
});

test('legacy workflow verifies the packaged SQLite native binary before uploading installers', () => {
  const workflow = read('.github/workflows/build-windows-legacy.yml');

  assert.match(workflow, /Verify legacy native runtime packaging/);
  assert.match(workflow, /better_sqlite3\.node/);
  assert.match(workflow, /app\.asar\.unpacked/);
});
