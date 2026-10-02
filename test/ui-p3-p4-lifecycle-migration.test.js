'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('P3 shell surfaces use semantic lifecycle without MutationObserver',()=>{
  const expectations=[
    ['desktop/renderer/classic-home-ui.js',['PdvUiLifecycle','route:mounted','route:updated','user:changed']],
    ['desktop/renderer/route-scroll-ui.js',['PdvUiLifecycle','route:before','route:mounted']],
    ['desktop/renderer/first-access-ui.js',['PdvUiLifecycle','auth:rendered']],
    ['desktop/renderer/sale-observation-ui.js',['PdvUiLifecycle','route:mounted','route:updated']]
  ];
  for(const [file,markers] of expectations){
    const source=read(file);
    markers.forEach(marker=>assert.ok(source.includes(marker),`${file}: missing ${marker}`));
    assert.doesNotMatch(source,/new MutationObserver\b/,`${file}: observer must be retired`);
  }
  const app=read('desktop/renderer/app.js');
  assert.match(app,/emit\('user:changed'/);
  assert.match(app,/emit\('auth:rendered'/);
  const operational=read('desktop/renderer/operational-pages.js');
  assert.match(operational,/routeRegistry\.updated\('sales',\{surface:'sale-detail'\}\)/);
});

test('P4 Admin Fiscal NFS-e and Settings hub use lifecycle and announce settings extensions',()=>{
  const extensions=[
    ['desktop/renderer/admin-ops.js','admin-ops'],
    ['desktop/renderer/fiscal-config-ui.js','fiscal-config'],
    ['desktop/renderer/fiscal-monitor.js','fiscal-monitor'],
    ['desktop/renderer/nfse-ui.js','nfse']
  ];
  for(const [file,extension] of extensions){
    const source=read(file);
    assert.match(source,/PdvUiLifecycle/,`${file}: lifecycle missing`);
    assert.match(source,/route:mounted/,`${file}: mounted hook missing`);
    assert.match(source,/route:updated/,`${file}: updated hook missing`);
    assert.ok(source.includes(`extension:'${extension}'`),`${file}: extension update missing`);
    assert.doesNotMatch(source,/new MutationObserver\b/,`${file}: observer must be retired`);
  }
  const hub=read('desktop/renderer/settings-hub-ui.js');
  assert.match(hub,/route:mounted/);
  assert.match(hub,/route:updated/);
  assert.doesNotMatch(hub,/MutationObserver|legacyObserver/);
  for(const file of ['desktop/renderer/fiscal-config-ui.js','desktop/renderer/fiscal-monitor.js','desktop/renderer/nfse-ui.js']){
    assert.match(read(file),/settingsCategory='fiscal'/,`${file}: explicit fiscal category required`);
  }
});

test('auth lifecycle is published only after canonical setup and login form bindings',()=>{
  const app=read('desktop/renderer/app.js');
  const setupBind=app.indexOf("authOverlay.querySelector('#setup-form').addEventListener");
  const setupEmit=app.indexOf("emit('auth:rendered', { surface:'setup' })");
  const loginBind=app.indexOf("authOverlay.querySelector('#login-form').addEventListener");
  const loginEmit=app.indexOf("emit('auth:rendered', { surface:'login' })");
  assert.ok(setupBind>=0&&setupEmit>setupBind,'setup lifecycle must fire after binding');
  assert.ok(loginBind>=0&&loginEmit>loginBind,'login lifecycle must fire after binding');
});
