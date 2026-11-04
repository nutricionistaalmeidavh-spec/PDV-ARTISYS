'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {buildStaticPix}=require('../js/domains/payments/pix-brcode');

function fixture(options={}){
  let serial=0;
  const rt=createPdvRuntime({idFactory:p=>p+'-'+(++serial),now:()=>new Date().toISOString(),paymentOptions:{
    pixStatic:{key:'teste@example.com',merchantName:'LOJA TESTE',merchantCity:'RIBEIRAO PRETO'},
    ...options
  }});
  rt.catalog.createUser({id:'u1',username:'caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});
  rt.catalog.upsertProduct({id:'p1',name:'Produto',salePriceCents:1999,trackStock:false});
  rt.sales.openSale({id:'s1',saleNumber:'1',terminalId:'T1',operatorId:'u1'});
  rt.sales.addItem('s1',{productId:'p1'});
  rt.cash.openSession({terminalId:'T1',operatorId:'u1',openingAmountCents:0});
  return rt;
}
test('BR Code Pix preserva valor em centavos e CRC16 valido',()=>{
  const value=buildStaticPix({key:'123e4567-e12b-12d1-a456-426655440000',merchantName:'Fulano de Tal',merchantCity:'BRASILIA',amountCents:12345,txid:'***'});
  assert.match(value,/53039865406123\.455802BR/);
  assert.match(value,/6304[0-9A-F]{4}$/);
  assert.equal(value.slice(-4),require('../js/domains/payments/pix-brcode').crc16(value.slice(0,-4)));
});
test('Pix estatico e pendente ate confirmacao manual e protege checkout de pagamentos duplicados',()=>{
  const rt=fixture();
  try{
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'PIX_STATIC',amountCents:1999,idempotencyKey:'req1'});
    assert.equal(intent.status,'PENDING');assert.match(intent.brCode,/br.gov.bcb.pix/);
    assert.equal(rt.paymentIntents.create({saleId:'s1',channel:'PIX_STATIC',amountCents:1999,idempotencyKey:'req1'}).id,intent.id);
    assert.throws(()=>rt.paymentIntents.create({saleId:'s1',channel:'PIX_STATIC',amountCents:100,idempotencyKey:'req1'}),/idempotencia/i);
    assert.throws(()=>rt.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:1999}]}),/pendente/i);
    assert.throws(()=>rt.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:1999,metadata:{paymentIntentId:intent.id}}]}),/confirmado/i);
    rt.paymentIntents.confirmManual(intent.id,{checkedAccountCredit:true,actorId:'u1'});
    const result=rt.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:1999,metadata:{paymentIntentId:intent.id}}]});
    assert.equal(result.status,'COMPLETED');assert.equal(rt.paymentIntents.get(intent.id).status,'CONSUMED');
    assert.equal(rt.paymentIntents.get(intent.id).confirmationSource,'MANUAL');
  }finally{rt.close();}
});
test('Pix API somente autoriza apos prova bancaria com valor e txid corretos',async()=>{
  const provider={async start({txid}){return{txid,brCode:'PAYLOAD-DINAMICO'};},async verify({txid}){return{txid,status:'PAID',amountCents:1999,endToEndId:'E123456789'};}};
  const rt=fixture({pixProvider:provider});
  try{
    const created=rt.paymentIntents.create({saleId:'s1',channel:'PIX_API',amountCents:1999,idempotencyKey:'req-api'});
    const started=await rt.paymentIntents.start(created.id);
    assert.equal(started.status,'PENDING');
    assert.throws(()=>rt.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:1999}]}),/pendente/i);
    const verified=await rt.paymentIntents.reconcile(created.id);
    assert.equal(verified.status,'VERIFIED');assert.equal(verified.endToEndId,'E123456789');
    assert.throws(()=>rt.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:1998,metadata:{paymentIntentId:created.id}}]}),/valor/i);
    assert.equal(rt.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:1999,metadata:{paymentIntentId:created.id}}]}).status,'COMPLETED');
  }finally{rt.close();}
});
test('TEF falho ou indeterminado nunca se converte em autorizado',async()=>{
  const rt=fixture({tefProvider:{async start(){return{status:'UNKNOWN'};}}});
  try{
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'TEF',method:'DEBIT_CARD',amountCents:1999,idempotencyKey:'req-tef'});
    assert.equal((await rt.paymentIntents.start(intent.id)).status,'REVIEW');
    assert.throws(()=>rt.sales.completeSale('s1',{payments:[{method:'DEBIT_CARD',amountCents:1999,metadata:{paymentIntentId:intent.id}}]}),/confirmado/i);
  }finally{rt.close();}
});

test('TEF PayGo nao libera venda ate conciliacao real e reaproveita intencao sem repetir cobranca',async()=>{
  let charges=0;
  const provider={
    async start({txid,amountCents}){charges++;return{status:'PENDING',txid,amountCents,providerReference:'2015371'};},
    async reconcile({txid,amountCents,providerReference}){
      assert.equal(providerReference,'2015371');
      return{status:'APPROVED',txid,amountCents,providerReference,
        paymentExternalId:'2025992',authorizationCode:'AUT123',acquirer:'PAYGO'};
    }
  };
  const rt=fixture({tefProvider:provider});
  try{
    const created=rt.paymentIntents.create({saleId:'s1',channel:'TEF',method:'DEBIT_CARD',
      amountCents:1999,idempotencyKey:'paygo123'});
    const started=await rt.paymentIntents.start(created.id);
    assert.equal(started.status,'PENDING');
    assert.equal(started.providerReference,'2015371');
    assert.throws(()=>rt.sales.completeSale('s1',{payments:[{method:'DEBIT_CARD',amountCents:1999,
      metadata:{paymentIntentId:created.id}}]}),/confirmado/i);
    await rt.paymentIntents.start(created.id);
    assert.equal(charges,1,'repeticao nao deve iniciar outra operacao no terminal');
    const confirmed=await rt.paymentIntents.reconcile(created.id);
    assert.equal(confirmed.status,'VERIFIED');
    assert.equal(confirmed.confirmationSource,'TEF');
    assert.equal(rt.sales.completeSale('s1',{payments:[{method:'DEBIT_CARD',amountCents:1999,
      metadata:{paymentIntentId:created.id}}]}).status,'COMPLETED');
    assert.equal(rt.paymentIntents.get(created.id).status,'CONSUMED');
  }finally{rt.close();}
});
