'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const json=file=>JSON.parse(read(file));

const REQUIRED_USER_FLOWS=[
  '00-smoke','01-onboarding-login','02-cadastros','03-caixa','04-venda-principal',
  '05-venda-avancada','06-impressao','07-estoque','08-pos-venda-devolucao','09-relatorios',
  '10-financeiro','11-configuracoes','12-modulos-configuracao','13-restaurante','14-pizzaria',
  '15-delivery','16-fast-food','17-mercado-padaria','18-varejo','19-servicos-oficina',
  '20-autoatendimento','21-permissoes','22-backup-recuperacao','23-rede-multiterminal',
  '24-persistencia-restart','25-installed-exe-smoke'
];

test('user-all QA suite contains every planned user journey',()=>{
  for(const flow of REQUIRED_USER_FLOWS){
    const file=path.join('qa','flows','user',`${flow}.json`);
    assert.ok(fs.existsSync(path.join(root,file)),`missing flow ${flow}`);
    const parsed=json(file);
    assert.ok(Array.isArray(parsed.steps)&&parsed.steps.length>0,`${flow} must contain steps`);
  }
});

test('QA data isolation is enforced for source and installed Electron runs',()=>{
  const config=json('qa/artisys-qa.config.json');
  const wrapper=read('qa/desktop/main.cjs');
  const main=read('desktop/main.cjs');
  assert.equal(config.electron.entry,'desktop/main.cjs');
  assert.match(wrapper,/ARTISYS_QA_USER_DATA_DIR/);
  assert.match(wrapper,/app\.setPath\(['"]userData['"]/);
  assert.match(main,/ARTISYS_QA_USER_DATA_DIR/);
  assert.match(main,/app\.setPath\(['"]userData['"]/);
});

test('full QA runner installs dependencies, builds installer before verification and user-flow QA',()=>{
  const source=read('scripts/qa-user-all.mjs');
  const dependencySetup=source.indexOf('const dependencyArgs = hasLockfile');
  const install=source.indexOf("run('Instalar dependências'");
  const build=source.indexOf("npmArgs('run', 'dist:win')");
  const verify=source.indexOf("npmArgs('run', 'verify')");
  const flowLoop=source.indexOf('for (const file of flowFiles)');
  assert.ok(dependencySetup>=0&&install>dependencySetup&&build>install&&verify>build&&flowLoop>verify,'expected dependency setup -> install -> dist:win -> verify -> user flows ordering');
  assert.match(source,/package-lock\.json/);
  assert.match(source,/npm-shrinkwrap\.json/);
  assert.match(source,/\['ci'\]/);
  assert.match(source,/\['install', '--no-audit', '--no-fund'\]/);
  assert.match(source,/sha256/i);
  assert.match(source,/qa-delivery-artifacts/);
  assert.match(source,/PASS|FAIL|SKIPPED/);
  assert.match(source,/qa-installed-smoke\.ps1/);
  assert.match(source,/e22-backup\.test\.js/);
  assert.match(source,/e21-lan-api\.test\.js/);
});

test('Windows QA runner invokes npm through ComSpec instead of spawning npm.cmd directly',()=>{
  const source=read('scripts/qa-user-all.mjs');
  assert.match(source,/process\.env\.ComSpec/);
  assert.match(source,/cmd\.exe/);
  assert.match(source,/function npmArgs/);
  assert.doesNotMatch(source,/const npm\s*=\s*process\.platform\s*===\s*['"]win32['"]\s*\?\s*['"]npm\.cmd['"]/);
});

test('common flows use synthetic QA-only credentials and no customer secrets',()=>{
  for(const file of ['qa/flows/common/first-run-login.json','qa/flows/common/basic-catalog.json','qa/flows/common/open-cash.json']){
    const source=read(file);
    assert.match(source,/QA|qa/i);
    assert.doesNotMatch(source,/ARTISYS_QA_ADMIN_PASSWORD/);
  }
});

test('final vertical module back action is redirected to settings after removal of M launcher',()=>{
  const html=read('desktop/renderer/index.html');
  const fix=read('desktop/renderer/e48-settings-back-fix.js');
  assert.match(html,/e48-e54-ui\.js[\s\S]*e48-settings-back-fix\.js/);
  assert.match(fix,/e48-back/);
  assert.match(fix,/stopImmediatePropagation/);
  assert.match(fix,/PdvOperationalUi\?\.showRoute\?\.\('settings'\)/);
});
