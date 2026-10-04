'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(root,relative),'utf8');

test('P5 simple extensions consume semantic lifecycle without MutationObserver',()=>{
  const files=[
    'desktop/renderer/catalog-user-management-ui.js',
    'desktop/renderer/delivery-address-ui.js',
    'desktop/renderer/kits-combos-ui.js',
    'desktop/renderer/module-state-sync.js',
    'desktop/renderer/operational-friendly-fields.js'
  ];
  for(const file of files){
    const source=read(file);
    assert.match(source,/PdvUiLifecycle/,file);
    assert.doesNotMatch(source,/new MutationObserver\b/,file);
  }
});

test('shared modal and enterprise subflows publish the P5 semantic triggers',()=>{
  const app=read('desktop/renderer/app.js');
  const enterprise=read('desktop/renderer/enterprise-depth-ui.js');
  const vertical=read('desktop/renderer/vertical-modules.js');
  assert.match(app,/emit\('modal:mounted'/);
  assert.match(app,/emit\('modal:closed'/);
  for(const surface of ['enterprise-purchases','enterprise-logistics','enterprise-orders']){
    assert.ok(enterprise.includes(`surface:'${surface}'`),surface);
  }
  assert.match(vertical,/emit\('surface:mounted'/);
  assert.match(vertical,/surface:'module-workspace'/);
  assert.match(vertical,/surface:'module-area'/);
});

test('operational friendly fields listen to route modal and module surfaces',()=>{
  const source=read('desktop/renderer/operational-friendly-fields.js');
  for(const marker of ['route:mounted','route:updated','surface:mounted','modal:mounted']) assert.ok(source.includes(marker),marker);
});

test('catalog customer actions survive incremental list rebuilds',()=>{
  const source=read('desktop/renderer/catalog-user-management-ui.js');
  assert.match(source,/data-remove-customer/);
  assert.doesNotMatch(source,/if\(root\.dataset\.catalogDeletionEnhanced==='1'\)return/);
  assert.match(source,/route==='customers'&&surface==='customers-list'\)scheduleMount\(\)/);
  assert.match(source,/root\.querySelectorAll\('\[data-edit-customer\]'\)\.forEach/);
  assert.match(source,/let remountRequested=false/);
  assert.match(source,/if\(mounting\)\{remountRequested=true;return;\}/);
  assert.match(source,/if\(remountRequested\)\{remountRequested=false;scheduleMount\(\);\}/);
});

test('all remaining complex extensions consume lifecycle without DOM observers',()=>{
  const files=[
    'desktop/renderer/operational-route-extensions.js',
    'desktop/renderer/e48-e54-ui.js',
    'desktop/renderer/enterprise-depth-ui.js',
    'desktop/renderer/restaurant-public-ordering-ui.js',
    'desktop/renderer/operational-detail-extensions.js',
    'desktop/renderer/vertical-modules.js',
    'desktop/renderer/vertical-parity-p1.js'
  ];
  for(const file of files){
    const source=read(file);
    assert.doesNotMatch(source,/new MutationObserver\\b/,file);
  }
  const finalModules=read('desktop/renderer/e48-e54-ui.js');
  for(const marker of ['PdvUiLifecycle','route:mounted','route:updated','surface:mounted']) assert.ok(finalModules.includes(marker),marker);
});
