'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {statusForError}=require('../server/http-error-status');

test('HTTP classifier preserves explicit client/server status codes',()=>{
  assert.equal(statusForError(Object.assign(new Error('json invalido'),{statusCode:400})),400);
  assert.equal(statusForError(Object.assign(new Error('indisponivel'),{statusCode:503})),503);
});

test('HTTP classifier maps known conflicts and unexpected failures correctly',()=>{
  assert.equal(statusForError(Object.assign(new Error('Modulo RESTAURANT desativado.'),{code:'MODULE_DISABLED'})),409);
  assert.equal(statusForError(new Error('UNIQUE constraint failed: products.sku')),409);
  assert.equal(statusForError(new Error('disk I/O error')),500);
});
