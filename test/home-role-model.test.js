'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const ui=require('../desktop/renderer/ui-model');
const policy=require('../desktop/renderer/access-policy');
const {homeForUser}=require('../desktop/renderer/home-role-model');

const baseTiles=[...ui.HOME_TILES,{key:'management',label:'Gestão',description:'Resultado, DRE e fluxo de caixa',route:'management',tone:'cyan',icon:'chart'}];
const user=permissions=>({profile:{id:'profile-test',name:'Perfil'},permissions});
const keys=permissions=>homeForUser(user(permissions),baseTiles).sections.flatMap(section=>section.tiles.map(tile=>tile.key));

test('operator Home is derived from capabilities',()=>{
  assert.deepEqual(keys(['sales.create','sales.view','returns.view','cash.view','customers.view','products.view']),['checkout','cash','post-sale','catalog']);
});

test('management and access hubs appear only for granted capabilities',()=>{
  assert.deepEqual(
    keys(['sales.create','sales.view','returns.view','cash.view','customers.view','products.view','inventory.view','finance.view','reports.view','management.view']),
    ['checkout','cash','post-sale','catalog','financial-management']
  );
  assert.deepEqual(
    keys(['sales.create','sales.view','returns.view','cash.view','customers.view','products.view','inventory.view','finance.view','reports.view','management.view','users.view','settings.view']),
    ['checkout','cash','post-sale','catalog','financial-management','access','settings']
  );
});

test('route policy checks capabilities rather than role/profile names',()=>{
  const operator=user(['sales.create','sales.view','returns.view','cash.view','customers.view','products.view']);
  assert.equal(policy.canAccessRoute(operator,'catalog'),true);
  assert.equal(policy.canAccessRoute(operator,'customers'),true);
  assert.equal(policy.canAccessRoute(operator,'products'),true);
  assert.equal(policy.canAccessRoute(operator,'reports'),false);
  assert.equal(policy.canAccessRoute(operator,'settings'),false);

  const manager=user(['products.view','inventory.view','sellers.view','finance.view','reports.view','management.view']);
  assert.equal(policy.canAccessRoute(manager,'products'),true);
  assert.equal(policy.canAccessRoute(manager,'inventory'),true);
  assert.equal(policy.canAccessRoute(manager,'sellers'),true);
  assert.equal(policy.canAccessRoute(manager,'financial-management'),true);
});
