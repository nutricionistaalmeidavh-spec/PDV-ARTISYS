'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
function read(file){return fs.readFileSync(path.join(root,file),'utf8');}

test('P14 settings surface exposes certificate, SEFAZ, readiness and protected production activation',()=>{
  const preload=read('desktop/preload.cjs');const ui=read('desktop/renderer/fiscal-monitor.js');
  assert.match(preload,/certificateStatus/);assert.match(preload,/importCertificate/);
  for(const marker of ['Configuração e Produção','Certificado A1','Status SEFAZ','Checklist de produção','Ativar produção']) assert.match(ui,new RegExp(marker,'i'));
  assert.doesNotMatch(ui,/pfxBase64|password\s*[:=]|csc\s*[:=]/i);
});

test('P14-P16 API routes expose readiness and contingency without filesystem paths',()=>{
  const router=read('server/fiscal-block6-router.js');const server=read('server/local-server.js');
  for(const route of ['/api/v1/fiscal/production/readiness','/api/v1/fiscal/production/activate','/api/v1/fiscal/production/evidence','/api/v1/fiscal/contingencies']) assert.match(router,new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(router,/contingency/);assert.doesNotMatch(router,/xml_path|cancellation_xml_path|filePath/i);assert.match(server,/createFiscalBlock6Router/);
});

test('P16 ACBr adapter has separate create/sign and later send path for offline contingency',()=>{
  const adapter=read('server/fiscal-sidecar/acbr-monitor-adapter.js');const protocol=read('server/fiscal-sidecar/acbr-monitor-protocol.js');
  assert.match(adapter,/CriarNFe/);assert.match(adapter,/EnviarNFe/);assert.match(adapter,/contingency/i);assert.match(protocol,/tpEmis/);assert.match(protocol,/dhCont/);assert.match(protocol,/xJust/);
});
