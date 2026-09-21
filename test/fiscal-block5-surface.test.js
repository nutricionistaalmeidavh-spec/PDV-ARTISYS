'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');

const root=path.join(__dirname,'..');
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}

test('P10 monitor fiscal is loaded by desktop settings and keeps actions state-aware',()=>{
  const html=read('desktop/renderer/index.html');const ui=read('desktop/renderer/fiscal-monitor.js');
  assert.match(html,/fiscal-monitor\.js/);assert.match(ui,/Fiscal · Documentos/);assert.match(ui,/UNKNOWN/);assert.match(ui,/Reconciliar/);assert.match(ui,/Cancelar/);assert.match(ui,/DANFE/);assert.match(ui,/XML cancelamento/);
  assert.match(ui,/querySelector\('#fiscal-monitor-panel'\)/,'observer must guard duplicate mount before mutating settings DOM');
  execFileSync(process.execPath,['--check',path.join(root,'desktop/renderer/fiscal-monitor.js')],{stdio:'pipe'});
});

test('P10-P13 local API exposes monitor events reconcile cancel XML and DANFE without filesystem path API',()=>{
  const router=read('server/fiscal-block5-router.js');
  for(const route of ['/monitor','/events','/reconcile','/cancel','/danfe'])assert.ok(router.includes(route),route);
  assert.match(router,/kind=|searchParams\.get\('kind'\)/);assert.match(router,/readXml/);assert.doesNotMatch(router,/cancellationXmlPath.*sendJson|xmlPath.*sendJson/);
  execFileSync(process.execPath,['--check',path.join(root,'server/fiscal-block5-router.js')],{stdio:'pipe'});
});

test('P12 local archive rejects traversal and stores XML outside renderer surface',()=>{
  const source=read('js/domains/fiscal/fiscal-artifact-store.js');assert.match(source,/Caminho de artefato fiscal fora do arquivo local/);assert.match(source,/0o600/);assert.match(source,/MAX_XML_BYTES/);assert.doesNotMatch(read('desktop/renderer/fiscal-monitor.js'),/xmlPath|cancellationXmlPath/);
});
