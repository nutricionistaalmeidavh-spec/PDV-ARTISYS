'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=(rel)=>fs.readFileSync(path.join(ROOT,rel),'utf8');

test('first access UI creates administrator and signs in without a second credential prompt',()=>{
  const ui=read('desktop/renderer/first-access-ui.js');
  const index=read('desktop/renderer/index.html');
  assert.match(index,/first-access-ui\.js/);
  assert.match(ui,/Primeiro acesso ao ArtiSys/);
  assert.match(ui,/name="email"/);
  assert.match(ui,/name="passwordConfirm"/);
  assert.match(ui,/Criar administrador e entrar/);
  assert.match(ui,/await api\.setupAdmin[\s\S]{0,1200}await api\.login/);
  assert.match(ui,/window\.location\.reload\(\)/);
  assert.doesNotMatch(ui,/Administrador criado\. Entre com seus dados\./);
});

test('first access controller shows activation only when setup says it is required',()=>{
  const ui=read('desktop/renderer/first-access-ui.js');
  assert.match(ui,/setup\.activation\?\.required/);
  assert.match(ui,/requestSetupActivation\(email\)/);
  assert.match(ui,/verifySetupActivation\(email, code\)/);
  assert.match(ui,/Dados operacionais e senhas permanecem neste computador/);
});

test('renderer API exposes activation endpoints without changing local login API',()=>{
  const api=read('desktop/renderer/api-client.js');
  assert.match(api,/requestSetupActivation\(/);
  assert.match(api,/verifySetupActivation\(/);
  assert.match(api,/\/api\/v1\/setup\/activation\/request/);
  assert.match(api,/\/api\/v1\/setup\/activation\/verify/);
  assert.match(api,/async login\(body\)/);
});
