'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {
  OFFLINE_UF_POLICIES,
  assertOfflineAllowed,
  assertOrdinarySeriesAllowed,
  offlineMonitoringInfo
}=require('../server/acbrlib/nfce-offline-uf-policy');

test('13 verified UFs use documented NFC-e offline tpEmis=9 with individual legal time rules',()=>{
 const states=['AC','AL','AM','DF','GO','MG','MT','PB','PE','PR','RN','RS','SP'];
 assert.deepEqual(Object.keys(OFFLINE_UF_POLICIES).sort(),states);
 for(const uf of states){
  const series=uf==='RN'?900:1;
  const policy=assertOfflineAllowed({uf,model:65,series});
  assert.equal(policy.uf,uf);
  assert.ok(['24h','next-business-day'].includes(policy.deadlineRule));
  assert.match(policy.sourceUrl,/^https:\/\/(www\.|portal\.|sped\.|atendimento\.|sefaz\.|legislacao\.|nfamazonense\.|www5\.|www\.sefaz\.|www\.receita\.)/);
  assert.ok(Object.isFrozen(policy));
 }
 assert.equal(OFFLINE_UF_POLICIES.PR.deadlineRule,'24h');
 assert.equal(OFFLINE_UF_POLICIES.PB.deadlineRule,'24h');
 assert.equal(OFFLINE_UF_POLICIES.MG.deadlineRule,'next-business-day');
 assert.equal(OFFLINE_UF_POLICIES.DF.deadlineRule,'next-business-day');
});

test('unverified UFs, NF-e 55 and invalid issuer state fail closed without defaulting to SP',()=>{
 for(const uf of ['ES','BA','SC','XX','',null]){
  assert.throws(()=>assertOfflineAllowed({uf,model:65,series:1}),/UF|homologa|valid|conting/i);
 }
 assert.throws(()=>assertOfflineAllowed({uf:'MG',model:55,series:1}),/65|NFC-e/i);
 assert.throws(()=>assertOfflineAllowed({uf:'MG',model:65,series:0}),/série|serie/i);
 assert.throws(()=>assertOfflineAllowed({uf:'MG',model:65,series:1000}),/série|serie/i);
});

test('Rio Grande do Norte uses exclusive offline series 890–989 from SEFAZ/RN',()=>{
 for(const series of [1,889,990,999]){
  assert.throws(()=>assertOfflineAllowed({uf:'RN',model:65,series}),/890|989|RN/i);
 }
 for(const series of [890,900,989]){
  assert.equal(assertOfflineAllowed({uf:'RN',model:65,series}).uf,'RN');
  assert.throws(()=>assertOrdinarySeriesAllowed({uf:'RN',model:65,series}),/RN|reservad|conting/i);
 }
 assert.doesNotThrow(()=>assertOrdinarySeriesAllowed({uf:'RN',model:65,series:1}));
 assert.doesNotThrow(()=>assertOrdinarySeriesAllowed({uf:'MG',model:65,series:900}));
});

test('24h is operational warning and must not be mislabeled as legal deadline for next-business-day states',()=>{
 const issued='2026-11-06T16:00:00-03:00'; // Friday
 const mg=offlineMonitoringInfo({uf:'MG',issuedAt:issued,now:'2026-11-07T18:00:00-03:00'});
 assert.equal(mg.deadlineRule,'next-business-day');
 assert.equal(mg.monitoringDueAt,'2026-11-07T19:00:00.000Z');
 assert.equal(mg.monitoringOverdue,true);
 assert.equal(mg.legalDeadlineAt,null);
 assert.match(mg.deadlineLabel,/dia útil/i);
 const pr=offlineMonitoringInfo({uf:'PR',issuedAt:issued,now:'2026-11-07T18:00:00-03:00'});
 assert.equal(pr.deadlineRule,'24h');
 assert.equal(pr.monitoringOverdue,true);
 assert.equal(pr.legalDeadlineAt,'2026-11-07T19:00:00.000Z');
 assert.throws(()=>offlineMonitoringInfo({uf:'SC',issuedAt:issued}),/UF|homologa/i);
});
