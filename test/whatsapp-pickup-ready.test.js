'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const ROOT=path.join(__dirname,'..');
const read=relative=>fs.readFileSync(path.join(ROOT,relative),'utf8');

test('WhatsApp ready action normalizes Brazilian national phones and builds a wa.me URL',async()=>{
  const {
    normalizeBrazilianNationalPhone,
    buildPickupReadyWhatsappUrl,
    registerWhatsappIpc
  }=require('../desktop/whatsapp-actions.cjs');

  assert.equal(normalizeBrazilianNationalPhone('(16) 99999-9999'),'16999999999');
  assert.equal(normalizeBrazilianNationalPhone('+55 (16) 99999-9999'),'16999999999');
  assert.equal(normalizeBrazilianNationalPhone('1633334444'),'1633334444');
  assert.throws(()=>normalizeBrazilianNationalPhone('1699999'),/10 ou 11/);
  assert.throws(()=>normalizeBrazilianNationalPhone('9916999999999'),/10 ou 11/);

  const url=buildPickupReadyWhatsappUrl({phone:'16999999999',customerName:'Evandro'});
  assert.match(url,/^https:\/\/wa\.me\/5516999999999\?text=/);
  assert.match(decodeURIComponent(url),/Olá, Evandro! Seu pedido está pronto para retirada\./);

  const handlers={};
  const opened=[];
  const ipcMain={handle(channel,handler){handlers[channel]=handler;}};
  registerWhatsappIpc({
    ipcMain,
    isTrustedSender:()=>true,
    openExternal:async target=>{opened.push(target);}
  });
  assert.equal(typeof handlers['artisys:external:whatsapp'],'function');
  const result=await handlers['artisys:external:whatsapp']({}, {phone:'16999999999',customerName:'Evandro'});
  assert.equal(result.opened,true);
  assert.equal(opened.length,1);
  assert.equal(opened[0],result.url);
  assert.match(opened[0],/^https:\/\/wa\.me\//);
});

test('pickup-ready WhatsApp action is rendered by the canonical delivery renderer',()=>{
  const preload=read('desktop/preload.cjs');
  const receipts=read('desktop/receipt-actions.cjs');
  const index=read('desktop/renderer/index.html');
  const modules=read('desktop/renderer/vertical-modules.js');
  const parity=read('desktop/renderer/vertical-parity-p1.js');

  assert.match(preload,/external:\s*\{/);
  assert.match(preload,/openWhatsapp:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\('artisys:external:whatsapp'/);
  assert.match(receipts,/registerWhatsappIpc/);
  assert.doesNotMatch(index,/\.\/whatsapp-pickup-ui\.js/);
  assert.match(parity,/data-whatsapp-pickup-ready/);
  assert.match(parity,/artisysDesktop\?\.external\?\.openWhatsapp/);
  assert.match(parity,/fulfillmentType\s*===\s*'PICKUP'/);
  assert.match(parity,/status\s*===\s*'READY'/);
  assert.doesNotMatch(parity,/shell\.openExternal/);
  assert.doesNotMatch(parity,/window\.open\s*\(/);
  assert.doesNotMatch(modules,/scheduleDeliveryEnhancement/);
});

test('delivery phone is numeric national format without silent truncation',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');

  assert.match(modules,/input\('phone','Telefone','tel'/);
  assert.match(modules,/inputmode="numeric"/);
  assert.match(modules,/maxlength="11"/);
  assert.match(modules,/replace\(\/\\D\/g,''\)/);
  assert.match(modules,/startsWith\('55'\)/);
  assert.doesNotMatch(modules,/slice\(0,11\)/);
});

test('release E2E proves normalization, READY visibility and the desktop bridge click',()=>{
  const flow=JSON.parse(read('qa/flows/whatsapp-pickup-ready-e2e.json'));
  const config=JSON.parse(read('qa/artisys-qa.config.json'));
  const serialized=JSON.stringify(flow);

  assert.match(serialized,/\+55 \(16\) 99999-9999/);
  assert.match(serialized,/16999999999/);
  assert.match(serialized,/data-delivery-next/);
  assert.match(serialized,/data-whatsapp-pickup-ready/);

  const phoneAssertion=flow.steps.find(step=>step.name==='wa-phone-normalized');
  const labelAssertion=flow.steps.find(step=>step.name==='wa-ready-button-label');
  const openedAssertion=flow.steps.find(step=>step.name==='wa-open-whatsapp-result');
  assert.equal(phoneAssertion?.action,'expectValue');
  assert.equal(phoneAssertion?.expected,'16999999999');
  assert.equal(labelAssertion?.action,'expectText');
  assert.equal(labelAssertion?.expected,'Avisar no WhatsApp');
  assert.ok(flow.steps.some(step=>step.action==='click'&&String(step.selector||'').includes('data-whatsapp-pickup-ready')));
  assert.equal(openedAssertion?.action,'expectText');
  assert.equal(openedAssertion?.expected,'WhatsApp aberto');
  for(const step of flow.steps.filter(step=>step.action==='expectText'||step.action==='expectValue'))assert.notEqual(step.expected,undefined);

  assert.equal(config.flows['whatsapp-pickup-ready-e2e'],'flows/whatsapp-pickup-ready-e2e.json');
  assert.ok(config.qaProfiles.release.flows.includes('whatsapp-pickup-ready-e2e'));
  assert.ok(config.qaProfiles.release.criticalFlows.includes('whatsapp-pickup-ready-e2e'));
});
