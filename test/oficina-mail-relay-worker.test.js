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
