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

test('user-all QA profile covers every planned user journey and runs Electron isolated',()=>{
  const config=json('qa/artisys-qa.config.json');
  assert.equal(config.electron.entry,'qa/desktop/main.cjs');
  assert.ok(config.qaProfiles?.['user-all']);
  assert.deepEqual(config.qaProfiles['user-all'].flows,REQUIRED_USER_FLOWS);
  for(const flow of REQUIRED_USER_FLOWS){
    assert.equal(typeof config.flows[flow],'string',`missing flow mapping ${flow}`);
    const parsed=json(path.join('qa',config.flows[flow]));
    assert.ok(Array.isArray(parsed.steps)&&parsed.steps.length>0,`${flow} must contain steps`);
  }
});

test('QA data isolation is enforced for source and installed Electron runs',()=>{
  const wrapper=read('qa/desktop/main.cjs');
  const main=read('desktop/main.cjs');
  assert.match(wrapper,/ARTISYS_QA_USER_DATA_DIR/);
  assert.match(wrapper,/app\.setPath\(['"]userData['"]/);
  assert.match(main,/ARTISYS_QA_USER_DATA_DIR/);
  assert.match(main,/app\.setPath\(['"]userData['"]/);
});

test('full QA command builds before UI QA and produces delivery evidence',()=>{
  const pkg=json('package.json');
  assert.equal(pkg.scripts['qa:user:all'],'node scripts/qa-user-all.mjs');
  const source=read('scripts/qa-user-all.mjs');
  const install=source.indexOf("['ci']");
  const verify=source.indexOf("['run','verify']");
  const build=source.indexOf("['run','dist:win']");
  const userQa=source.indexOf("'user-all'");
  assert.ok(install>=0&&verify>install&&build>verify&&userQa>build,'expected npm ci -> verify -> dist:win -> user-all ordering');
  assert.match(source,/sha256/i);
  assert.match(source,/qa-delivery-artifacts/);
  assert.match(source,/PASS|FAIL|SKIPPED/);
  assert.match(source,/qa-installed-smoke\.ps1/);
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
