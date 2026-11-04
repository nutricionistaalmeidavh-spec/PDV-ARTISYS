'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPixApiProvider}=require('../js/domains/payments/pix-api-provider');
test('Pix cobranca API envia valor exato, chave e txid e retorna BR Code',async()=>{
  const calls=[];const txid='A'.repeat(26);
  const provider=createPixApiProvider({
    baseUrl:'https://bank.example.com/pix/v2/',pixKey:'pix@example.com',
    tokenProvider:async()=>'test-token-long-enough',
    requestImpl:async(method,path,body,token)=>{
      calls.push({method,path,body,token});
      if(method==='PUT')return{txid,loc:{id:23}};
      if(path==='loc/23/qrcode')return{qrcode:'000201DEMO'};
      return{txid,status:'CONCLUIDA',pix:[{endToEndId:'E1234567890',valor:'19.99'}]};
    }
  });
  assert.deepEqual(await provider.start({txid,amountCents:1999}),{txid,brCode:'000201DEMO'});
  assert.equal(calls[0].path,'cob/'+txid);
  assert.equal(calls[0].body.valor.original,'19.99');
  assert.equal(calls[0].body.chave,'pix@example.com');
  assert.deepEqual(await provider.verify({txid,amountCents:1999}),{status:'PAID',txid,amountCents:1999,endToEndId:'E1234567890'});
});
test('Pix API nao aceita valor divergente ou origem HTTP',async()=>{
  assert.throws(()=>createPixApiProvider({baseUrl:'http://example.com',pixKey:'a',tokenProvider:async()=>'any'}),/HTTPS/);
  const provider=createPixApiProvider({
    baseUrl:'https://bank.example.com/',pixKey:'pix@example.com',
    tokenProvider:async()=>'test-token-long-enough',
    requestImpl:async()=>({txid:'B'.repeat(26),status:'CONCLUIDA',pix:[{endToEndId:'E1234567890',valor:'9.99'}]})
  });
  await assert.rejects(()=>provider.verify({txid:'B'.repeat(26),amountCents:1999}),/divergente/);
});
