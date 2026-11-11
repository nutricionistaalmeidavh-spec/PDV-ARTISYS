'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const pkg=JSON.parse(read('package.json'));
const lock=JSON.parse(read('package-lock.json'));
const workflow=read('.github/workflows/release-windows.yml');

test('consolidated release identifies one stable version and verified dependency floor',()=>{
  assert.equal(pkg.version,'2.0.13');
  assert.equal(lock.version,pkg.version);
  assert.equal(lock.packages[''].version,pkg.version);
  assert.equal(pkg.dependencies.xlsx,'npm:@e965/xlsx@0.20.3');
  assert.equal(lock.packages['node_modules/xlsx'].version,'0.20.3');
  assert.equal(pkg.devDependencies.electron,'44.11.1');
  assert.equal(lock.packages['node_modules/electron'].version,'44.11.1');
});

test('merging code alone cannot silently release to commercial customers',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/\.github\/release-trigger/);
  assert.match(workflow,/gh release create/);
  assert.match(workflow,/latest\.yml/);
  assert.match(workflow,/npm run verify:release/);
  assert.match(workflow,/npm run dist:win(?:\s|$)/m);
  assert.doesNotMatch(workflow,/dist:win:fiscal|dist:win:acbr/i);
  assert.match(read('docs/operations/update.md'),/merge comum na `main` \*\*não publica\*\*/i);
});
