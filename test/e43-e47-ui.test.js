'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('desktop loads optional module API and workspace extensions',()=>{
  const html=read('desktop/renderer/index.html');
  assert.match(html,/vertical-modules\.css/);
  assert.match(html,/vertical-api-client\.js/);
  assert.match(html,/vertical-modules\.js/);
  assert.match(html,/settings-hub-ui\.css/);
  assert.match(html,/settings-hub-ui\.js/);
  const settingsHub=read('desktop/renderer/settings-hub-ui.js');
  for(const label of ['Empresa','Equipe e permissões','Unidades e dispositivos','Impressão e periféricos','Fiscal','Módulos','Privacidade e telemetria','Diagnóstico e backup'])assert.match(settingsHub,new RegExp(label));
});

test('vertical UI gates segment cards from enabled module state',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  for(const id of ['PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY'])assert.match(source,new RegExp(id));
  assert.match(source,/\.filter\(module=>module\.enabled\)/);
  assert.match(source,/modules\(\)/);
  assert.match(source,/saveSetting/);
});

test('commercial desktop extension sanitizes legacy TEF wording to manual credit copy',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  assert.match(source,/sanitizeLegacyPaymentCopy/);
  assert.match(source,/Cartão crédito \/ TEF/);
  assert.match(source,/Cartão crédito/);
  assert.match(read('docs/superpowers/specs/2026-09-10-e40-e54-modular-verticals-design.md'),/NÃO FISCAL/);
});

test('desktop main authenticates local vertical API calls without exposing install token to renderer',()=>{
  const main=read('desktop/main.cjs');
  const preload=read('desktop/preload.cjs');
  assert.match(main,/rawPath\.startsWith\('\/api\/v1\/vertical\/'\)/);
  assert.doesNotMatch(preload,/installToken|x-pdv-token/);
});

test('modules are activated in settings and opened from authorized navigation',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  assert.doesNotMatch(source,/vertical-modules-launcher/);
  assert.doesNotMatch(source,/textContent='M'/);
  assert.match(source,/ops-establishment-modules-card/);
  assert.match(source,/mountSettingsModules/);
  assert.match(source,/MODULE_REQUEST_TIMEOUT_MS/);
  assert.match(source,/withTimeout/);
  assert.match(source,/Tentar novamente/);
  assert.match(source,/button\.dataset\.moduleNav=item\.target/);
  assert.match(source,/Acesso liberado no menu lateral/);
  assert.match(source,/#sidebar-nav \[data-route="home"\]/);
  assert.doesNotMatch(source,/Abrir módulo/);
});

test('food extensions share a distinct navigation group and one settings destination card',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  const registry=read('js/core/modules/module-registry.js');
  assert.match(registry,/FOOD:Object\.freeze\(\{id:'FOOD',label:'Alimentação'/);
  assert.match(registry,/navigation:'group'/);
  assert.match(source,/area\.navigation==='group'/);
  assert.match(source,/dataset\.moduleNav=item\.target/);
  assert.match(source,/areaModules\.map\(renderToggle\)/);
  assert.doesNotMatch(source,/const FOOD_MODULES|const MODULE_LABELS|const MODULE_ICONS/);
});

test('settings expose server choices with explicit effects and accessible module switches',()=>{
  const settings=read('desktop/renderer/settings-hub-ui.js');
  const modules=read('desktop/renderer/vertical-modules.js');
  const settingsCss=read('desktop/renderer/settings-hub-ui.css');
  assert.match(settings,/settings-mode-summary/);
  assert.match(settings,/Apenas meu caixa · dados neste computador/);
  assert.match(settings,/A troca para servidor externo não migra dados locais automaticamente/);
  assert.match(settings,/data-server-option/);
  assert.match(modules,/role="switch" aria-label="Ativar/);
  assert.match(modules,/aria-checked/);
  assert.match(settingsCss,/\.ops-page\[data-settings-page="true"\]/);
  assert.doesNotMatch(settingsCss,/#classic-home-grid|\.home-tile/);
});
