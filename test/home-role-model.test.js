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

test('cashier Home exposes only the four daily operation entries', () => {
  assert.deepEqual(keys('cashier'), ['checkout','cash','sales','returns']);
});

test('manager Home prioritizes management and keeps operational access', () => {
  const routes = keys('manager');
  assert.deepEqual(routes.slice(0, 2), ['financial-management','inventory']);
  assert.ok(routes.includes('cash'));
  assert.ok(routes.includes('products'));
});

test('administrator Home keeps only the eight primary operation and management cards', () => {
  assert.deepEqual(keys('admin'), ['financial-management','inventory','checkout','cash','sales','returns','products','customers']);
});

test('unknown roles receive the restricted cashier Home', () => {
  assert.equal(homeForRole('unknown', baseTiles).role, 'cashier');
});

test('cashier navigation combines post-sale while keeping customer access', () => {
  assert.deepEqual(routesForRole('cashier'), ['home','checkout','cash','post-sale','customers']);
  assert.equal(canAccessRoute('cashier','reports'), false);
  assert.equal(canAccessRoute('cashier','settings'), false);
  assert.equal(canAccessRoute('cashier','customers'), true);
});

test('manager navigation combines products with stock and sales with returns', () => {
  const routes=routesForRole('manager');
  assert.ok(routes.includes('catalog'));
  assert.ok(routes.includes('post-sale'));
  assert.equal(routes.includes('products'),false);
  assert.equal(routes.includes('inventory'),false);
  assert.equal(routes.includes('sales'),false);
  assert.equal(routes.includes('returns'),false);
  assert.ok(routes.includes('financial-management'));
  assert.equal(routes.includes('finance'),false);
  assert.equal(routes.includes('reports'),false);
  assert.equal(routes.includes('management'),false);
});
