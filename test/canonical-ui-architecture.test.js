'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('renderer architecture has zero DOM mutation observers',()=>{
  const rendererDir=path.join(root,'desktop/renderer');
  const files=fs.readdirSync(rendererDir).filter(name=>name.endsWith('.js'));
  const offenders=[];
  for(const file of files){
    const source=fs.readFileSync(path.join(rendererDir,file),'utf8');
    const count=(source.match(/new\s+MutationObserver\b/g)||[]).length;
    if(count)offenders.push(file+':'+count);
  }
  assert.deepEqual(offenders,[]);
});

test('Home canonical renderer does not depend on hidden native Home controls',()=>{
  const home=read('desktop/renderer/classic-home-ui.js');
  assert.doesNotMatch(home,/baseHome\s*=|nativeHome|\.home-grid:not\(#classic-home-grid\)/);
  assert.doesNotMatch(home,/nativeLauncher|\.click\(\)/);
  assert.match(home,/PdvAppNavigation/);
});

test('legacy parity and reporting UI bridges are retired from the desktop entrypoint',()=>{
  const index=read('desktop/renderer/index.html');
  for(const retired of [
    'backend-parity-ui.js',
    'ui-parity-p0-p2.js',
    'reporting-v2-legacy-export.js'
  ]) assert.equal(index.includes(retired),false,retired);
});

test('retired parity bridge files are removed after ownership migration',()=>{
  for(const relative of [
    'desktop/renderer/backend-parity-ui.js',
    'desktop/renderer/ui-parity-p0-p2.js',
    'desktop/renderer/reporting-v2-legacy-export.js'
  ]) assert.equal(fs.existsSync(path.join(root,relative)),false,relative);
});

test('toast API no longer monkey-patches appendChild for legacy callers',()=>{
  const toast=read('desktop/renderer/toast-ui.js');
  assert.doesNotMatch(toast,/installLegacyAppendBridge|appendChild\s*=\s*function\s+appendManagedToast/);
});
