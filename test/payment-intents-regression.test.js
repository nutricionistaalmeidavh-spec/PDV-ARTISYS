'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

function testRuntime(options={}){
  let counter=0;
  const rt=createPdvRuntime({
    now:()=>new Date().toISOString(),
    idFactory:prefix=>prefix+'-'+(++counter),
    ...options
  });
  rt.catalog.createUser({id:'u1',username:'caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});
  rt.catalog.upsertProduct({id:'p1',name:'Produto',salePriceCents:10000,trackStock:false});
  rt.sales.openSale({id:'s1',terminalId:'T1',operatorId:'u1'});
  rt.sales.addItem('s1',{productId:'p1'});
  return rt;
}
const config={key:'contato@lojax.com.br',merchantName:'LOJA X',merchantCity:'SAO PAULO'};

test('Pix local usa configuracao do banco SQLite da loja sem credenciais em nuvem',()=>{
  const rt=testRuntime({paymentOptions:{pixStatic:null}});
  try{
    assert.deepEqual(rt.paymentIntents.capabilities(),{pixStatic:false,pixApi:false,tef:false});
    rt.settings.set('payments.pix.static',config,{actor:{kind:'system'}});
    assert.equal(rt.paymentIntents.capabilities().pixStatic,true);
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'PIX_STATIC',method:'PIX',amountCents:10000,idempotencyKey:'local-one'});
    assert.equal(intent.txid.length,25);
    assert.match(intent.brCode,/5406100\.00/);
    assert.match(intent.qrSvg,/<svg/);
    assert.equal(intent.status,'PENDING');
  }finally{rt.close();}
});
test('Pix com API usa txid de 26 caracteres e nao dispara cobranca duplicada no retry',async()=>{
  let calls=0;
  const rt=testRuntime({paymentOptions:{pixProvider:{async start({txid}){calls++;return{txid,brCode:'PIX-AUTOMATICO'};}}}});
  try{
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'PIX_API',method:'PIX',amountCents:10000,idempotencyKey:'bank-one'});
    assert.equal(intent.txid.length,26);
    await rt.paymentIntents.start(intent.id);
    await rt.paymentIntents.start(intent.id);
    assert.equal(calls,1);
    assert.equal(rt.paymentIntents.get(intent.id).status,'PENDING');
  }finally{rt.close();}
});
test('tentativa pendente permanece bloqueada depois de reiniciar servidor SQLite',()=>{
  const dir=mkdtempSync(join(tmpdir(),'artisys-pix-restart-'));const dbPath=join(dir,'pdv.sqlite');
  try{
    const rt=testRuntime({dbPath,paymentOptions:{pixStatic:config}});
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'PIX_STATIC',method:'PIX',amountCents:10000,idempotencyKey:'reopen'});
    rt.close();
    const second=createPdvRuntime({dbPath,paymentOptions:{pixStatic:config}});
    try{
      assert.equal(second.paymentIntents.get(intent.id).status,'PENDING');
      assert.throws(()=>second.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:10000,metadata:{paymentIntentId:intent.id}}]}),/confirmado/i);
    }finally{second.close();}
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('Pix pago sem associacao explicita a venda nao baixa caixa nem estoque',()=>{
  const rt=testRuntime({paymentOptions:{pixStatic:config}});
  try{
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'PIX_STATIC',method:'PIX',amountCents:10000,idempotencyKey:'independent'});
    rt.paymentIntents.confirmManual(intent.id,{checkedAccountCredit:true,actorId:'u1'});
    assert.throws(()=>rt.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:10000}]}),/pendente/i);
    assert.equal(rt.sales.getSale('s1').status,'OPEN');
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS total FROM payments WHERE sale_id=?').get('s1').total,0);
    assert.equal(rt.paymentIntents.get(intent.id).status,'MANUAL_CONFIRMED');
  }finally{rt.close();}
});

test('venda aberta com Pix pendente nao pode ser cancelada antes de reconciliar ou cancelar o QR',()=>{
  const rt=testRuntime({paymentOptions:{pixStatic:config}});
  try{
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'PIX_STATIC',method:'PIX',amountCents:10000,idempotencyKey:'before-cancel'});
    assert.throws(()=>rt.sales.cancelSale('s1',{reason:'desistencia'}),/estorno externo/i);
    rt.paymentIntents.cancel(intent.id);
    assert.equal(rt.sales.cancelSale('s1',{reason:'desistencia'}).status,'CANCELLED');
  }finally{rt.close();}
});
test('Pix vinculado nao pode ser estornado somente por cancelamento ou devolucao locais',()=>{
  const rt=testRuntime({paymentOptions:{pixStatic:config}});
  try{
    rt.cash.openSession({terminalId:'T1',operatorId:'u1',openingAmountCents:0});
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'PIX_STATIC',method:'PIX',amountCents:10000,idempotencyKey:'paid-refund'});
    rt.paymentIntents.confirmManual(intent.id,{checkedAccountCredit:true,actorId:'u1'});
    assert.equal(rt.sales.completeSale('s1',{payments:[{method:'PIX',amountCents:10000,metadata:{paymentIntentId:intent.id}}]}).status,'COMPLETED');
    assert.throws(()=>rt.sales.cancelSale('s1',{reason:'tentativa de estorno'}),/estorno externo/i);
    const {createReturnService}=require('../js/domains/returns/return-service');
    const service=createReturnService({db:rt.db,outbox:rt.outbox});
    assert.throws(()=>service.createReturn({saleId:'s1',terminalId:'T1',operatorId:'u1',reason:'teste',actor:{userId:'u1'},items:[],refunds:[]}),/reembolso externo/i);
  }finally{rt.close();}
});

test('TEF indeterminado somente volta a confirmado apos consulta autenticada do provedor',async()=>{
  const tefProvider={
    async start(){return{status:'UNKNOWN'};},
    async verify({txid,amountCents}){return{status:'APPROVED',txid,amountCents,nsu:'000123',authorizationCode:'456789',acquirer:'ADQUIRENTE_TESTE'};}
  };
  const rt=testRuntime({paymentOptions:{tefProvider}});
  try{
    const intent=rt.paymentIntents.create({saleId:'s1',channel:'TEF',method:'DEBIT_CARD',amountCents:10000,idempotencyKey:'tef-recover'});
    assert.equal((await rt.paymentIntents.start(intent.id)).status,'REVIEW');
    assert.equal((await rt.paymentIntents.reconcile(intent.id)).status,'VERIFIED');
    assert.match(rt.paymentIntents.get(intent.id).providerReference,/ADQUIRENTE_TESTE:000123/);
  }finally{rt.close();}
});
