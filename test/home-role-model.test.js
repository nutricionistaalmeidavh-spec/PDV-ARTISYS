'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../desktop/renderer/ui-model');
const { canAccessRoute, homeForRole, routesForRole } = require('../desktop/renderer/home-role-model');

const baseTiles = [...ui.HOME_TILES, {
  key:'management', label:'Gestão', description:'Resultado, DRE e fluxo de caixa',
  route:'management', tone:'cyan', icon:'chart'
}];
const keys = (role) => homeForRole(role, baseTiles).sections.flatMap((section) => section.tiles.map((tile) => tile.key));

test('cashier Home exposes only four top-level daily workflows', () => {
  assert.deepEqual(keys('cashier'), ['checkout','cash','post-sale','catalog']);
});

test('manager and administrator Home use the same five top-level workflow hubs', () => {
  const expected=['checkout','cash','post-sale','catalog','financial-management'];
  assert.deepEqual(keys('manager'), expected);
  assert.deepEqual(keys('admin'), expected);
});

test('unknown roles receive the restricted cashier Home', () => {
  assert.equal(homeForRole('unknown', baseTiles).role, 'cashier');
});

test('cashier navigation keeps customer access through Cadastros without exposing management routes', () => {
  assert.deepEqual(routesForRole('cashier'), ['home','checkout','cash','post-sale','catalog']);
  assert.equal(canAccessRoute('cashier','catalog'), true);
  assert.equal(canAccessRoute('cashier','customers'), true);
  assert.equal(canAccessRoute('cashier','products'), false);
  assert.equal(canAccessRoute('cashier','reports'), false);
  assert.equal(canAccessRoute('cashier','settings'), false);
});

test('manager navigation contains only top-level hubs, not their child routes', () => {
  assert.deepEqual(routesForRole('manager'), ['home','checkout','cash','post-sale','catalog','financial-management']);
  for(const child of ['products','inventory','customers','sellers','sales','returns','finance','reports','management']){
    assert.equal(routesForRole('manager').includes(child),false,child);
  }
  assert.equal(canAccessRoute('manager','products'),true);
  assert.equal(canAccessRoute('manager','inventory'),true);
  assert.equal(canAccessRoute('manager','sellers'),true);
});
