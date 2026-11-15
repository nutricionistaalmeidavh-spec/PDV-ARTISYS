'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const json=p=>JSON.parse(read(p));
const flow=()=>json('qa/demo/tutorials/gestao-caixas-auditoria.json');
const idx=(steps,name)=>steps.findIndex(s=>s.name===name);
test('tutorial de caixa filma login real e histórico, sem tratar anulação como exclusão de vendas',()=>{
 const steps=flow().steps;
 assert.equal(steps[0].selector,'#login-form');
 for(const key of ['entrar','cash.videoFixture','abrir-historico-caixa','ver-detalhes-caixa-com-venda','anulacao-bloqueada','corrigir-contagem','correcao-auditada','abrir-caixa-vazio','fechar-caixa-vazio','ver-detalhes-caixa-vazio','anular-caixa-vazio','anulacao-auditada'])
  assert.ok(idx(steps,key)>=0,key);
 assert.ok(idx(steps,'anulacao-bloqueada')<idx(steps,'corrigir-contagem'));
 assert.ok(idx(steps,'corrigir-contagem')<idx(steps,'correcao-auditada'));
 assert.ok(idx(steps,'abrir-caixa-vazio')<idx(steps,'fechar-caixa-vazio'));
 assert.ok(idx(steps,'fechar-caixa-vazio')<idx(steps,'anular-caixa-vazio'));
 assert.ok(idx(steps,'anular-caixa-vazio')<idx(steps,'anulacao-auditada'));
 assert.ok(!steps.some(s=>s.action==='authenticateLocalQa'));
});
test('fixtures usam somente APIs canônicas de venda, caixa e estoque em ambiente isolado',()=>{
 const adapter=read('qa/runtime/adapters/cash-video-qa.mjs');
 for(const key of ['api.completeSale','api.cashAction','api.cashDetails','canAnnul','[data-cash-details]','cash.verifiedAnnul'])
  assert.ok(adapter.includes(key),key);
 assert.match(adapter,/cash\.videoFixture/);
 assert.doesNotMatch(adapter,/DELETE FROM cash_sessions|localStorage\.clear|PDV_AUTO_PRINT.*true/);
 const config=json('qa/artisys-qa.config.json');
 assert.equal(config.demos['gestao-caixas-auditoria'].profile,'cash-video-qa');
 assert.ok(config.demoProfiles['cash-video-qa']);
});
test('workflow gera MP4 instrutivo por Playwright, confirma a venda e expõe artifact',()=>{
 const w=read('.github/workflows/video-gestao-caixas-auditoria.yml');
 assert.match(w,/xvfb-run -a node qa\/runtime\/artisys-qa\.mjs demo/);
 assert.match(w,/gestao-caixas-auditoria/);
 assert.match(w,/actions\/upload-artifact@v4/);
 assert.match(w,/ffprobe/);
 assert.doesNotMatch(w,/npm publish|--publish always/);
 const edit=read('scripts/edit-cash-video.cjs');
 assert.match(edit,/summary\.steps/);
 assert.match(edit,/ffmpeg/);
});
