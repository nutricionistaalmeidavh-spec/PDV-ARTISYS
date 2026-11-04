'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

test('Installer ArtiSys inclui assistente e conectores sem exigir binarios proprietarios',()=>{
  const manifest=JSON.parse(read('package.json'));
  assert.ok(manifest.build.files.includes('desktop/**/*'));
  assert.ok(manifest.build.files.includes('js/**/*'));
  assert.ok(manifest.build.extraResources.every(x=>!/paygo|sitef|tef/i.test(String(x))));
  const index=read('desktop/renderer/index.html');
  assert.match(index,/payment-setup-ui\.js/);
  assert.ok(index.indexOf('payment-setup-ui.js')<index.indexOf('settings-hub-ui.js'));
  const settings=read('desktop/renderer/settings-hub-ui.js');
  assert.match(settings,/Pagamentos · Pix e TEF/);
  assert.match(settings,/PdvPaymentSetupUi\?\.mount/);
  const html=read('desktop/renderer/payment-setup-ui.js');
  assert.match(html,/Abrir download oficial do PayGo Windows/);
  assert.match(html,/Sem TEF integrado/);
  assert.match(html,/Salvar Pix da loja/);
  assert.match(html,/data-payments-restart/);
});
test('Configuracao TEF nao usa campo comum de Settings nem revela chave em IPC',()=>{
  const main=read('desktop/main.cjs');
  const preload=read('desktop/preload.cjs');
  const service=read('desktop/payment-provider-config.cjs');
  assert.match(main,/authorizedPaymentSetup\(event,sessionToken\)/);
  assert.match(main,/authorizeDeploymentChange\(sessionToken\)/);
  assert.match(main,/paymentProviderStore\.runtimeOptions\(\{localTerminalId:/);
  assert.match(main,/tefProvider:null/);
  assert.match(preload,/artisys:payments:save/);
  assert.match(service,/safeStorage\.encryptString/);
  assert.match(service,/safeStorage\.decryptString/);
  assert.ok(!service.includes('settings.save('));
});
