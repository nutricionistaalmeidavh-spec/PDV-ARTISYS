'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve('.');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('recipe component number inputs accept ordinary whole-number quantities',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/data-recipe-quantity type="number" min="0\.001" step="0\.001"/);
  assert.match(app,/data-recipe-conversion type="number" min="0\.001" step="0\.001"/);
  assert.doesNotMatch(app,/data-recipe-(?:quantity|conversion) type="number" min="0\.0001"/);
});

test('restaurant checkout opens the exact sale created from the comanda',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.match(restaurant,/PdvAppNavigation\?\.openCheckoutSale\?\.\(result\.sale\.id\)/);
  assert.doesNotMatch(restaurant,/document\.querySelector\('\[data-route="checkout"\]'\)\?\.click\(\)/);
});


test('QA food environment starts as LAN host before Electron boot so QR can be rendered',()=>{
  const qaDesktop=read('qa/desktop/main.cjs');
  const config=JSON.parse(read('qa/artisys-qa.config.json'));
  assert.equal(config.environments['food-ci'].env.ARTISYS_QA_LAN_HOST,'1');
  assert.match(qaDesktop,/ARTISYS_QA_LAN_HOST/);
  assert.match(qaDesktop,/data-server\.json/);
  assert.match(qaDesktop,/mode:'lan-host'/);
});

test('openCheckoutSale preserves the requested restaurant sale after checkout navigation restores state',()=>{
  const app=read('desktop/renderer/app.js');
  const start=app.indexOf('async function openCheckoutSale');
  const end=app.indexOf('function registerBaseRoutes',start);
  const block=app.slice(start,end);
  const navigateAt=block.indexOf("await navigate('checkout')");
  const assignAt=block.indexOf('state.sale=sale',navigateAt);
  assert.ok(navigateAt>=0,'checkout navigation must happen');
  assert.ok(assignAt>navigateAt,'exact requested sale must be restored after navigation');
});
