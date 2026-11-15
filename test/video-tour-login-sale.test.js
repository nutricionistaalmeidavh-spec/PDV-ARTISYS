'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const json=p=>JSON.parse(read(p));
const demo=()=>json('qa/demo/tutorials/tour-login-ate-venda.json');
const index=(steps,name)=>steps.findIndex(step=>step.name===name);

test('tour video captures a visible login instead of using invisible auto-authentication',()=>{
  const steps=demo().steps;
  assert.equal(steps[0].action,'waitFor');
  assert.equal(steps[0].name,'app-ready');
  assert.equal(steps[0].selector,'#login-form');
  assert.ok(index(steps,'digitar-usuario')>0);
  assert.ok(index(steps,'digitar-senha')>index(steps,'digitar-usuario'));
  assert.ok(index(steps,'clicar-entrar')>index(steps,'digitar-senha'));
  assert.ok(index(steps,'autenticado')>index(steps,'clicar-entrar'));
  assert.equal(steps.some(step=>step.action==='authenticateLocalQa'),false);
  assert.equal(demo().metadata.qaAutoAdmin,true);
});

test('Playwright operates the built-in first-use guided tour before the stock and checkout flow',()=>{
  const steps=demo().steps;
  assert.ok(index(steps,'abrir-ajuda-primeiros-passos')>index(steps,'autenticado'));
  assert.ok(index(steps,'iniciar-tour-pelas-telas')>index(steps,'abrir-ajuda-primeiros-passos'));
  assert.ok(index(steps,'tour.record')>index(steps,'iniciar-tour-pelas-telas'));
  assert.ok(index(steps,'abrir-cadastros')>index(steps,'tour.record'));
  const adapter=read('qa/runtime/adapters/tour-login-sale.mjs');
  assert.match(adapter,/first-use-tour-panel/);
  assert.match(adapter,/\[data-tour-next\]/);
  assert.match(adapter,/if\(final\)/);
  assert.match(adapter,/tutorial\.cashFixture/);
});

test('tutorial continues through real product creation, cart, payment and canonical completed-sale check',()=>{
  const steps=demo().steps;
  for(const name of ['salvar-produto','produto-publicado','ir-para-balcao','adicionar-produto-na-venda','produto-no-carrinho','finalizar-venda','confirmar-pagamento','venda-finalizada','tutorial.assertSaleCompleted'])
    assert.ok(index(steps,name)>0,'missing '+name);
  assert.ok(index(steps,'salvar-produto')<index(steps,'ir-para-balcao'));
  assert.ok(index(steps,'ir-para-balcao')<index(steps,'finalizar-venda'));
  assert.ok(index(steps,'finalizar-venda')<index(steps,'confirmar-pagamento'));
  assert.ok(index(steps,'confirmar-pagamento')<index(steps,'tutorial.assertSaleCompleted'));
  assert.ok(steps.some(step=>step.selector==='#confirm-payment'&&step.action==='click'));
});

test('full tutorial is recorded by Actions and captioned from observed QA timestamps without paid services',()=>{
  const config=json('qa/artisys-qa.config.json');
  assert.equal(config.demos['tour-login-ate-venda'].profile,'tour-login-sale');
  assert.ok(config.demoProfiles['tour-login-sale']);
  assert.match(read('scripts/edit-login-tour-sale-video.cjs'),/summary\.steps/);
  assert.match(read('scripts/edit-login-tour-sale-video.cjs'),/ffmpeg/);
  const workflow=read('.github/workflows/video-tour-login-venda.yml');
  assert.match(workflow,/xvfb-run -a node qa\/runtime\/artisys-qa\.mjs demo/);
  assert.match(workflow,/tour-login-ate-venda/);
  assert.match(workflow,/actions\/upload-artifact@v4/);
  assert.doesNotMatch(workflow,/npm publish|electron-builder.*--publish|--publish always/);
});
