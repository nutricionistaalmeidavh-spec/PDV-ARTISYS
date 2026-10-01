'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../desktop/renderer/ui-model');
const {homeForRole}=require('../desktop/renderer/home-role-model');
const management={key:'management',label:'Gestão',description:'Resultado, DRE e fluxo de caixa',route:'management',tone:'rose',icon:'management'};

test('Home administrativa contém uma única entrada por destino conceitual',()=>{const view=homeForRole('admin',[...ui.HOME_TILES,management]);const keys=view.sections.flatMap(section=>section.tiles.map(tile=>tile.key));assert.equal(new Set(keys).size,keys.length);});
test('cards visíveis da Home administrativa não repetem cor',()=>{const view=homeForRole('admin',[...ui.HOME_TILES,management]);const tones=view.sections.flatMap(section=>section.tiles.map(tile=>tile.tone));assert.equal(new Set(tones).size,tones.length);});
test('Home nativa fica realmente oculta quando a Home por papel está ativa',()=>{const css=fs.readFileSync(path.join(__dirname,'../desktop/renderer/classic-home-ui.css'),'utf8');assert.match(css,/home-view-classic \.home-grid\[hidden\]\s*\{\s*display:none !important;/);});
test('Financeiro e Gestão usam ícones diferentes no menu',()=>{const app=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');assert.match(app,/finance:\s*\{[^\n]+icon: 'chart'/);assert.match(app,/management:\s*\{[^\n]+icon: 'management'/);});
test('modo local único não monta o detalhamento multi-local que travava Estoque',()=>{const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/backend-parity-ui.js'),'utf8');assert.match(source,/dataServer\?\.mode==='local'\)return/);});
test('módulos ativos são recarregados após cada reconstrução do menu lateral',()=>{const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/vertical-modules.js'),'utf8');assert.match(source,/artisys:sidebar-rendered'.+refreshModuleNavigation/s);});
test('páginas agrupadoras não se identificam como Home nem recebem módulos extras',()=>{const app=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');const restaurant=fs.readFileSync(path.join(__dirname,'../desktop/renderer/restaurant-ui.js'),'utf8');assert.doesNotMatch(app,/home-grid flow-hub-grid/);assert.match(restaurant,/document\.body\.classList\.remove\('theme-home'\)/);});
test('Configurações permanece fixa e acessível fora da rolagem do menu',()=>{const css=fs.readFileSync(path.join(__dirname,'../desktop/renderer/styles.css'),'utf8');assert.match(css,/\.sidebar-nav\s*\{[^}]*overflow-y:auto/s);assert.match(css,/\.sidebar\s*>\s*\[data-route="settings"\][^}]*flex:0 0 auto/s);});
