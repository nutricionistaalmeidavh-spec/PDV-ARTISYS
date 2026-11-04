'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPaymentProviderStore}=require('../desktop/payment-provider-config.cjs');

function fixture(t,{encrypted=true}={}){
  const userData=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-payment-wizard-'));
  t.after(()=>fs.rmSync(userData,{recursive:true,force:true}));
  const safeStorage={
    isEncryptionAvailable:()=>encrypted,
    encryptString:value=>Buffer.from('encrypted-with-keychain:'+Buffer.from(value).toString('base64')),
    decryptString:blob=>Buffer.from(String(blob).replace(/^encrypted-with-keychain:/,'') ,'base64').toString()
  };
  const store=createPaymentProviderStore({app:{getPath:name=>name==='userData'?userData:''},safeStorage});
  return{store,userData};
}
test('Instalacao nova nao exige TEF, chave nem servico externo',t=>{
  const {store}=fixture(t);
  assert.deepEqual(store.status().mode,'manual');
  assert.equal(store.status().configured,false);
  assert.deepEqual(store.runtimeOptions(),{});
});
test('Assistente persiste PayGo criptografado sem expor segredo ao renderer',t=>{
  const {store,userData}=fixture(t);
  const integrationKey='nao-expor-secret-123456789';
  const status=store.save({mode:'paygo',baseUrl:'https://sandbox.controlpay.com.br/webapi/',
    integrationKey,terminalMap:{'PDV-01':'1234','PDV-02':'5678'}});
  assert.equal(status.mode,'paygo');
  assert.equal(status.configured,true);
  assert.equal(status.terminalMap['PDV-02'],'5678');
  assert.ok(!JSON.stringify(status).includes(integrationKey));
  assert.ok(!fs.readFileSync(path.join(userData,'payment-provider.bin')).includes(integrationKey));
  assert.equal(store.runtimeOptions().tefProvider.start instanceof Function,true);
  const statusAgain=store.save({mode:'paygo',baseUrl:'https://sandbox.controlpay.com.br/webapi/',
    integrationKey:'',terminalMap:{'PDV-01':'1234','PDV-02':'5678'}});
  assert.equal(statusAgain.configured,true,'edicao nao deve apagar chave existente');
  assert.ok(!JSON.stringify(store.status()).includes(integrationKey));
});
test('Assistente recusa HTTPS invalido, PinPad ausente e credencial nova vazia',t=>{
  const {store}=fixture(t);
  assert.throws(()=>store.save({mode:'paygo',baseUrl:'http://example.com/webapi/',integrationKey:'a',terminalId:'1234'}),/HTTPS/);
  assert.throws(()=>store.save({mode:'paygo',baseUrl:'https://sandbox.controlpay.com.br/webapi/',integrationKey:'a'}),/Terminal/i);
  assert.throws(()=>store.save({mode:'paygo',baseUrl:'https://sandbox.controlpay.com.br/webapi/',terminalId:'1234'}),/chave/i);
  assert.throws(()=>store.save({mode:'paygo',baseUrl:'https://sandbox.controlpay.com.br/webapi/',integrationKey:'a',
    terminalMap:{'PDV-01':'1234','PDV-02':'1234'}}),/duplicad/i);
});
test('Sem criptografia do SO PayGo permanece opcional e nao salva segredo em texto claro',t=>{
  const {store,userData}=fixture(t,{encrypted:false});
  assert.equal(store.status().mode,'manual');
  assert.throws(()=>store.save({mode:'paygo',baseUrl:'https://sandbox.controlpay.com.br/webapi/',integrationKey:'test',terminalId:'1234'}),/seguro|criptografi/i);
  assert.equal(fs.existsSync(path.join(userData,'payment-provider.bin')),false);
});
test('Modo bridge exige exe real selecionado e nao o executa na configuracao',t=>{
  const {store,userData}=fixture(t);
  const executable=path.join(userData,'bridge-test.exe');
  fs.writeFileSync(executable,'fake binary');
  assert.throws(()=>store.save({mode:'bridge',executable:path.join(userData,'ausente.exe')}),/executavel|arquivo/i);
  const status=store.save({mode:'bridge',executable});
  assert.equal(status.mode,'bridge');
  assert.equal(status.executable,executable);
  assert.equal(typeof store.runtimeOptions().tefProvider.start,'function');
});
test('Desativar TEF volta a somente pagamentos manuais e apaga credenciais protegidas',t=>{
  const {store,userData}=fixture(t);
  store.save({mode:'paygo',baseUrl:'https://sandbox.controlpay.com.br/webapi/',integrationKey:'test',terminalId:'1234'});
  const s=store.save({mode:'manual'});
  assert.equal(s.mode,'manual');
  assert.deepEqual(store.runtimeOptions(),{});
  assert.equal(fs.existsSync(path.join(userData,'payment-provider.bin')),false);
});
test('Arquivo criptografado corrompido nao expõe dados nem habilita TEF',t=>{
  const {store,userData}=fixture(t);
  fs.writeFileSync(path.join(userData,'payment-provider.bin'),'garbage');
  assert.throws(()=>store.runtimeOptions(),/credencial|configura/i);
  const status=store.status();
  assert.equal(status.configured,false);
  assert.equal(status.mode,'manual');
  assert.ok(status.error);
  store.save({mode:'manual'});
  assert.deepEqual(store.runtimeOptions(),{});
});
