import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare/oficina-password-mailer/worker.mjs';

test('OTP relay must use Cloudflare-supported manual redirects and send only after authorization',async()=>{
 const originalFetch=globalThis.fetch;
 const messages=[];
 let calls=0;
 globalThis.fetch=async(url,options)=>{
   calls++;
   assert.match(url,/pdv-artisys\.sistema-artisys\.workers\.dev\/v1\/password-recovery\/relay-authorize/);
   assert.equal(options.method,'POST');
   assert.equal(options.redirect,'manual','Cloudflare Workers runtime rejects redirect:error');
   return Response.json({authorized:true});
 };
 try{
  const payload={email:'owner@example.com',installationId:'oficina-qa-0001',
    code:'123456',issuedAt:new Date().toISOString(),signature:'a'.repeat(64)};
  const request=new Request('https://oficina-mail.artisys.dev/send',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
  });
  const response=await worker.fetch(request,{EMAIL:{send:async message=>messages.push(message)}});
  assert.equal(response.status,202);
  assert.deepEqual(await response.json(),{accepted:true});
  assert.equal(calls,1);
  assert.equal(messages.length,1);
  assert.equal(messages[0].to,payload.email);
  assert.match(messages[0].text,/Valido por 48 horas/);
 }finally{globalThis.fetch=originalFetch;}
});

test('OTP relay rejects invalid signature before making any outbound request',async()=>{
 const originalFetch=globalThis.fetch;let called=false;
 globalThis.fetch=async()=>{called=true;throw Error('Should not call')};
 try{
  const response=await worker.fetch(new Request('https://oficina-mail.artisys.dev/send',{
   method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({email:'qa@example.com',installationId:'oficina-qa-0001',
      code:'123456',issuedAt:new Date().toISOString(),signature:'bad'})
  }),{EMAIL:{send:async()=>{throw Error('Should not send')}}});
  assert.equal(response.status,400);assert.equal(called,false);
 }finally{globalThis.fetch=originalFetch;}
});

test('relay envia boas-vindas Loja Roupas apenas após autorização da Central',async()=>{
 const original=globalThis.fetch,messages=[];
 globalThis.fetch=async(url,options)=>{
  assert.match(url,/pdv-artisys\.sistema-artisys\.workers\.dev\/v1\/license-welcome\/relay-authorize/);
  assert.equal(options.redirect,'manual');
  return Response.json({authorized:true});
 };
 try{
  const payload={email:'cliente@example.com',code:'654321',licenseId:'license-abc123',
   product:'LOJA_ROUPAS',issuedAt:new Date().toISOString(),signature:'a'.repeat(64)};
  const response=await worker.fetch(new Request('https://oficina-mail.artisys.dev/welcome',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
  }),{EMAIL:{send:async msg=>{messages.push(msg);return {messageId:'test-accepted'}}}});
  assert.equal(response.status,202);
  assert.equal((await response.json()).accepted,true);
  assert.equal(messages.length,1);
  assert.match(messages[0].subject,/Loja Roupas/);
  assert.match(messages[0].text,/654321/);
  assert.match(messages[0].text,/48 horas/);
  assert.equal(messages[0].to,'cliente@example.com');
 }finally{globalThis.fetch=original;}
});
test('relay Loja Roupas recusa pedidos não assinados sem enviar email',async()=>{
 let sent=0;
 const response=await worker.fetch(new Request('https://oficina-mail.artisys.dev/welcome',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({email:'cliente@example.com',code:'654321',licenseId:'license-1',product:'LOJA_ROUPAS',
    issuedAt:new Date().toISOString(),signature:'invalid'})
 }),{EMAIL:{send:async()=>{sent++}}});
 assert.equal(response.status,400);
 assert.equal(sent,0);
});
