'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
test('P3 endpoints require admin session; dashboard/history and welcome retry are scoped to Nexus',async()=>{
 const {handleRequest}=await import('../cloudflare/account/src/worker.mjs');
 const events=[];let resendCount=0;
 const accountStore={
   sessions:[],
   async createAdminSession(p){this.sessions.push(p)},
   async findAdminSession({digest,now}){return this.sessions.find(x=>x.tokenDigest===digest&&x.expiresAt>now)||null},
   async findLicenseById(id){return id==='license-nexus-1234'?{id,product:'PDV_NEXUS_2',status:'ACTIVE'}:{id,product:'OFICINA',status:'ACTIVE'}},
   async listLicenses(){return []}
 };
 const trialStore={
   async ensure(){},
   async listDashboardRows(){return [{id:'license-nexus-1234',product:'PDV_NEXUS_2',status:'ACTIVE',metadata_json:'{"kind":"TRIAL"}',expires_at:new Date(Date.now()+24*60*60*1000).toISOString()}]},
   async listEvents(){return events},
   async logEvent(id,eventType,actor,details){events.push({eventType,actor,details,createdAt:new Date().toISOString()})},
   async findWelcome(id){return id==='license-nexus-1234'?{email:'nexus@example.org',installationId:'unit-12345',expiresAt:new Date(Date.now()+86400000).toISOString(),status:'ACTIVE'}:null},
   async reserveWelcomeResend(){return ++resendCount===1},
   async delivery(){}
 };
 let sent=0;
 const env={ADMIN_TOKEN:'admin-test',ACCOUNT_STORE:accountStore,NEXUS_TRIAL_STORE:trialStore,
   NEXUS_TRIAL_PEPPER:'a-long-test-pepper-for-nexus-license',
   NEXUS_MAIL_FETCH:async()=>{sent++;return Response.json({accepted:true})}
 };
 const req=(route,init={})=>new Request('https://central.example'+route,{headers:{'content-type':'application/json',...(init.headers||{})},...init});
 const overview='/v1/admin/nexus/overview';
 assert.equal((await handleRequest(req(overview),env)).status,401);
 const login=await handleRequest(req('/v1/admin/session',{method:'POST',body:JSON.stringify({token:'admin-test'})}),env);
 assert.equal(login.status,204);
 const headers={cookie:login.headers.get('set-cookie').split(';')[0]};
 const data=await (await handleRequest(req(overview,{headers}),env)).json();
 assert.equal(data.summary.activeTrials,1);
 assert.equal(data.summary.converted,0);
 const historyPath='/v1/admin/nexus/licenses/license-nexus-1234/events';
 assert.equal((await handleRequest(req(historyPath,{headers}),env)).status,200);
 assert.equal((await handleRequest(req('/v1/admin/nexus/licenses/license-oficina-1/events',{headers}),env)).status,404);
 const sendPath='/v1/admin/nexus/licenses/license-nexus-1234/resend-welcome';
 const send=await handleRequest(req(sendPath,{method:'POST',headers,body:'{}'}),env);
 assert.equal(send.status,200);assert.equal((await send.json()).delivery.status,'sent');
 assert.equal(sent,1);
 const repeat=await handleRequest(req(sendPath,{method:'POST',headers,body:'{}'}),env);
 assert.equal(repeat.status,429);
 assert.equal(sent,1);
 assert.equal(events.at(-1).eventType,'WELCOME_RESEND');
 assert.equal(events.at(-1).details.status,'sent');
});
