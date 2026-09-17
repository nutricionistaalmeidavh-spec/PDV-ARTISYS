'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {resolveAcquiringPolicy}=require('../js/domains/finance/acquiring-policy');

const stamp='2026-09-17T12:00:00.000Z';

test('debit applies fee bps and settlement days',()=>{
  const [line]=resolveAcquiringPolicy({method:'DEBIT_CARD',amountCents:10000,completedAt:stamp,settings:{debitFeeBps:250,debitSettlementDays:2}});
  assert.deepEqual(line,{sourceSuffix:'1',grossAmountCents:10000,feeAmountCents:250,netAmountCents:9750,dueAt:'2026-09-19T12:00:00.000Z',installmentNumber:1,installmentCount:1});
});

test('credit 1x preserves gross fee and net',()=>{
  const [line]=resolveAcquiringPolicy({method:'CREDIT_CARD',amountCents:10000,completedAt:stamp,metadata:{installments:1},settings:{creditFeeBps:300,creditFirstSettlementDays:30,creditIntervalDays:30}});
  assert.equal(line.grossAmountCents,10000);
  assert.equal(line.feeAmountCents,300);
  assert.equal(line.netAmountCents,9700);
  assert.equal(line.dueAt,'2026-10-17T12:00:00.000Z');
});

test('credit 3x conserves gross fee and net after integer rounding',()=>{
  const lines=resolveAcquiringPolicy({method:'CREDIT_CARD',amountCents:10001,completedAt:stamp,metadata:{installments:3},settings:{creditFeeBps:299,creditFirstSettlementDays:30,creditIntervalDays:30}});
  assert.equal(lines.length,3);
  assert.equal(lines.reduce((sum,row)=>sum+row.grossAmountCents,0),10001);
  assert.equal(lines.reduce((sum,row)=>sum+row.feeAmountCents,0),Math.round(10001*299/10000));
  assert.equal(lines.reduce((sum,row)=>sum+row.netAmountCents,0),10001-Math.round(10001*299/10000));
  assert.deepEqual(lines.map(row=>row.installmentNumber),[1,2,3]);
  assert.ok(lines.every(row=>row.installmentCount===3));
});

test('credit due dates use first settlement plus interval days',()=>{
  const lines=resolveAcquiringPolicy({method:'CREDIT_CARD',amountCents:3000,completedAt:stamp,metadata:{installments:3},settings:{creditFeeBps:0,creditFirstSettlementDays:10,creditIntervalDays:15}});
  assert.deepEqual(lines.map(row=>row.dueAt),['2026-09-27T12:00:00.000Z','2026-10-12T12:00:00.000Z','2026-10-27T12:00:00.000Z']);
});

test('credit rejects installments outside 1..24',()=>{
  assert.throws(()=>resolveAcquiringPolicy({method:'CREDIT_CARD',amountCents:1000,completedAt:stamp,metadata:{installments:0}}),/parcela/i);
  assert.throws(()=>resolveAcquiringPolicy({method:'CREDIT_CARD',amountCents:1000,completedAt:stamp,metadata:{installments:25}}),/parcela/i);
});

test('default policy does not invent fee or delay',()=>{
  const debit=resolveAcquiringPolicy({method:'DEBIT_CARD',amountCents:5000,completedAt:stamp})[0];
  const credit=resolveAcquiringPolicy({method:'CREDIT_CARD',amountCents:5000,completedAt:stamp})[0];
  assert.equal(debit.feeAmountCents,0);
  assert.equal(debit.netAmountCents,5000);
  assert.equal(debit.dueAt,stamp);
  assert.equal(credit.feeAmountCents,0);
  assert.equal(credit.dueAt,stamp);
});

test('policy rejects a fee that consumes the whole receivable',()=>{
  assert.throws(()=>resolveAcquiringPolicy({method:'CREDIT_CARD',amountCents:1000,completedAt:stamp,settings:{creditFeeBps:10000}}),/taxa/i);
});
