'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../desktop/renderer/ui-model');

const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('operational status labels use Brazilian Portuguese without changing internal enums',()=>{
  assert.equal(ui.statusLabel('NEW'),'Novo pedido');
  assert.equal(ui.statusLabel('PREPARING'),'Preparando');
  assert.equal(ui.statusLabel('READY'),'Pedido pronto');
  assert.equal(ui.statusLabel('OUT_FOR_DELIVERY'),'Saiu para entrega');
  assert.equal(ui.statusLabel('DELIVERED'),'Entregue');
  assert.equal(ui.statusLabel('PICKED_UP'),'Retirado');
  assert.equal(ui.statusLabel('ORDERED'),'Pedido realizado');
  assert.equal(ui.statusLabel('PARTIALLY_RECEIVED'),'Recebido parcialmente');
  assert.equal(ui.statusLabel('IN_TRANSIT'),'Em trânsito');
  assert.equal(ui.statusLabel('BLOCKED'),'Bloqueado');
  assert.equal(ui.fulfillmentLabel('DELIVERY'),'Entrega');
  assert.equal(ui.fulfillmentLabel('PICKUP'),'Retirada');
  assert.equal(ui.deviceTypeLabel('KITCHEN'),'KDS / produção');
  assert.equal(ui.deviceTypeLabel('WAITER'),'Garçom');
  assert.equal(ui.paymentMethodLabel('CASH'),'Dinheiro');
  assert.equal(ui.paymentMethodLabel('CREDIT_CARD'),'Cartão de crédito');
});

test('food and KDS surfaces never print NEW PREPARING READY as customer-facing copy',()=>{
  const vertical=read('desktop/renderer/vertical-modules.js');
  const mobile=read('server/mobile/app.js');

  assert.match(vertical,/statusLabel\(order\.status\)/);
  assert.doesNotMatch(vertical,/<span>\$\{escapeHtml\(order\.status\)\}<\/span>/);
  assert.match(vertical,/Novos pedidos/);
  assert.match(vertical,/Aguardando produção/);
  assert.match(vertical,/Pedidos prontos/);

  assert.match(mobile,/NEW:'Novo pedido'/);
  assert.match(mobile,/PREPARING:'Preparando'/);
  assert.match(mobile,/READY:'Pedido pronto'/);
});

test('administrative operational surfaces translate device purchase logistics and return enums',()=>{
  const access=read('desktop/renderer/access-center-ui.js');
  const parity=read('desktop/renderer/operational-detail-extensions.js');
  const backend=read('desktop/renderer/operational-route-extensions.js');
  const enterprise=read('desktop/renderer/enterprise-depth-ui.js');

  assert.match(access,/statusLabel/);
  assert.match(access,/deviceTypeLabel/);
  assert.doesNotMatch(access,/\$\{esc\(device\.status\)\}<\/span>/);

  assert.doesNotMatch(parity,/esc\(order\.status\)/);
  assert.doesNotMatch(parity,/esc\(order\.fulfillmentType\)/);
  assert.doesNotMatch(parity,/jobs FAILED/);

  assert.doesNotMatch(backend,/esc\(row\.status\)/);
  assert.doesNotMatch(enterprise,/esc\(o\.status\)/);
  assert.doesNotMatch(enterprise,/esc\(o\.fulfillmentType\)/);
});

test('Balcao search exposes delivery and pickup filters without a parallel checkout',()=>{
  const app=read('desktop/renderer/app.js');
  const router=read('server/checkout-document-router.js');

  assert.match(app,/data-checkout-document-filter="delivery"/);
  assert.match(app,/data-checkout-document-filter="retirada"/);
  assert.match(app,/type==='DELIVERY'/);
  assert.match(router,/type:'DELIVERY'/);
  assert.match(router,/checkout\/documents\/delivery\/:id\/open/);
  assert.doesNotMatch(router,/delivery\.createSale\(/);
});


test('current product authorities expose unified self-service instead of legacy tablet channel',()=>{
  const readJson=file=>JSON.parse(read(file));
  const readCurrent=file=>read(file);
  const capabilities=readJson('release/capabilities.json');
  const customer=readJson('release/customer-capabilities.json');
  const declared=new Set(customer.flatMap(entry=>entry.declaredCapabilities||[]));
  const readme=readCurrent('README.md');
  const restaurant=readCurrent('docs/architecture/e30-e39-restaurant.md');
  const deviceAccess=readCurrent('docs/architecture/access-control-p4-device-access.md');

  assert.equal(capabilities.includes('table-bound-self-service-tablet'),false);
  assert.equal(declared.has('table-bound-self-service-tablet'),false);
  assert.equal(capabilities.includes('table-bound-self-service'),true);
  assert.equal(declared.has('table-bound-self-service'),true);

  for(const source of [readme,restaurant,deviceAccess]){
    assert.doesNotMatch(source,/Tipos suportados:[^\n]*\bTABLET\b|deviceType[^\n]*\bTABLET\b|tablet de mesa|table-bound tablet/i);
  }
  assert.match(readme,/SELF_SERVICE.*TABLE.*PICKUP|autoatendimento.*mesa fixa.*retirada/is);
  assert.match(restaurant,/SELF_SERVICE.*TABLE.*PICKUP/is);
  assert.match(deviceAccess,/self-service.*establishment/is);
});
