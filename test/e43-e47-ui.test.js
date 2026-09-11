'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('desktop loads optional module API and workspace extensions',()=>{
  const html=read('desktop/renderer/index.html');
  assert.match(html,/vertical-modules\.css/);
  assert.match(html,/vertical-api-client\.js/);
  assert.match(html,/vertical-modules\.js/);
});

test('vertical UI gates segment cards from enabled module state',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  for(const id of ['PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY'])assert.match(source,new RegExp(id));
  assert.match(source,/\.filter\(module=>module\.enabled\)/);
  assert.match(source,/modules\(\)/);
  assert.match(source,/saveSetting/);
});

test('commercial desktop extension sanitizes legacy TEF wording to manual credit copy',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  assert.match(source,/sanitizeLegacyPaymentCopy/);
  assert.match(source,/Cartão crédito \/ TEF/);
  assert.match(source,/Cartão crédito/);
  assert.match(source,/NÃO FISCAL/);
});

test('desktop main authenticates local vertical API calls without exposing install token to renderer',()=>{
  const main=read('desktop/main.cjs');
  const preload=read('desktop/preload.cjs');
  assert.match(main,/rawPath\.startsWith\('\/api\/v1\/vertical\/'\)/);
  assert.doesNotMatch(preload,/installToken|x-pdv-token/);
});
