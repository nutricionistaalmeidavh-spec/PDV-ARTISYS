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
  assert.doesNotMatch(modules,/data-food-capability="FAST_FOOD"/);
  assert.equal((modules.match(/data-food-capability="DELIVERY"/g)||[]).length,1);
  assert.match(modules,/<strong>Pedidos<\/strong>/);
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
  assert.match(modules,/data-open-module-route/);
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
  assert.match(css,/flow-hub-page\[data-flow-hub="Cadastros"\] \.home-tile \{ min-height:112px/);
  assert.match(css,/@media \(min-width:621px\)[\s\S]*flow-hub-page\[data-flow-hub="Cadastros"\] \.flow-hub-grid \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});


test('P2 flow hubs use compact card density consistently',()=>{
  const css=read('desktop/renderer/classic-home-ui.css');
  assert.match(css,/\.flow-hub-grid \.home-tile \{[^}]*grid-column:auto[^}]*min-height:120px[^}]*padding:18px 20px 17px/);
  assert.doesNotMatch(css,/\.flow-hub-grid \.home-tile \{[^}]*min-height:132px/);
});

test('P2 Estoque removes persistent explanatory copy from the primary cards',()=>{
  const pages=read('desktop/renderer/operational-pages.js');
  assert.match(pages,/<h2>Cadastro mestre<\/h2><p>Produtos, insumos e fichas técnicas\.<\/p>/);
  assert.doesNotMatch(pages,/Nada é colocado no Cardápio automaticamente/);
  assert.match(pages,/<h2>Fichas técnicas<\/h2><p>Composição interna de produtos preparados\.<\/p>/);
});

test('P2 vertical card grids stay two-column on tablet and stack only on narrow screens',()=>{
  const css=read('desktop/renderer/vertical-modules.css');
  assert.match(css,/@media\(min-width:761px\) and \(max-width:1100px\)\{[^}]*\.vertical-card-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:760px\)\{[^}]*\.vertical-card-grid\{grid-template-columns:1fr\}/);
});

test('P2 dense operational surfaces use concise helper copy',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  const reports=read('desktop/renderer/reporting-v2.js');
  assert.match(restaurant,/Crie os destinos disponíveis para itens preparados\. O vínculo de cada produto é definido no Estoque\./);
  assert.doesNotMatch(restaurant,/Escolha Produção\/KDS ou Sem KDS para cada item\./);
  assert.doesNotMatch(restaurant,/Ex\.: refrigerante = sem KDS; suco preparado = produção/);
  assert.doesNotMatch(restaurant,/id="assignment-form"/);
  assert.match(reports,/Indicadores para decisão; o CSV mantém o detalhamento analítico\./);
  assert.doesNotMatch(reports,/O CSV preserva o detalhamento completo, incluindo Desconto rateado/);
});

test('P1 secondary operational text keeps WCAG-AA-friendly contrast tokens',()=>{
  const ops=read('desktop/renderer/operational-pages.css');
  const restaurant=read('desktop/renderer/restaurant-ui.css');
  assert.match(ops,/\.ops-metric small\{[^}]*color:var\(--text-subtle,#60708a\)/);
  assert.match(ops,/\.ops-table td small\{[^}]*color:var\(--text-subtle,#60708a\)/);
  assert.match(restaurant,/\.restaurant-row small\{color:var\(--text-subtle,#60708a\)\}/);
  assert.match(restaurant,/\.restaurant-kpi span\{[^}]*color:var\(--text-subtle,#60708a\)/);
});


test('P0 self-service keeps configured device identity visible and opens LAN QR without leaving the page',()=>{
  const finalUi=read('desktop/renderer/e48-e54-ui.js');
  const mobile=read('server/mobile/app.js');
  assert.match(finalUi,/\/api\/v1\/vertical\/self-service\/devices/);
  assert.match(finalUi,/data-self-device/);
  assert.match(finalUi,/Responsável local/);
  assert.match(finalUi,/PdvModal/);
  assert.doesNotMatch(finalUi,/addEventListener\('click',renderMobileAccess\)/);
  assert.doesNotMatch(finalUi,/async function renderMobileAccess/);
  assert.match(mobile,/Faça seu pedido/);
  assert.match(mobile,/device\.name/);
});


test('P0 self-service setup has one canonical creation surface',()=>{
  const access=read('desktop/renderer/access-center-ui.js');
  const finalUi=read('desktop/renderer/e48-e54-ui.js');

  assert.match(access,/<option value="WAITER">Garçom<\/option>/);
  assert.match(access,/<option value="KITCHEN">KDS \/ produção<\/option>/);
  assert.doesNotMatch(access,/<option value="TABLET">/);
  assert.doesNotMatch(access,/<option value="SELF_SERVICE">/);

  assert.match(finalUi,/\/api\/v1\/vertical\/self-service\/devices['"],\{method:'POST'/);
  assert.doesNotMatch(finalUi,/\/api\/v1\/restaurant\/devices['"],\{method:'POST',body:\{name:d\.get\('name'\),deviceType:'SELF_SERVICE'/);
  assert.doesNotMatch(finalUi,/self-service\/devices\/\$\{e\(device\.id\)\}['"],\{method:'PUT'/);
  assert.match(finalUi,/submit\.disabled=true/);
  assert.match(finalUi,/submit\.textContent='Criando…'/);
  assert.match(finalUi,/await refreshDevices\(\)/);
  assert.doesNotMatch(finalUi,/form\.reset\(\)/);
});


test('P0 self-service customer catalog follows the canonical public-menu direction',()=>{
  const mobile=read('server/mobile/app.js');
  const css=read('server/mobile/styles.css');

  assert.doesNotMatch(mobile,/function renderTablet\s*\(/);
  assert.doesNotMatch(mobile,/type==='TABLET'/);
  assert.doesNotMatch(mobile,/TABLET:'Tablet da mesa'/);
  assert.match(mobile,/let selfServiceSearch=''/);
  assert.match(mobile,/let selfServiceCategory=''/);
  assert.match(mobile,/function selfServiceProducts\s*\(/);
  assert.match(mobile,/data-self-service-search/);
  assert.match(mobile,/data-self-service-category/);
  assert.match(mobile,/self-service-product-card/);
  assert.match(mobile,/self-service-product-photo/);
  assert.match(mobile,/self-service-product-fallback/);
  assert.match(mobile,/product\.available===false/);
  assert.match(mobile,/\/api\/v1\/mobile\/self-service\/products\/\$\{encodeURIComponent\(product\.id\)\}\/photo/);
  assert.match(mobile,/function selfServiceCartRail\s*\(/);
  assert.match(mobile,/self-service-cart-rail/);
  assert.match(mobile,/class="self-service-shell"/);
  assert.match(mobile,/Chamar garçom/);
  assert.match(mobile,/Pedir conta/);
  assert.match(mobile,/\/api\/v1\/mobile\/self-service\/service/);

  const start=mobile.indexOf('function renderSelfService');
  const end=mobile.indexOf('function render(){',start);
  const selfRenderer=mobile.slice(start,end);
  assert.doesNotMatch(selfRenderer,/\bshell\(/);
  assert.match(selfRenderer,/profile\.mode==='TABLE'/);
  assert.match(selfRenderer,/profile\.mode==='PICKUP'/);

  const submitStart=mobile.indexOf('async function submitSelfServiceOrder');
  const submitEnd=mobile.indexOf('function bindSelfService',submitStart);
  const submit=mobile.slice(submitStart,submitEnd);
  assert.ok(submit.indexOf("await request('/api/v1/mobile/self-service/orders'")>=0);
  assert.ok(submit.indexOf('cart.clear()')>submit.indexOf("await request('/api/v1/mobile/self-service/orders'"));
  assert.match(submit,/catch\(error\)[\s\S]*button\.disabled=false/);

  assert.match(css,/\.self-service-shell\{/);
  assert.match(css,/\.self-service-category-strip/);
  assert.match(css,/\.self-service-product-grid\{[^}]*grid-template-columns/);
  assert.match(css,/\.self-service-product-card/);
  assert.match(css,/\.self-service-add\{[^}]*min-width:44px[^}]*min-height:44px/);
  assert.match(css,/\.self-service-cart-rail/);
  assert.match(css,/@media\(max-width:760px\)[\s\S]*\.self-service-product-grid\{grid-template-columns:1fr/);
});
