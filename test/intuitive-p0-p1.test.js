'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('P0 QA runner promotes renderer page errors to a failed flow',()=>{
  const runner=read('qa/runtime/src/runner.js');
  assert.match(runner,/type\s*===?\s*['"]pageerror['"]/);
  assert.match(runner,/Renderer page error|page error/i);
  assert.match(runner,/status\s*=\s*['"]failed['"]/);
});

test('P0 all-pages audit opens the Devolucao route and verifies the real surface',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  assert.equal(names.has('devolucao'),true);
  assert.equal(names.has('devolucao-ui'),true);
  assert.equal(flow.steps.some(step=>step.name==='devolucao-ui'&&step.selector==='[data-returns-ui]'),true);
});

test('P1 checkout keeps operational document context visible until the sale leaves the checkout',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/checkoutDocumentContext/);
  assert.match(app,/data-checkout-document-context/);
  assert.match(app,/opened\.document/);
  assert.match(app,/expectedAt/);
  assert.match(app,/customerName/);
  assert.match(app,/clearCheckoutDocumentContext/);
});

test('P1 food workspace uses the user-facing task name Mesas e comandas',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.match(restaurant,/<h1>Mesas e comandas<\/h1>/);
  assert.doesNotMatch(restaurant,/<h1>Restaurante<\/h1>/);
});

test('P0 food workspace is an operational hub instead of a second configuration surface',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  const css=read('desktop/renderer/product-support.css');
  assert.match(modules,/<h2 id="food-operation-title">Operação<\/h2>/);
  assert.match(modules,/Abra o fluxo que precisa usar agora/);
  assert.doesNotMatch(modules,/Como o estabelecimento atende/);
  assert.doesNotMatch(modules,/Incluído na área/);
  assert.match(modules,/data-food-capability="RESTAURANT"/);
  assert.match(modules,/data-food-capability="FAST_FOOD"/);
  assert.match(modules,/data-food-capability="DELIVERY"/);
  assert.match(modules,/data-food-capability="SELF_SERVICE"/);
  assert.match(css,/\.food-workspace \.food-module-card\{[^}]*min-height:118px/);
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('P0 KDS expands to desktop lanes and keeps compact mobile mode',()=>{
  const mobile=read('server/mobile/app.js');
  const css=read('server/mobile/styles.css');
  assert.match(mobile,/classList\.toggle\('kds-mode',type==='KITCHEN'\)/);
  assert.match(mobile,/KDS local · painel responsivo por ordem de chegada/);
  assert.match(css,/@media\(min-width:901px\)[\s\S]*main\.kds-mode \.kitchen-board\{grid-template-columns:repeat\(3,minmax\(280px,1fr\)\)/);
  assert.match(css,/@media\(max-width:900px\)[\s\S]*main\.kds-mode \.kitchen-board\{grid-template-columns:1fr\}/);
});

test('P1 active optional areas expose a direct continuation action in settings',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  assert.match(modules,/data-open-module-area/);
  assert.match(modules,/Abrir área/);
});


test('P1 Home exposes Configurações only when settings.view is granted',()=>{
  const model=require('../desktop/renderer/home-role-model');
  const ui=require('../desktop/renderer/ui-model');
  const routes=permissions=>model.homeForUser({profile:{name:'Perfil'},permissions},ui.HOME_TILES).sections.flatMap(section=>section.tiles.map(tile=>tile.route));
  assert.equal(routes(['settings.view']).includes('settings'),true);
  assert.equal(routes(['sales.create']).includes('settings'),false);
});

test('P1 Cadastros stays compact in a 2x2 grid through tablet widths',()=>{
  const app=read('desktop/renderer/app.js');
  const css=read('desktop/renderer/classic-home-ui.css');
  assert.match(app,/data-flow-hub="\$\{escapeHtml\(title\)\}"/);
  assert.match(app,/renderFlowHub\('Cadastros','Clientes, produtos, estoque e equipe\.'/);
  assert.match(app,/description:'Saldos e movimentações\.'/);
  assert.match(app,/description:'Pessoas, funções e permissões\.'/);
  assert.match(css,/flow-hub-page\[data-flow-hub="Cadastros"\] \.home-tile \{ min-height:104px/);
  assert.match(css,/@media \(min-width:621px\)[\s\S]*flow-hub-page\[data-flow-hub="Cadastros"\] \.flow-hub-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
