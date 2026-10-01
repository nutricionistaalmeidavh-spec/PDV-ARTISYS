'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('../server/local-server');

async function startFixture() {
  const runtime = createPdvRuntime();
  runtime.catalog.createUser({ id:'admin', username:'admin', name:'Admin', role:'admin', password:'senha-forte-admin', active:true });
  runtime.catalog.createUser({ id:'manager', username:'manager', name:'Gerente', role:'manager', password:'senha-forte-manager', active:true });
  runtime.catalog.createUser({ id:'cashier', username:'cashier', name:'Caixa', role:'cashier', password:'senha-forte-cashier', active:true });
  runtime.catalog.upsertCategory({ id:'food', name:'Alimentos' }, { userId:'admin', role:'admin' });
  runtime.catalog.upsertProduct({ id:'pizza', sku:'PIZZA', name:'Pizza', salePriceCents:3000, costCents:1000, trackStock:false, categoryId:'food' }, { userId:'admin', role:'admin' });
  runtime.catalog.upsertProduct({ id:'ingredient', sku:'ING', name:'Ingrediente', salePriceCents:100, costCents:50, trackStock:true, categoryId:'food' }, { userId:'admin', role:'admin' });
  runtime.modules.setEnabled('PIZZERIA', true, { userId:'admin', role:'admin' });
  const server = createLocalServer({ runtime, host:'127.0.0.1', port:0, token:'local-token', requireTerminalAuth:false });
  const address = await server.start();
  return { runtime, server, base:`http://127.0.0.1:${address.port}` };
}

async function login(base, username, password) {
  const response = await fetch(`${base}/api/v1/auth/login`, {
    method:'POST',
    headers:{ 'content-type':'application/json' },
    body:JSON.stringify({ username, password, terminalId:'PDV-01' })
  });
  assert.equal(response.status, 200);
  return (await response.json()).sessionToken;
}

async function request(base, token, path, { method='GET', body }={}) {
  const headers = { authorization:`Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}${path}`, { method, headers, body:body === undefined ? undefined : JSON.stringify(body) });
}

test('vertical module API enforces accessRoles and manageRoles from module registry', async () => {
  const ctx = await startFixture();
  try {
    const admin = await login(ctx.base, 'admin', 'senha-forte-admin');
    const manager = await login(ctx.base, 'manager', 'senha-forte-manager');
    const cashier = await login(ctx.base, 'cashier', 'senha-forte-cashier');

    let response = await request(ctx.base, admin, '/api/v1/vertical/pizzeria/profile', {
      method:'POST', body:{ productId:'pizza', pricingPolicy:'HIGHEST_FLAVOR' }
    });
    assert.equal(response.status, 201);

    response = await request(ctx.base, manager, '/api/v1/vertical/pizzeria/products/pizza');
    assert.equal(response.status, 200);

    response = await request(ctx.base, cashier, '/api/v1/vertical/pizzeria/products/pizza');
    assert.equal(response.status, 403);

    response = await request(ctx.base, manager, '/api/v1/vertical/pizzeria/catalog', {
      method:'POST', body:{ kind:'size', productId:'pizza', name:'Grande', maxFlavors:2, priceDeltaCents:0 }
    });
    assert.equal(response.status, 403);

    response = await request(ctx.base, admin, '/api/v1/vertical/pizzeria/catalog', {
      method:'POST', body:{ kind:'size', productId:'pizza', name:'Grande', maxFlavors:2, priceDeltaCents:0 }
    });
    assert.equal(response.status, 201);
  } finally {
    await ctx.server.stop();
    ctx.runtime.close();
  }
});

test('recipe mutation is unavailable to cashier but remains available to manager', async () => {
  const ctx = await startFixture();
  try {
    const manager = await login(ctx.base, 'manager', 'senha-forte-manager');
    const cashier = await login(ctx.base, 'cashier', 'senha-forte-cashier');
    const body = { components:[{ productId:'ingredient', quantity:1, unit:'UN' }] };

    let response = await request(ctx.base, cashier, '/api/v1/vertical/recipes/pizza', { method:'PUT', body });
    assert.equal(response.status, 403);

    response = await request(ctx.base, manager, '/api/v1/vertical/recipes/pizza', { method:'PUT', body });
    assert.equal(response.status, 200);
  } finally {
    await ctx.server.stop();
    ctx.runtime.close();
  }
});
