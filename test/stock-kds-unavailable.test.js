'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');

test('a failure loading KDS must not block saving core stock product',()=>{
  const start=source.indexOf('async function requireProductionDestination(root)');
  const end=source.indexOf('async function persistProductionDestination(root',start);
  const fn=source.slice(start,end);
  assert.match(fn,/host\.dataset\.loadFailed==='true'/);
  assert.match(fn,/return null/);
  assert.doesNotMatch(fn,/if\(host\.dataset\.loadFailed==='true'[^\n]+throw new Error/);
});

test('a failed route save must retain product and warn instead of deleting catalog or recipes',()=>{
  const start=source.indexOf('function openProductForm(product = null)');
  const end=source.indexOf('async function mountRecipeEditor(root, product)',start);
  const forms=source.slice(start,end);
  assert.doesNotMatch(forms,/api\.removeProduct\(savedProduct\.id\)/);
  assert.match(forms,/Produto salvo no Estoque.*destino/);
  assert.match(forms,/Ficha Técnica.*destino/);
});
