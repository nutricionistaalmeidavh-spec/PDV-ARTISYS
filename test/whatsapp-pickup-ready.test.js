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

test('desktop preload and renderer wire the pickup-ready WhatsApp action without renderer shell access',()=>{
  const preload=read('desktop/preload.cjs');
  const receipts=read('desktop/receipt-actions.cjs');
  const index=read('desktop/renderer/index.html');
  const ui=read('desktop/renderer/whatsapp-pickup-ui.js');

  assert.match(preload,/external:\s*\{/);
  assert.match(preload,/openWhatsapp:\s*\(input\)\s*=>\s*ipcRenderer\.invoke\('artisys:external:whatsapp'/);
  assert.match(receipts,/registerWhatsappIpc/);
  assert.match(index,/\.\/whatsapp-pickup-ui\.js/);
  assert.match(ui,/data-whatsapp-pickup-ready/);
  assert.match(ui,/artisysDesktop\?\.external\?\.openWhatsapp/);
  assert.match(ui,/fulfillmentType\s*===\s*'PICKUP'/);
  assert.match(ui,/status\s*===\s*'READY'/);
  assert.doesNotMatch(ui,/shell\.openExternal/);
  assert.doesNotMatch(ui,/window\.open\s*\(/);
});

test('phone inputs are numeric national format and the release E2E proves normalization plus READY button visibility',()=>{
  const ui=read('desktop/renderer/whatsapp-pickup-ui.js');
  const flow=JSON.parse(read('qa/flows/whatsapp-pickup-ready-e2e.json'));
  const config=JSON.parse(read('qa/artisys-qa.config.json'));

  assert.match(ui,/input\[name=["']phone["']\]/);
  assert.match(ui,/inputMode\s*=\s*'numeric'/);
  assert.match(ui,/maxLength\s*=\s*11/);
  assert.match(ui,/replace\(\/\\D\/g,''\)/);

  const serialized=JSON.stringify(flow);
  assert.match(serialized,/\+55 \(16\) 99999-9999/);
  assert.match(serialized,/16999999999/);
  assert.match(serialized,/data-delivery-next/);
  assert.match(serialized,/data-whatsapp-pickup-ready/);

  assert.equal(config.flows['whatsapp-pickup-ready-e2e'],'flows/whatsapp-pickup-ready-e2e.json');
  assert.ok(config.qaProfiles.release.flows.includes('whatsapp-pickup-ready-e2e'));
  assert.ok(config.qaProfiles.release.criticalFlows.includes('whatsapp-pickup-ready-e2e'));
});
