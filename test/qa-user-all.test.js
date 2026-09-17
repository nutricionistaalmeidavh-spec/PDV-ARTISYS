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
  const runtimeInstall=source.indexOf("run('Instalar runtime de QA'");
  const build=source.indexOf("npmArgs('run', 'dist:win')");
  const verify=source.indexOf("npmArgs('run', 'verify')");
  const flowLoop=source.indexOf('for (const file of flowFiles)');
  assert.ok(dependencySetup>=0&&install>dependencySetup&&runtimeInstall>install&&build>runtimeInstall&&verify>build&&flowLoop>verify,'expected root install -> QA runtime install -> dist:win -> verify -> user flows ordering');
  assert.match(source,/package-lock\.json/);
  assert.match(source,/npm-shrinkwrap\.json/);
  assert.match(source,/\['ci'\]/);
  assert.match(source,/\['install', '--no-audit', '--no-fund'\]/);
  assert.match(source,/qa\/runtime/);
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

test('common setup data is QA-only and contains no customer secret environment variable',()=>{
  for(const file of ['qa/flows/common/first-run-login.json','qa/flows/common/basic-catalog.json']){
    const source=read(file);
    assert.match(source,/QA|qa/i);
    assert.doesNotMatch(source,/ARTISYS_QA_ADMIN_PASSWORD/);
  }
  assert.doesNotMatch(read('qa/flows/common/open-cash.json'),/ARTISYS_QA_ADMIN_PASSWORD/);
});

test('vendored QA runtime declares Playwright and runner installs its dependencies',()=>{
  const runtimePkg=json('qa/runtime/package.json');
  const runner=read('scripts/qa-user-all.mjs');
  assert.ok(runtimePkg.devDependencies?.playwright || runtimePkg.peerDependencies?.playwright);
  assert.match(runner,/qa[\\/]runtime/);
  assert.match(runner,/Instalar runtime de QA/);
});

test('dialog-driven QA clicks have a finite timeout instead of hanging forever',()=>{
  const steps=read('qa/runtime/src/steps.js');
  assert.match(steps,/dialogTimeoutMs/);
  assert.match(steps,/setTimeout/);
  assert.match(steps,/Timed out waiting for/);
});

test('shared user flows target unique UI elements after commercial extensions were added',()=>{
  const catalog=json('qa/flows/common/basic-catalog.json');
  const cash=json('qa/flows/common/open-cash.json');
  const sale=json('qa/flows/common/basic-sale.json');
  const returns=json('qa/flows/user/08-pos-venda-devolucao.json');
  const byName=(flow,name)=>flow.steps.find(step=>step.name===name);
  assert.equal(byName(catalog,'seller-created').selector,'.data-row:has([data-edit-seller])');
  assert.equal(byName(catalog,'product-created').selector,'.data-row:has([data-edit-product])');
  assert.equal(byName(catalog,'customer-created').selector,'.data-row:has([data-edit-customer])');
  assert.equal(byName(catalog,'return-home').selector,'.sidebar-back[data-route="home"]');
  assert.equal(byName(cash,'cash-return-home').selector,'.sidebar-back[data-route="home"]');
  assert.equal(byName(cash,'cash-back-home').selector,'.sidebar-back[data-route="home"]');
  assert.equal(byName(sale,'sale-home').selector,'.sidebar-back[data-route="home"]');
  assert.equal(byName(returns,'home').selector,'.sidebar-back[data-route="home"]');
  assert.equal(byName(returns,'home-returns').selector,'.sidebar-back[data-route="home"]');
});

test('cadastros flow scopes assertions to product and customer rows',()=>{
  const flow=json('qa/flows/user/02-cadastros.json');
  const byName=name=>flow.steps.find(step=>step.name===name);
  assert.equal(byName('barcode-found').selector,'.data-row:has([data-edit-product])');
  assert.equal(byName('customer-edit-persisted').selector,'.data-row:has([data-edit-customer])');
});

test('checkout refreshes seller options after seller creation instead of keeping stale state',()=>{
  const html=read('desktop/renderer/index.html');
  const sync=read('desktop/renderer/seller-checkout-sync.js');
  assert.match(html,/app\.js[\s\S]*seller-checkout-sync\.js/);
  assert.match(sync,/api\.sellers\(\)/);
  assert.match(sync,/seller-form/);
  assert.match(sync,/#seller-select/);
  assert.match(sync,/dispatchEvent\(new Event\(['"]change['"]/);
});

test('restaurant and market QA use valid unambiguous fixtures',()=>{
  const restaurant=json('qa/flows/user/13-restaurante.json');
  const market=json('qa/flows/user/17-mercado-padaria.json');
  const byName=(flow,name)=>flow.steps.find(step=>step.name===name);
  assert.equal(byName(restaurant,'restaurant-launcher').selector,'.restaurant-home-tile[data-restaurant-route]');
  assert.equal(byName(restaurant,'open-restaurant').selector,'.restaurant-home-tile[data-restaurant-route]');
  assert.equal(byName(market,'weighted-unit').value,'KG');
  assert.ok(market.steps.findIndex(step=>step.name==='weighted-unit')<market.steps.findIndex(step=>step.name==='calculate-weight'));
});

test('product variant UI enhancement is idempotent and retail flow preflights the API',()=>{
  const source=read('desktop/renderer/product-variants-ui.js');
  const retail=json('qa/flows/user/18-varejo.json');
  const preflight=retail.steps.find(step=>step.name==='variant-api-ready');
  assert.match(source,/productVariantsEnhanced/);
  assert.match(source,/dataset\.productVariantsEnhanced=['"]true['"]/);
  assert.equal(preflight?.action,'apiRequest');
  assert.equal(preflight?.path,'/api/v1/product-variants?includeInactive=true');
  assert.equal(preflight?.expectStatus,200);
});

test('prompt-driven QA clicks use a deterministic renderer shim under Electron',()=>{
  const steps=read('qa/runtime/src/steps.js');
  assert.match(steps,/__ARTISYS_QA_PROMPT_SHIM__/);
  assert.match(steps,/window\.prompt/);
  assert.match(steps,/promptText/);
});

test('cashier permissions verify restricted settings UI without depending on an admin-only form',()=>{
  const flow=json('qa/flows/user/21-permissoes.json');
  const restricted=flow.steps.find(step=>step.name==='settings-form-restricted');
  assert.equal(restricted?.action,'expectNotVisible');
  assert.equal(restricted?.selector,'#ops-store-receipt-form');
  assert.ok(!flow.steps.some(step=>step.name==='forbidden-save'||step.name==='forbidden-name'));
});

test('user-all runner can resume from a named flow and prints live step progress',()=>{
  const source=read('scripts/qa-user-all.mjs');
  assert.match(source,/ARTISYS_QA_FROM/);
  assert.match(source,/onProgress/);
  assert.match(source,/step-start/);
  assert.match(source,/\[\$\{event\.current\}\/\$\{event\.total\}\]/);
});

test('final vertical module back action is redirected to settings after removal of M launcher',()=>{
  const html=read('desktop/renderer/index.html');
  const fix=read('desktop/renderer/e48-settings-back-fix.js');
  assert.match(html,/e48-e54-ui\.js[\s\S]*e48-settings-back-fix\.js/);
  assert.match(fix,/e48-back/);
  assert.match(fix,/stopImmediatePropagation/);
  assert.match(fix,/PdvOperationalUi\?\.showRoute\?\.\('settings'\)/);
});

test('final-module manager patch is idempotent before mutating child content',()=>{
  const source=read('desktop/renderer/e48-e54-ui.js');
  const start=source.indexOf("root.querySelectorAll('[data-module-open]')");
  const end=source.indexOf('const enabled=',start);
  const patch=source.slice(start,end);
  const guard=patch.indexOf('if(button.dataset.e48Bound)return');
  const disabledWrite=patch.indexOf('button.disabled=false');
  const textWrite=patch.indexOf("span.textContent='Abrir módulo'");
  assert.ok(start>=0&&end>start,'final-module patch must exist');
  assert.ok(guard>=0,'final-module patch must have an idempotency guard');
  assert.ok(guard<disabledWrite,'idempotency guard must run before changing disabled state');
  assert.ok(guard<textWrite,'idempotency guard must run before replacing span text and retriggering MutationObserver');
});
