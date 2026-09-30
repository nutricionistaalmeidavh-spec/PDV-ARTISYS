'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ui = require('../desktop/renderer/ui-model');
const { canAccessRoute, canAccessModule, homeForRole, routesForRole } = require('../desktop/renderer/home-role-model');

const baseTiles = [...ui.HOME_TILES, {
  key:'management', label:'Gestão', description:'Resultado, DRE e fluxo de caixa',
  route:'management', tone:'cyan', icon:'chart'
}];
const keys = (role) => homeForRole(role, baseTiles).sections.flatMap((section) => section.tiles.map((tile) => tile.key));

test('cashier Home exposes only the four daily operation entries', () => {
  assert.deepEqual(keys('cashier'), ['checkout','cash','sales','returns']);
});

test('manager Home prioritizes management and keeps operational access', () => {
  const routes = keys('manager');
  assert.deepEqual(routes.slice(0, 4), ['management','inventory','finance','reports']);
  assert.ok(routes.includes('cash'));
  assert.ok(routes.includes('sellers'));
});

test('administrator Home starts with the five administration areas', () => {
  assert.deepEqual(keys('admin').slice(0, 5), ['team','devices','fiscal','backup','modules']);
});

test('unknown roles receive the restricted cashier Home', () => {
  assert.equal(homeForRole('unknown', baseTiles).role, 'cashier');
});

test('cashier navigation omits management routes but keeps customer access', () => {
  assert.deepEqual(routesForRole('cashier'), ['home','checkout','cash','sales','returns','customers']);
  assert.equal(canAccessRoute('cashier','reports'), false);
  assert.equal(canAccessRoute('cashier','settings'), false);
  assert.equal(canAccessRoute('cashier','customers'), true);
});

test('optional modules are restricted to manager and administrator roles', () => {
  assert.equal(canAccessModule('cashier'), false);
  assert.equal(canAccessModule('manager'), true);
  assert.equal(canAccessModule('admin'), true);
});
