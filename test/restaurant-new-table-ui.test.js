'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const source=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-ui.js'),'utf8');

test('nova mesa usa modal interno em vez de prompt incompatível com Electron',()=>{
  assert.doesNotMatch(source,/root\.prompt\s*\(/);
  assert.match(source,/function openNewTableModal\(\)/);
  assert.match(source,/id="restaurant-new-table-form"/);
  assert.match(source,/name="label"/);
  assert.match(source,/name="seats"/);
  assert.match(source,/\/api\/v1\/restaurant\/tables/);
});

test('restaurante entra somente pelo catálogo de módulos, sem launcher oculto na Home',()=>{
  const gatePath=path.join(root,'desktop/renderer/restaurant-module-gate.js');
  assert.equal(fs.existsSync(gatePath),true,'restaurant-module-gate.js deve existir');
  const gate=fs.readFileSync(gatePath,'utf8');
  const html=fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
  assert.match(gate,/api\.modules\(\)/);
  assert.match(gate,/PdvModuleGate/);
  assert.doesNotMatch(gate,/data-restaurant-route/);
  assert.doesNotMatch(source,/data-restaurant-route|ensureLauncher/);
  assert.match(gate,/ApiClient\.prototype\.saveSetting/);
  assert.doesNotMatch(gate,/PdvRestaurantModuleGate/);
  assert.ok(html.indexOf('./restaurant-module-gate.js')<html.indexOf('./restaurant-ui.js'),'gate deve carregar antes de restaurant-ui.js');
});

test('launcher stale do restaurante nao abre configuracoes quando modulo esta desligado',()=>{
  const gate=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-module-gate.js'),'utf8');
  assert.match(gate,/stopImmediatePropagation\(\)/);
  assert.match(gate,/isEnabled\(moduleId\)/);
  assert.doesNotMatch(gate,/showRoute\?\.\('settings'\)/);
});

test('fluxo de mesas exige abertura explicita, garcom e compositor antes da cozinha',()=>{
  assert.match(source,/id="restaurant-open-table-form"/);
  assert.match(source,/name="waiterId"/);
  assert.match(source,/Garçom responsável/);
  assert.match(source,/id="restaurant-add-draft-form"/);
  assert.match(source,/Adicionar ao pedido/);
  assert.match(source,/data-send-order/);
  assert.match(source,/Enviar .* item\(ns\) para a cozinha/);
});

test('acoes avancadas ficam dentro da comanda sem exigir IDs tecnicos do operador',()=>{
  assert.match(source,/id="restaurant-split-form"/);
  assert.match(source,/id="restaurant-transfer-item-form"/);
  assert.match(source,/id="restaurant-cancel-item-form"/);
  assert.match(source,/id="restaurant-merge-form"/);
  assert.match(source,/Conta e movimentações/);
  assert.doesNotMatch(source,/ID da comanda|ID do item|ID da divisão/);
});

test('operacao e configuracao do restaurante sao superficies distintas',()=>{
  assert.match(source,/data-restaurant-view-target="operation"/);
  assert.match(source,/data-restaurant-view-target="settings"/);
  assert.match(source,/Configuração do restaurante/);
  assert.match(source,/data-new-table/);
});


test('abertura e comanda expõem pessoas cliente e estado de produção no salão',()=>{
  assert.match(source,/name="partySize"/);
  assert.match(source,/name="customerId"/);
  assert.match(source,/productionStatus/);
  assert.match(source,/readyItems/);
  assert.match(source,/restaurant-session-details-form/);
});

test('desktop usa o compositor compartilhado em vez de estado de carrinho próprio',()=>{
  const html=fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
  const shared=fs.readFileSync(path.join(root,'shared/order-composer.js'),'utf8');
  assert.match(html,/shared\/order-composer\.js/);
  assert.match(source,/PdvOrderComposer/);
  assert.match(shared,/createCart/);
  assert.match(shared,/toOrderItems/);
});
