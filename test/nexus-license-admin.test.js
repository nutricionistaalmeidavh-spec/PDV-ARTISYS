'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
test('Nexus trial filters preserve compilable inline Central admin JS',async()=>{
 const {handleRequest}=await import('../cloudflare/account/src/worker.mjs');
 const sessions=[];
 const store={
   createAdminSession:async record=>{sessions.push(record)},
   findAdminSession:async ({digest,now})=>sessions.find(x=>x.tokenDigest===digest&&x.expiresAt>now)||null,
   listLicenses:async()=>[]
 };
 const env={ACCOUNT_STORE:store,ADMIN_TOKEN:'test-admin-token'};
 const start=await handleRequest(new Request('https://central.example/v1/admin/session',{
   method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:'test-admin-token'})
 }),env);
 assert.equal(start.status,204);
 const cookie=String(start.headers.get('set-cookie')||'').split(';')[0];
 const html=await (await handleRequest(new Request('https://central.example/admin',{headers:{cookie}}),env)).text();
 assert.match(html,/filter-product/);
 assert.match(html,/filter-kind/);
 assert.match(html,/filter-source/);
 assert.match(html,/Converter em comercial/);
 assert.match(html,/visible\.map\(x=>'<tr><td>'\+esc/);
 const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,'inline admin script missing');
 assert.doesNotThrow(()=>new Function(script),'admin inline script must compile');
 assert.match(script,/\/\^\\d\{4\}/,'date validation must recognize digits');
});
