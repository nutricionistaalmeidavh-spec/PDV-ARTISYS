'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
test('P3 Nexus dashboard counts unique 3-day trials, conversions, failed mails and near-expiry',async()=>{
 const {summarizeNexusLicenses,daysUntil}=await import('../cloudflare/account/src/nexus-dashboard.mjs');
 const now='2026-11-21T15:00:00.000Z';
 const data=[
 {id:'1',product:'PDV_NEXUS_2',status:'ACTIVE',created_at:'2026-11-19T12:00:00.000Z',expires_at:'2026-11-22T12:00:00.000Z',metadata_json:'{"kind":"TRIAL","source":"AUTO_SIGNUP"}',welcome_status:'sent'},
 {id:'2',product:'PDV_NEXUS_2',status:'ACTIVE',created_at:'2026-11-16T12:00:00.000Z',expires_at:'2026-11-19T12:00:00.000Z',metadata_json:'{"kind":"TRIAL","source":"AUTO_SIGNUP"}',welcome_status:'failed'},
 {id:'3',product:'PDV_NEXUS_2',status:'ACTIVE',created_at:'2026-11-15T10:00:00.000Z',expires_at:null,metadata_json:'{"kind":"COMMERCIAL","source":"ADMIN_CONVERSION"}',welcome_status:'sent'},
 {id:'4',product:'PDV_NEXUS_2',status:'ACTIVE',created_at:'2026-11-21T12:00:00.000Z',expires_at:'2026-11-24T12:00:00.000Z',metadata_json:'{"kind":"TRIAL","source":"AUTO_SIGNUP"}',welcome_status:'pending'},
 {id:'5',product:'PDV',status:'ACTIVE',created_at:'2026-11-21T12:00:00.000Z',expires_at:null,metadata_json:'{}'},
 {id:'6',product:'PDV_NEXUS_2',status:'ACTIVE',created_at:'2026-11-21T11:00:00.000Z',expires_at:null,metadata_json:'{"source":"admin-panel"}',welcome_status:null},
 {id:'7',product:'PDV_NEXUS_2',status:'CANCELLED',created_at:'2026-11-21T11:00:00.000Z',expires_at:'2026-11-23T15:00:00.000Z',metadata_json:'{"kind":"TRIAL"}'}
 ];
 const out=summarizeNexusLicenses(data,now);
 assert.equal(out.totalTrials,5);
 assert.equal(out.activeTrials,2);
 assert.equal(out.expiring24h,1);
 assert.equal(out.expiredTrials,1);
 assert.equal(out.converted,1);
 assert.equal(out.conversionRatePct,20);
 assert.equal(out.failedWelcomeEmails,1);
 assert.equal(out.manualCommercial,1);
 assert.equal(out.suspendedOrCancelled,1);
 assert.equal(daysUntil('2026-11-22T12:00:00.000Z',now),1);
});
test('P3 dashboard handles empty/corrupt metadata without false conversions or leakage',async()=>{
 const {summarizeNexusLicenses,daysUntil}=await import('../cloudflare/account/src/nexus-dashboard.mjs');
 const out=summarizeNexusLicenses([{id:'a',product:'PDV_NEXUS_2',status:'ACTIVE',metadata_json:'{corrupt',created_at:'not-a-date',expires_at:null}], '2026-11-21T00:00:00.000Z');
 assert.equal(out.totalTrials,0);
 assert.equal(out.converted,0);
 assert.equal(out.conversionRatePct,0);
 assert.equal(out.manualCommercial,1);
 assert.equal(daysUntil('not-valid','2026-11-21T00:00:00Z'),null);
 assert.equal(JSON.stringify(out).includes('email'),false);
});
