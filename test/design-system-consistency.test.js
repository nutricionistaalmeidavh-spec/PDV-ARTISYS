'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('desktop exposes canonical semantic visual tokens for shared controls and states',()=>{
  const css=read('desktop/renderer/styles.css');
  for(const token of [
    '--font-ui:',
    '--radius-control:',
    '--radius-card:',
    '--radius-panel:',
    '--radius-pill:',
    '--control-border:',
    '--control-border-focus:',
    '--focus-ring:',
    '--surface-info:',
    '--surface-success:',
    '--surface-warning:',
    '--surface-danger:',
    '--text-success:',
    '--text-warning:',
    '--text-danger:'
  ]) assert.ok(css.includes(token),`missing ${token}`);
});

test('checkout observation presentation is stylesheet-owned instead of inline JS styling',()=>{
  const source=read('desktop/renderer/sale-observation-ui.js');
  assert.doesNotMatch(source,/style\.cssText|style="/);
  assert.match(source,/sale-observation-detail/);
  assert.match(source,/sale-observation-editor/);
});

test('active renderer presentation stays in CSS instead of inline style attributes',()=>{
  for(const file of ['desktop/renderer/app.js','desktop/renderer/sale-observation-ui.js','desktop/renderer/delivery-address-ui.js']){
    const source=read(file);
    assert.doesNotMatch(source,/style\.cssText|style="/,file);
  }
});

test('checkout remove action uses a canonical class instead of one-off destructive color',()=>{
  const source=read('desktop/renderer/app.js');
  assert.doesNotMatch(source,/color:#e22/i);
  assert.match(source,/cart-remove-button/);
});

test('high-traffic renderer surfaces consume canonical semantic tokens instead of near-duplicate colors',()=>{
  const files=[
    'desktop/renderer/settings-hub-ui.css',
    'desktop/renderer/ux-components.css',
    'desktop/renderer/regression-hardening.css',
    'desktop/renderer/restaurant-public-ordering-ui.css'
  ];
  const joined=files.map(read).join('\n');
  for(const value of ['#2b77e5','#155eef','#67758a','#53627f','#cad8e9','#d4deeb','#b42332','#157347','#69758c','#ffd0d5','#fff1f2','#fff8e8'])
    assert.doesNotMatch(joined,new RegExp(value,'i'),`replace ${value} with a semantic token`);
});

test('independent mobile surfaces keep exact ArtiSys brand tokens and UI typography',()=>{
  const mobile=read('server/mobile/styles.css');
  const menu=read('server/customer-menu/styles.css');
  for(const css of [mobile,menu]){
    assert.match(css,/--blue:#0b6cff/);
    assert.match(css,/--blue2:#10a7ff/);
    assert.match(css,/--navy:#081a35/);
    assert.match(css,/--ink:#10172f/);
    assert.match(css,/font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif/);
  }
});
