'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('flow hub cards reset legacy grid spans and keep comfortable internal spacing',()=>{
  const css=read('desktop/renderer/classic-home-ui.css');
  assert.match(css,/\.flow-hub-grid \.home-tile\s*\{[^}]*grid-column:auto[^}]*min-width:0[^}]*min-height:120px[^}]*padding:16px 18px/s);
  assert.match(css,/\.flow-hub-grid \.home-tile p\s*\{[^}]*line-height:1\.35/s);
  assert.match(css,/flow-hub-page\[data-flow-hub="Cadastros"\] \.home-tile\s*\{[^}]*min-height:112px[^}]*padding:15px 18px/s);
});

test('settings cards reserve breathing room and align switches with their explanatory copy',()=>{
  const css=read('desktop/renderer/settings-hub-ui.css');
  assert.match(css,/\.settings-hub-nav button\s*\{[^}]*min-height:80px[^}]*padding:14px 16px/s);
  assert.match(css,/\.settings-hub-nav span,.settings-hub-current\s*\{[^}]*line-height:1\.35/s);
  assert.match(css,/\.module-family\s*\{[^}]*padding:16px 18px/s);
  assert.match(css,/\.vertical-toggle\s*\{[^}]*display:grid[^}]*grid-template-columns:minmax\(0,1fr\) 42px[^}]*align-items:center[^}]*gap:16px/s);
  assert.match(css,/\.vertical-toggle input\[role="switch"\]\s*\{[^}]*margin:0[^}]*justify-self:end[^}]*align-self:center/s);
});

test('access selection controls use a stable control column instead of floating beside copy',()=>{
  const css=read('desktop/renderer/access-center-ui.css');
  assert.match(css,/\.access-permission-row\s*\{[^}]*grid-template-columns:24px minmax\(0,1fr\)[^}]*gap:12px/s);
  assert.match(css,/\.access-permission-row input\s*\{[^}]*width:18px[^}]*height:18px[^}]*margin:1px 0 0/s);
  assert.match(css,/\.access-toggle-row\s*\{[^}]*grid-template-columns:24px minmax\(0,1fr\)[^}]*gap:12px[^}]*padding:14px/s);
  assert.match(css,/\.access-toggle-row input\s*\{[^}]*width:18px[^}]*height:18px[^}]*margin:1px 0 0/s);
});
