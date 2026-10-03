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

test('remaining complex observers stay scoped while delivery surfaces use lifecycle',()=>{
  const expected=[
    ['desktop/renderer/backend-parity-ui.js',1],
    ['desktop/renderer/e48-e54-ui.js',2],
    ['desktop/renderer/enterprise-depth-ui.js',1],
    ['desktop/renderer/restaurant-public-ordering-ui.js',1],
    ['desktop/renderer/ui-parity-p0-p2.js',1]
  ];
  let total=0;
  for(const [file,count] of expected){
    const source=read(file);
    const actual=(source.match(/new MutationObserver\b/g)||[]).length;
    assert.equal(actual,count,`${file}: expected ${count}, got ${actual}`);
    total+=actual;
  }
  for(const file of ['desktop/renderer/vertical-modules.js','desktop/renderer/vertical-parity-p1.js']){
    assert.doesNotMatch(read(file),/new MutationObserver\b/,file);
  }
  assert.equal(total,6);
});
