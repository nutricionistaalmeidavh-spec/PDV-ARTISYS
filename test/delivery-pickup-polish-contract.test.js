'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('user-facing operational states are translated through the canonical UI model',()=>{
  const model=read('desktop/renderer/ui-model.js');
  const vertical=read('desktop/renderer/vertical-modules.js');
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  const operational=read('desktop/renderer/operational-pages.js');
  const access=read('desktop/renderer/access-center-ui.js');

  for(const marker of ["NEW:'Novo pedido'","PREPARING:'Preparando'","READY:'Pedido pronto'","OUT_FOR_DELIVERY:'Saiu para entrega'","PICKED_UP:'Retirado'","DELIVERED:'Entregue'"]) assert.match(model,new RegExp(marker.replace(/[.*+?^$()|[\]\\]/g,'\\$&')));
  assert.match(model,/function roleLabel/);
  assert.match(vertical,/statusLabel\(order\.status\)/);
  assert.doesNotMatch(vertical,/<span>\$\{escapeHtml\(order\.status\)\}<\/span>/);
  assert.match(restaurant,/ui\?\.statusLabel/);
  assert.match(restaurant,/ui\?\.deviceTypeLabel/);
  assert.match(restaurant,/ui\?\.roleLabel/);
  assert.match(operational,/ui\?\.statusLabel/);
  assert.match(access,/ui\?\.statusLabel/);
  assert.match(access,/ui\?\.deviceTypeLabel/);
});

test('delivery and pickup keep checkout search and WhatsApp regression coverage',()=>{
  const app=read('desktop/renderer/app.js');
  const router=read('server/checkout-document-router.js');
  const checkoutTests=read('test/checkout-document-search.test.js');
  const whatsappTests=read('test/whatsapp-pickup-ready.test.js');
  const vertical=read('desktop/renderer/vertical-modules.js');

  assert.match(app,/data-checkout-document-filter="delivery"/);
  assert.match(app,/data-checkout-document-filter="retirada"/);
  assert.match(router,/checkout\/documents\/delivery\/:id\/open/);
  assert.match(checkoutTests,/canonical linked sale/);
  assert.match(checkoutTests,/existing canonical sale/);
  assert.match(whatsappTests,/buildPickupReadyWhatsappUrl/);
  assert.match(vertical,/Avisar no WhatsApp/);
});

test('Food architecture documents one canonical order-production-checkout model',()=>{
  const ux=read('UX-CONTRACT.md');
  const architecture=read('docs/architecture/e40-e47-verticals.md');
  assert.match(ux,/Balc[aã]o/i);
  assert.match(ux,/Mesas e comandas/i);
  assert.match(ux,/Entrega e retirada/i);
  assert.match(architecture,/KDS/i);
  assert.match(architecture,/SaleService canônico|venda canônica|venda canonica/i);
  assert.match(architecture,/Delivery|Entrega e retirada/i);
});
