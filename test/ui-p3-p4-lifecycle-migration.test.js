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

test('P4 Admin and Settings hub use lifecycle and announce settings extensions',()=>{
  const source=read('desktop/renderer/admin-ops.js');
  assert.match(source,/PdvUiLifecycle/,'admin-ops lifecycle missing');
  assert.match(source,/route:mounted/,'admin-ops mounted hook missing');
  assert.match(source,/route:updated/,'admin-ops updated hook missing');
  assert.ok(source.includes("extension:'admin-ops'"),'admin-ops extension update missing');
  assert.doesNotMatch(source,/new MutationObserver\b/,'admin-ops observer must be retired');

  const hub=read('desktop/renderer/settings-hub-ui.js');
  assert.match(hub,/route:mounted/);
  assert.match(hub,/route:updated/);
  assert.doesNotMatch(hub,/MutationObserver|legacyObserver/);
  assert.doesNotMatch(hub,/fiscal|nfse/i);
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
