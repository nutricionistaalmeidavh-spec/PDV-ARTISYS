'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

const IDS=['RESTAURANT','PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY','RETAIL','SERVICES','WORKSHOP','SELF_SERVICE'];

test('workspace sync listens to generic module state and marks all module workspaces',()=>{
  const source=read('desktop/renderer/module-state-sync.js');
  assert.match(source,/artisys:modules-state-changed/);
  assert.match(source,/data-module-workspace/);
  assert.match(source,/MutationObserver/);
  assert.match(source,/showRoute\?\.\('settings'\)/);
  for(const id of IDS)assert.match(source,new RegExp(`${id}:`),`${id} deve ter heading mapeado`);
});

test('module state sync loads after vertical renderers',()=>{
  const html=read('desktop/renderer/index.html');
  const sync=html.indexOf('./module-state-sync.js');
  assert.ok(sync>html.indexOf('./vertical-modules.js'));
  assert.ok(sync>html.indexOf('./e48-e54-ui.js'));
});
