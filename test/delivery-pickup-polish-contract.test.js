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

  for(const marker of ["NEW:'Novo pedido'","PREPARING:'Preparando'","READY:'Pedido pronto'","OUT_FOR_DELIVERY:'Saiu para entrega'","PICKED_UP:'Retirado'","DELIVERED:'Entregue'"]) assert.match(model,new RegExp(marker.replace(/[.*+?^$()|[\\]\\]/g,'\\$&')));
  assert.match(model,/function roleLabel/);
  assert.match(vertical,/roleLabel\?\.\(user\.role/);
  assert.match(vertical,/statusLabel\(order\.status\)/);
  assert.doesNotMatch(vertical,/escapeHtml\(order\.status\)/);
  assert.match(restaurant,/ui\?\.statusLabel/);
  assert.match(restaurant,/ui\?\.deviceTypeLabel/);
  assert.match(restaurant,/ui\?\.roleLabel/);
  assert.doesNotMatch(restaurant,/\$\{esc\(d\.deviceType\)\}/);
  assert.doesNotMatch(restaurant,/\$\{esc\(u\.role\)\}/);
  assert.match(operational,/ui\?\.statusLabel/);
  assert.match(access,/ui\?\.statusLabel/);
  assert.match(access,/ui\?\.deviceTypeLabel/);
});

test('delivery and pickup have a real E2E flow in the verify gate including WhatsApp',()=>{
  const config=JSON.parse(read('qa/artisys-qa.config.json'));
  const pkg=JSON.parse(read('package.json'));
  const workflow=read('.github/workflows/verify.yml');
  const flowPath=config.flows['delivery-pickup-operational'];
  assert.equal(flowPath,'flows/delivery-pickup-operational-e2e.json');
  const flow=JSON.parse(read(path.join('qa',flowPath)));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of ['delivery-abrir-alimentacao','delivery-abrir-painel','retirada-criar-pedido','retirada-aguardando-producao','retirada-kds-iniciar-preparo','retirada-kds-marcar-pronto','retirada-pedido-pronto','retirada-whatsapp-disponivel','retirada-whatsapp-abrir','retirada-whatsapp-confirmado','delivery-criar-pedido','delivery-busca-balcao','delivery-abrir-no-caixa']) assert.equal(names.has(name),true,name);
  assert.match(pkg.scripts['qa:e2e:delivery-pickup']||'',/delivery-pickup-operational/);
  assert.match(workflow,/qa:e2e:delivery-pickup/);
});

test('Food architecture documents one canonical order-production-checkout model',()=>{
  const ux=read('UX-CONTRACT.md');
  const architecture=read('docs/architecture/e40-e47-verticals.md');
  for(const doc of [ux,architecture]){
    assert.match(doc,/Balc[aã]o/i);
    assert.match(doc,/Mesas e comandas/i);
    assert.match(doc,/Entrega e retirada/i);
    assert.match(doc,/KDS/i);
    assert.match(doc,/venda canônica|venda canonica/i);
  }
});

test('administrative surfaces share the same hierarchy contract',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  const access=read('desktop/renderer/access-center-ui.js');
  const vertical=read('desktop/renderer/vertical-modules.js');
  assert.match(restaurant,/data-admin-surface="restaurant"/);
  assert.match(access,/data-admin-surface="access"/);
  assert.match(vertical,/data-admin-surface="modules"/);
  for(const source of [restaurant,access,vertical]) assert.match(source,/admin-section-head/);
});
