'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {registerFiscalIpc}=require('../desktop/fiscal-bridge.cjs');

function fixture({trusted=true}={}){
  const handlers=new Map();
  const writes=[];
  const store={
    publicStatus:()=>({configured:true,provider:'acbr-local',environment:'homologation',documentType:'nfce'}),
    saveSecret:input=>{writes.push(input);return{configured:true,...input};},
    removeSecret:()=>({configured:false}),
    readSecret:()=>({provider:'acbr-local',environment:'homologation',documentType:'nfce',token:'stored-secret'})
  };
  const roles=new Map([['admin-token','admin'],['manager-token','manager'],['cashier-token','cashier']]);
  registerFiscalIpc({
    ipcMain:{handle:(channel,handler)=>handlers.set(channel,handler)},
    store,
    credentialStore:{publicStatus:()=>({configured:true}),save:()=>({configured:true})},
    isTrustedSender:()=>trusted,
    resolveSession:async token=>{const role=roles.get(String(token));if(!role)throw new Error('Sessao invalida.');return{user:{id:role,role}};},
    providerResolver:async()=>({testConnection:async()=>({reachable:true}),sefazStatus:async()=>({ok:true})}),
    dialog:{showOpenDialog:async()=>({canceled:true,filePaths:[]})}
  });
  const invoke=(channel,input={})=>handlers.get(channel)({sender:{}},input);
  return{invoke,writes};
}

test('fiscal IPC fails closed without an authenticated session or trusted sender',async()=>{
  const ctx=fixture();
  await assert.rejects(ctx.invoke('artisys:fiscal:status'),/Sessao autenticada/i);
  const untrusted=fixture({trusted:false});
  await assert.rejects(untrusted.invoke('artisys:fiscal:status',{sessionToken:'admin-token'}),/Origem IPC nao autorizada/i);
});

test('manager can inspect and test fiscal status but cannot mutate fiscal secrets',async()=>{
  const ctx=fixture();
  assert.equal((await ctx.invoke('artisys:fiscal:status',{sessionToken:'manager-token'})).configured,true);
  assert.equal((await ctx.invoke('artisys:fiscal:test',{sessionToken:'manager-token'})).reachable,true);
  assert.equal((await ctx.invoke('artisys:fiscal:sefaz-status',{sessionToken:'manager-token'})).ok,true);
  for(const [channel,input] of [
    ['artisys:fiscal:save',{sessionToken:'manager-token',connection:{provider:'focus',environment:'homologation',documentType:'nfce',token:'x'}}],
    ['artisys:fiscal:remove',{sessionToken:'manager-token'}],
    ['artisys:fiscal:certificate-import',{sessionToken:'manager-token'}],
    ['artisys:fiscal:set-environment',{sessionToken:'manager-token',environment:'homologation'}]
  ]) await assert.rejects(ctx.invoke(channel,input),/Permissao insuficiente/i);
});

test('admin can mutate fiscal connection and renderer session token is never persisted as a fiscal secret',async()=>{
  const ctx=fixture();
  const connection={provider:'focus',environment:'homologation',documentType:'nfce',token:'focus-secret'};
  await ctx.invoke('artisys:fiscal:save',{sessionToken:'admin-token',connection});
  assert.deepEqual(ctx.writes[0],connection);
  assert.equal(Object.hasOwn(ctx.writes[0],'sessionToken'),false);
  assert.deepEqual(await ctx.invoke('artisys:fiscal:remove',{sessionToken:'admin-token'}),{configured:false});
});

test('cashier cannot read fiscal desktop configuration',async()=>{
  const ctx=fixture();
  await assert.rejects(ctx.invoke('artisys:fiscal:status',{sessionToken:'cashier-token'}),/Permissao insuficiente/i);
  await assert.rejects(ctx.invoke('artisys:fiscal:test',{sessionToken:'cashier-token'}),/Permissao insuficiente/i);
});

test('preload and settings renderers forward the authenticated session token to fiscal IPC',()=>{
  const root=path.join(__dirname,'..');
  const preload=fs.readFileSync(path.join(root,'desktop','preload.cjs'),'utf8');
  const settings=fs.readFileSync(path.join(root,'desktop','renderer','operational-pages.js'),'utf8');
  const monitor=fs.readFileSync(path.join(root,'desktop','renderer','fiscal-monitor.js'),'utf8');
  assert.match(preload,/status:\s*\(sessionToken\).*sessionToken/);
  assert.match(preload,/save:\s*\(connection, sessionToken\)/);
  assert.match(settings,/fiscal\.status\(api\.sessionToken\)/);
  assert.match(settings,/fiscal\.save\([^\n]+api\.sessionToken\)/);
  assert.match(monitor,/certificateStatus\?\.\(api\.sessionToken\)/);
  assert.match(monitor,/setEnvironment\?\.\('production',api\.sessionToken\)/);
  assert.match(monitor,/dataset\.userRole\|\|''\)===\s*'admin'/);
});
