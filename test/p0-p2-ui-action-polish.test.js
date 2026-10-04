'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('P0 renderer actions never depend on native browser dialogs',()=>{
  const renderer=path.join(root,'desktop','renderer');
  const offenders=[];
  for(const name of fs.readdirSync(renderer).filter(name=>name.endsWith('.js'))){
    const source=fs.readFileSync(path.join(renderer,name),'utf8');
    if(/\b(?:window|root|globalThis)\.(?:prompt|confirm|alert)\s*\(/.test(source))offenders.push(name);
  }
  assert.deepEqual(offenders,[]);
});

test('P0 parity cancel and reversal actions reach canonical mutations through an app-owned dialog',()=>{
  const source=read('desktop/renderer/backend-parity-ui.js');
  assert.match(source,/const ux=root\.ArtisysUxComponents/);
  assert.match(source,/data-cancel-return/);
  assert.match(source,/title:'Cancelar devolução'/);
  assert.match(source,/onConfirm:data=>api\.cancelReturn\(button\.dataset\.cancelReturn,String\(data\.reason\|\|''\)\.trim\(\)\)/);
  assert.match(source,/data-reverse-settlement/);
  assert.match(source,/title:'Estornar baixa'/);
  assert.match(source,/onConfirm:data=>api\.reverseFinanceSettlement\(button\.dataset\.reverseSettlement,String\(data\.reason\|\|''\)\.trim\(\)\)/);
  assert.match(source,/validate:data=>String\(data\.reason\|\|''\)\.trim\(\)\?null:/);
});

test('P2 FilterBar never renders a removable button without a declared action owner',()=>{
  delete require.cache[require.resolve(path.join(root,'desktop','renderer','ux-components.js'))];
  const {FilterBar}=require(path.join(root,'desktop','renderer','ux-components.js'));
  const passive=FilterBar({activeChips:[{key:'stock',label:'Estoque: baixo'}]});
  assert.doesNotMatch(passive,/<button[^>]*data-filter-key="stock"/);
  assert.match(passive,/<span[^>]*class="ux-filter-chip"/);

  const active=FilterBar({
    activeChips:[{key:'stock',label:'Estoque: baixo'}],
    removeAction:'products.remove-filter',
    clearAction:'products.clear-filters'
  });
  assert.match(active,/data-action="products\.remove-filter"/);
  assert.match(active,/data-filter-key="stock"/);
  assert.match(active,/data-action="products\.clear-filters"/);
});

test('P1 shell is slimmer without shrinking primary touch targets',()=>{
  const css=read('desktop/renderer/styles.css');
  assert.match(css,/\.app-column\s*\{[^}]*grid-template-rows:\s*72px 1fr 44px/s);
  assert.match(css,/\.brand-mark\s*\{[^}]*height:\s*72px\s*!important/s);
  assert.match(css,/\.topbar\s*\{[^}]*gap:\s*18px[^}]*padding:\s*0 0 0 24px/s);
  assert.match(css,/\.topbar-brand\s*\{[^}]*font-size:\s*23px/s);
  assert.match(css,/\.status-pill, \.context-pill\s*\{[^}]*height:\s*42px[^}]*padding:\s*0 12px/s);
  assert.match(css,/\.window-controls button\s*\{[^}]*width:\s*48px/s);
  assert.match(css,/\.app-footer\s*\{[^}]*padding:\s*0 24px[^}]*font-size:\s*11px/s);
  assert.match(css,/\.page-head\s*\{[^}]*margin-bottom:\s*14px/s);
  assert.match(css,/\.page-head h1\s*\{[^}]*font-size:\s*29px/s);
  assert.match(css,/\.primary-button, \.secondary-button, \.danger-button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(css,/\.secondary-button\s*\{[^}]*border:\s*1px solid #d7e1ed/s);
  assert.match(css,/\.primary-button:focus-visible, \.secondary-button:focus-visible, \.danger-button:focus-visible/s);
});

test('P1 operational pages use tighter rhythm while preserving 44px controls',()=>{
  const css=read('desktop/renderer/operational-pages.css');
  assert.match(css,/\.ops-page\{[^}]*padding:24px 28px 36px/s);
  assert.match(css,/\.ops-head\{[^}]*gap:20px[^}]*margin-bottom:18px/s);
  assert.match(css,/\.ops-head h1\{[^}]*font-size:29px/s);
  assert.match(css,/\.ops-metric,\.ops-card\{[^}]*border-radius:15px[^}]*box-shadow:0 6px 20px/s);
  assert.match(css,/\.ops-card\{[^}]*padding:18px/s);
  assert.match(css,/\.ops-table th\{[^}]*padding:10px 11px/s);
  assert.match(css,/\.ops-table td\{[^}]*padding:10px 11px/s);
  assert.match(css,/\.ops-primary,\.ops-secondary,\.ops-danger,\.ops-link\{[^}]*min-height:44px/s);
  assert.match(css,/\.ops-secondary\{[^}]*border:1px solid #d9e1ed/s);
  assert.match(css,/\.ops-primary:focus-visible,\.ops-secondary:focus-visible,\.ops-danger:focus-visible,\.ops-link:focus-visible/s);
});


test('P0 Actions QA proves the reverse-settlement button mutates persisted state',()=>{
  const adapter=read('qa/runtime/adapters/erp-finance-ci.mjs');
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  assert.match(adapter,/scenario==='ui-reverse-settlement'/);
  assert.match(adapter,/state\.settlementId=settled\.settlement\.id/);
  assert.match(adapter,/s==='ui-reverse-settlement'/);
  assert.ok(flow.steps.some(step=>step.action==='capability'&&step.name==='finance.setup'&&step.scenario==='ui-reverse-settlement'));
  assert.ok(flow.steps.some(step=>step.action==='capability'&&step.name==='finance.openReverseDialog'));
  assert.ok(flow.steps.some(step=>step.action==='capability'&&step.name==='finance.assert'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'financeiro-estorno-dialogo',
    'financeiro-estorno-motivo',
    'financeiro-estorno-confirmar',
    'financeiro-estorno-feedback'
  ])assert.equal(names.has(name),true,name);
});
