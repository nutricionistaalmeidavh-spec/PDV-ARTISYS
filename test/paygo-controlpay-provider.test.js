'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPayGoControlPayProvider}=require('../js/domains/payments/paygo-controlpay-provider');

const txid='F8A4C3D2E1B0A9F8A4C3D2E1B0';
function provider(request){
  return createPayGoControlPayProvider({
    baseUrl:'https://sandbox.controlpay.com.br/webapi/',
    integrationKey:'key-test-123456789',
    terminalId:'1234',
    requestImpl:request
  });
}
test('PayGo opt-in inicia debito no terminal certo em centavos sem aprovar antes da conciliacao',async()=>{
  let route,body;
  const tef=provider(async (path,options)=>{
    route=path;body=options.body;
    return{intencaoVenda:{id:2015371,intencaoVendaStatus:{id:6}}};
  });
  const result=await tef.start({txid,method:'DEBIT_CARD',amountCents:12345,saleId:'s1'});
  assert.deepEqual(result,{status:'PENDING',txid,amountCents:12345,providerReference:'2015371'});
  assert.match(route,/Venda\/Vender/);
  assert.equal(body.terminalId,'1234');
  assert.equal(body.formaPagamentoId,22);
  assert.equal(body.valorTotalVendido,'123,45');
  assert.equal(body.observacao,txid);
  assert.equal(body.aguardarTefIniciarTransacao,true);
});
test('PayGo status final precisa confirmar valor, metodo, autorizacao e pagamento externo finalizado',async()=>{
  const tef=provider(async (path,options)=>{
    assert.match(path,/IntencaoVenda\/GetById/);
    return{intencaoVenda:{
      id:2015371,valorFinalFormat:'123,45',formaPagamento:{id:21},
      intencaoVendaStatus:{id:10},
      pagamentosExternos:[{id:2025992,autorizacao:'AUT123',pagamentoExternoStatus:{id:15}}]
    }};
  });
  assert.deepEqual(await tef.reconcile({txid,providerReference:'2015371',method:'CREDIT_CARD',amountCents:12345}),{
    status:'APPROVED',txid,amountCents:12345,providerReference:'2015371',
    authorizationCode:'AUT123',acquirer:'PAYGO',paymentExternalId:'2025992'
  });
});
test('PayGo resultado nao final nao comprova pagamento',async()=>{
  const tef=provider(async()=>({intencaoVenda:{
    id:2015371,valorFinalFormat:'10,00',formaPagamento:{id:22},
    intencaoVendaStatus:{id:6},pagamentosExternos:[]}}));
  assert.deepEqual(await tef.reconcile({txid,providerReference:'2015371',method:'DEBIT_CARD',amountCents:1000}),{status:'PENDING',txid});
});
test('PayGo recusa incongruencia de centavos, metodo e adquirente',async()=>{
  const tef=provider(async()=>({intencaoVenda:{
    id:2015371,valorFinalFormat:'99,99',formaPagamento:{id:21},
    intencaoVendaStatus:{id:10},
    pagamentosExternos:[{id:2025992,autorizacao:'AUT123',pagamentoExternoStatus:{id:15}}]
  }}));
  await assert.rejects(()=>tef.reconcile({txid,providerReference:'2015371',method:'CREDIT_CARD',amountCents:10000}),/valor/i);
});
test('PayGo rejeita HTTP, credenciais ausentes e terminal ausente',()=>{
  assert.throws(()=>createPayGoControlPayProvider({baseUrl:'http://example.com',integrationKey:'abc',terminalId:'123'}),/HTTPS/);
  assert.throws(()=>createPayGoControlPayProvider({baseUrl:'https://example.com/',terminalId:'123'}),/chave/i);
  assert.throws(()=>createPayGoControlPayProvider({baseUrl:'https://example.com/',integrationKey:'abc'}),/terminal/i);
});

test('PayGo permite configurar PinPads diferentes por terminal LAN sem troca acidental de caixa',async()=>{
  let selected;
  const tef=createPayGoControlPayProvider({
    baseUrl:'https://sandbox.controlpay.com.br/webapi/',
    integrationKey:'key-test-123456789',
    terminalMap:{T1:'1234',T2:'5678'},
    requestImpl:async(_path,options)=>{selected=options.body.terminalId;return{intencaoVenda:{id:2015371}};}
  });
  await tef.start({txid,method:'DEBIT_CARD',amountCents:1000,terminalId:'T2'});
  assert.equal(selected,'5678');
  await assert.rejects(()=>tef.start({txid,method:'DEBIT_CARD',amountCents:1000,terminalId:'T3'}),/terminal/i);
});
