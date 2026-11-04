'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
test('QA dynamic month start handles month/year rollovers without fixed dates',async()=>{
 const {monthStartPtBr}=await import('../qa/runtime/src/date-assertions.js');
 assert.equal(monthStartPtBr(new Date('2026-10-28T10:00:00Z')),'01/10/2026');
 assert.equal(monthStartPtBr(new Date('2026-11-04T10:00:00Z')),'01/11/2026');
 assert.equal(monthStartPtBr(new Date('2027-01-04T10:00:00Z')),'01/01/2027');
});
