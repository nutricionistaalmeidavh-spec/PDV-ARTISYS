'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=relative=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');
const json=relative=>JSON.parse(read(relative));
const tutorial=()=>json('qa/demo/tutorials/13-cadastrar-produto.json');
const index=(steps,name)=>steps.findIndex(step=>step.name===name);

test('tutorial de cadastro faz cadastro rápido com saldo e publicação explícita antes de abrir o Balcão',()=>{
  const steps=tutorial().steps;
  const quick=index(steps,'abrir-cadastro-rapido');
  const save=index(steps,'salvar-produto');
  const published=index(steps,'produto-publicado');
  const checkout=index(steps,'ir-para-balcao');
  assert.ok(quick>0,'deve abrir o cadastro rápido');
  assert.ok(steps.some(step=>step.selector==='#inventory-quick-product'&&step.action==='click'));
  assert.ok(steps.some(step=>step.selector==='#quick-stock-name'&&step.action==='fill'));
  assert.ok(steps.some(step=>step.selector==='#quick-stock-price'&&step.action==='fill'));
  assert.ok(steps.some(step=>step.selector==='#quick-stock-quantity'&&step.action==='fill'&&Number(step.value)>0));
  assert.ok(steps.some(step=>step.action==='check'&&step.selector==='#quick-stock-product-form input[name="publish"]'));
  assert.ok(save>quick&&published>save&&checkout>published,'só avançar depois de confirmar publicação');
  assert.ok(steps[save].selector.includes('#quick-stock-product-form'));
  assert.ok(steps[published].expected.includes('No Cardápio e no Balcão'));
  assert.ok(steps[checkout].selector.includes('data-quick-stock-checkout'));
});

test('tutorial só termina depois de adicionar o produto e concluir pagamento real no Balcão de QA',()=>{
  const steps=tutorial().steps;
  const checkout=index(steps,'ir-para-balcao');
  const search=index(steps,'buscar-produto-balcao');
  const card=index(steps,'adicionar-produto-na-venda');
  const cart=index(steps,'produto-no-carrinho');
  const finish=index(steps,'finalizar-venda');
  const modal=index(steps,'pagamento-pronto');
  const confirm=index(steps,'confirmar-pagamento');
  const complete=index(steps,'venda-finalizada');
  assert.ok(checkout<search&&search<card&&card<cart&&cart<finish&&finish<modal&&modal<confirm&&confirm<complete);
  assert.equal(steps[cart].action,'expectText');
  assert.equal(steps[modal].selector,'#confirm-payment');
  assert.equal(steps[confirm].selector,'#confirm-payment');
  assert.equal(steps[complete].action,'expectText');
  assert.match(steps[complete].expected,/finalizada/);
  assert.equal(complete,steps.length-1,'não declarar sucesso antes da venda concluída');
});

test('cenário de cadastro não pré-cria o produto, mas prepara caixa aberto para uma venda em dinheiro',()=>{
  const adapter=read('qa/runtime/adapters/tutorials-p1-p3.mjs');
  assert.match(adapter,/scenario==='product-create'\)await ensureCash\(\)/);
  const steps=tutorial().steps;
  assert.ok(steps.some(step=>step.name==='escolher-dinheiro'&&step.selector==='[data-pay="cash"]'));
});

test('vídeo de cadastro explica publicação, Balcão e venda completa dentro do limite contratado',()=>{
  const catalog=json('qa/tutorials/catalog.json');
  const item=catalog.tutorials.find(row=>row.id==='13-cadastrar-produto');
  const config=json('qa/artisys-qa.config.json').demos['13-cadastrar-produto'];
  assert.equal(item.durationTargetSec,config.durationTargetSec);
  assert.ok(item.durationTargetSec<=catalog.maxDurationSec);
  assert.match(item.goal,/venda/i);
  assert.match(item.success,/venda concluída/i);
  assert.ok(item.overlays.some(overlay=>/Balcão/i.test(overlay.text)));
  assert.ok(item.overlays.some(overlay=>/Venda finalizada/i.test(overlay.text)));
});
