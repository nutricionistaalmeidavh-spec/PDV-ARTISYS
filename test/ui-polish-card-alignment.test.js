'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('workflow cards reset inherited grid placement and keep comfortable text breathing room',()=>{
  const css=read('desktop/renderer/classic-home-ui.css');
  assert.match(css,/\.flow-hub-grid \.home-tile\s*\{[^}]*grid-column:auto[^}]*min-height:120px[^}]*padding:18px 20px 17px/s);
  assert.match(css,/\.flow-hub-grid \.home-tile p\s*\{[^}]*line-height:1\.4[^}]*overflow-wrap:anywhere/s);
  assert.match(css,/flow-hub-page\[data-flow-hub="Cadastros"\] \.home-tile\s*\{[^}]*min-height:112px[^}]*padding:16px 18px 15px/s);
});

test('settings switches stay visually attached to their explanatory copy',()=>{
  const css=read('desktop/renderer/settings-hub-ui.css');
  assert.match(css,/\.vertical-toggle\s*\{[^}]*min-height:64px[^}]*padding:12px 2px[^}]*gap:18px[^}]*align-items:center/s);
  assert.match(css,/\.vertical-toggle>span\s*\{[^}]*min-width:0[^}]*padding-right:8px/s);
  assert.match(css,/\.vertical-toggle input\[role="switch"\]\s*\{[^}]*margin:0[^}]*align-self:center/s);
  assert.match(css,/module-family\[data-module-config\]>\.vertical-rule\s*\{[^}]*line-height:1\.4[^}]*white-space:normal[^}]*overflow-wrap:anywhere/s);
});

test('access checkboxes align consistently with labels and descriptions',()=>{
  const css=read('desktop/renderer/access-center-ui.css');
  assert.match(css,/\.access-permission-row\s*\{[^}]*grid-template-columns:20px minmax\(0,1fr\)[^}]*gap:12px[^}]*padding:12px 14px/s);
  assert.match(css,/\.access-permission-row input\s*\{[^}]*width:18px[^}]*height:18px[^}]*margin:1px 0 0/s);
  assert.match(css,/\.access-toggle-row\s*\{[^}]*grid-template-columns:20px minmax\(0,1fr\)[^}]*gap:12px[^}]*align-items:center[^}]*padding:14px/s);
  assert.match(css,/\.access-toggle-row input\s*\{[^}]*width:18px[^}]*height:18px[^}]*margin:0/s);
});
