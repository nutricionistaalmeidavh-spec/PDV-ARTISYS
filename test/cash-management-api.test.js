'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

test('API de gestao de caixa exige perfil admin, publica historico e preserva caixa anulado',async()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'test-install'});
  try{
    const {host,port}=await server.start();
    const base=`http://${host}:${port}`;
    const post=async(route,body,token=null,extra={})=>fetch(base+route,{
      method:'POST',
      headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{'x-pdv-token':'test-install'}),...extra},
      body:JSON.stringify(body)
    });
    const setup=await post('/api/v1/setup/admin',{username:'admin',name:'Administrador',password:'senha-forte-123'});
    assert.equal(setup.status,201);
    const adminLogin=await post('/api/v1/auth/login',{username:'admin',password:'senha-forte-123',terminalId:'PDV-01'});
    assert.equal(adminLogin.status,200);
    const adminToken=(await adminLogin.json()).sessionToken;
    const headers=token=>({authorization:`Bearer ${token}`});
    const user=runtime.catalog.createUser({username:'operador-caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});
    const cashierLogin=await post('/api/v1/auth/login',{username:'operador-caixa',password:'senha-forte-123',terminalId:'PDV-01'});
    assert.equal(cashierLogin.status,200);
    const cashierToken=(await cashierLogin.json()).sessionToken;
    const opening=await post('/api/v1/cash/sessions',{terminalId:'PDV-01',initialCashCents:0},cashierToken);
    assert.equal(opening.status,201);
    const session=(await opening.json()).session;
    const closing=await post(`/api/v1/cash/sessions/${session.id}/close`,{countedByMethod:{CASH:0}},adminToken);
    assert.equal(closing.status,200);
    const detailResponse=await fetch(base+`/api/v1/cash/sessions/${session.id}`,{headers:headers(cashierToken)});
    assert.equal(detailResponse.status,200);
    const detail=await detailResponse.json();
    assert.equal(detail.openedByName,'Caixa');
    assert.equal(detail.closedByName,'Administrador');
    const unauthorized=await post(`/api/v1/cash/sessions/${session.id}/annul`,{reason:'Este caixa era apenas um teste'},cashierToken);
    assert.equal(unauthorized.status,403);
    const authorized=await post(`/api/v1/cash/sessions/${session.id}/annul`,{reason:'Este caixa era apenas um teste'},adminToken);
    assert.equal(authorized.status,200);
    assert.equal((await authorized.json()).status,'ANNULLED');
    const after=await fetch(base+'/api/v1/cash/sessions?status=ANNULLED',{headers:headers(adminToken)});
    assert.equal(after.status,200);
    assert.equal((await after.json()).length,1);
    const audit=runtime.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity='cash-session' AND entity_id=? AND action='cash.annul'").get(session.id);
    assert.equal(audit.n,1);
  }finally{
    await server.stop();
    runtime.close();
  }
});
