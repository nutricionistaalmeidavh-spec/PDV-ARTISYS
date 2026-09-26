'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=(rel)=>fs.readFileSync(path.join(ROOT,rel),'utf8');

test('first access UI creates administrator and signs in without a second credential prompt',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/Primeiro acesso ao ArtiSys/);
  assert.match(app,/name="email"/);
  assert.match(app,/name="passwordConfirm"/);
  assert.match(app,/Criar administrador e entrar/);
  assert.match(app,/await api\.setupAdmin[\s\S]{0,1200}await api\.login/);
  assert.doesNotMatch(app,/Administrador criado\. Entre com seus dados\./);
});

test('renderer API exposes activation endpoints without changing local login API',()=>{
  const api=read('desktop/renderer/api-client.js');
  assert.match(api,/requestSetupActivation\(/);
  assert.match(api,/verifySetupActivation\(/);
  assert.match(api,/\/api\/v1\/setup\/activation\/request/);
  assert.match(api,/\/api\/v1\/setup\/activation\/verify/);
  assert.match(api,/async login\(body\)/);
});
