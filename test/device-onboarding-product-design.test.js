'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('first-run device onboarding separates a new installation from joining an existing one',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/Iniciar uma nova instalação/);
  assert.match(app,/Conectar a uma instalação existente/);
  assert.match(app,/Código de pareamento/);
  assert.match(app,/Nome deste computador/);
  assert.doesNotMatch(app,/Chave de pareamento/);
  assert.match(app,/dataServer\.pair/);
});

test('terminal pairing is completed by Electron and the permanent credential stays out of renderer UI',()=>{
  const preload=read('desktop/preload.cjs');
  const main=read('desktop/main.cjs');
  const runtime=read('desktop/data-server-runtime.cjs');
  assert.match(preload,/pair:\s*\(input\)/);
  assert.match(main,/artisys:data-server:pair/);
  assert.match(main,/terminalIdentity/);
  assert.match(runtime,/pairDataServerTerminal/);
  assert.doesNotMatch(preload,/terminalKey.*pair|pair.*terminalKey/);
});

test('new primary installation is activated and administered before choosing local-only or LAN host mode',()=>{
  const config=read('desktop/data-server-config.cjs');
  const app=read('desktop/renderer/app.js');
  assert.match(config,/setupIntent/);
  assert.match(app,/setupIntent/);
  assert.match(app,/Usar somente neste computador/);
  assert.match(app,/Tornar este o PC principal/);
  assert.match(app,/deployment\.manage/);
});

test('deployment role changes have a dedicated capability that is not granted to the default manager',()=>{
  const permissions=require('../js/core/auth/permission-registry');
  const profiles=require('../js/core/auth/default-profiles');
  assert.equal(permissions.isKnownPermission('deployment.manage'),true);
  assert.equal(profiles.DEFAULT_PROFILE_PERMISSIONS.ADMINISTRATOR.includes('deployment.manage'),true);
  assert.equal(profiles.DEFAULT_PROFILE_PERMISSIONS.MANAGER.includes('deployment.manage'),false);
});

test('settings never expose a permanent pairing secret and show a read-only state without deployment authority',()=>{
  const settings=read('desktop/renderer/settings-hub-ui.js');
  assert.doesNotMatch(settings,/Chave de pareamento/);
  assert.doesNotMatch(settings,/name="terminalKey"/);
  assert.match(settings,/deployment\.manage/);
  assert.match(settings,/Somente administradores autorizados podem alterar/);
});

test('PC principal panel consolidates LAN state, pairing and terminal lifecycle',()=>{
  const ui=read('desktop/renderer/ui-parity-p0-p2.js');
  assert.match(ui,/PC principal: ATIVO/);
  assert.match(ui,/Adicionar terminal/);
  assert.match(ui,/Desativar acesso pela rede/);
  assert.match(ui,/lanAddresses/);
  assert.match(ui,/Bloquear/);
  assert.match(ui,/Reativar/);
});

test('multi-device QA declares the real onboarding, blocking and reactivation Electron flow',()=>{
  const runner=read('qa/multi-device/run.mjs');
  const contract=read('test/qa-multi-device-workflow.test.js');
  assert.match(runner,/terminal-onboarding-pairing/);
  assert.match(runner,/data-pairing-code/);
  assert.match(runner,/data-connect-existing/);
  assert.match(runner,/BLOCKED/);
  assert.match(runner,/ACTIVE/);
  assert.match(contract,/terminal-onboarding-pairing/);
});
