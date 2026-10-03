'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');

test('V1 desktop does not register or expose fiscal IPC',()=>{
  const main=fs.readFileSync(path.join(root,'desktop','main.cjs'),'utf8');
  const preload=fs.readFileSync(path.join(root,'desktop','preload.cjs'),'utf8');
  assert.doesNotMatch(main,/registerFiscalIpc|artisys:fiscal|fiscal-bridge|fiscal-sidecar/);
  assert.doesNotMatch(preload,/artisys:fiscal|\bfiscal:\s*\{/);
});
