'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createLocalTefProvider}=require('../js/domains/payments/tef-local-provider');

const payment={id:'pay-123',txid:'A'.repeat(26),amountCents:2345,method:'DEBIT_CARD',saleId:'s1'};
test('TEF bridge local executa processo isolado e valida contrato sem expor ambiente do PDV',async()=>{
  const code=`
    let data='';
    process.stdin.on('data',chunk=>data+=chunk);
    process.stdin.on('end',()=>{
      const input=JSON.parse(data);
      const safe=!process.env.PDV_INTERNAL_PASSWORD;
      process.stdout.write(JSON.stringify({
        status:safe?'APPROVED':'UNKNOWN',txid:input.txid,amountCents:input.amountCents,
        nsu:'000132',authorizationCode:'AUTH01',acquirer:'HOMOLOGACAO'
      }));
    });
  `;
  const provider=createLocalTefProvider({executable:process.execPath,args:['-e',code],timeoutMs:5000});
  const previous=process.env.PDV_INTERNAL_PASSWORD;
  process.env.PDV_INTERNAL_PASSWORD='must-not-reach-child';
  try{
    const result=await provider.start(payment);
    assert.deepEqual(result,{
      status:'APPROVED',txid:payment.txid,amountCents:2345,
      nsu:'000132',authorizationCode:'AUTH01',acquirer:'HOMOLOGACAO'
    });
  }finally{if(previous===undefined)delete process.env.PDV_INTERNAL_PASSWORD;else process.env.PDV_INTERNAL_PASSWORD=previous;}
});
test('TEF bridge nao aceita caminho relativo ou transacao invalida',async()=>{
  assert.throws(()=>createLocalTefProvider({executable:'tef-bridge.exe'}),/absoluto/);
  const provider=createLocalTefProvider({executable:process.execPath,args:['-e','process.stdout.write("{}")'],timeoutMs:5000});
  await assert.rejects(()=>provider.start({...payment,amountCents:0}),/invalida/);
});
test('TEF bridge interrompe processo travado e retorna estado indeterminado',async()=>{
  const provider=createLocalTefProvider({executable:process.execPath,args:['-e','setInterval(()=>{},1000)'],timeoutMs:200});
  await assert.rejects(()=>provider.start(payment),/indeterminado/);
});
