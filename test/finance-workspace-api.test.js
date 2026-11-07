'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-workspace-'));let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:prefix=>prefix+'-'+(++seq)});
  runtime.catalog.createUser({id:'manager-workspace',username:'gestor-fin',name:'Gestor',profileId:'profile-manager',password:'gestor-fin-123'});
  runtime.catalog.createUser({id:'cashier-workspace',username:'caixa-fin',name:'Caixa',profileId:'profile-cashier',password:'caixa-fin-123'});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'local-fixture-token'});
  const address=await server.start();
  const base='http://'+address.host+':'+address.port;
  async function login(username,password){
    const res=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'local-fixture-token'},body:JSON.stringify({username,password,terminalId:'PDV-01'})});
    assert.equal(res.status,200);
    return (await res.json()).sessionToken;
  }
  async function api(token,route,{method='GET',body}={}){
    const headers={authorization:'Bearer '+token};
    if(body!==undefined)headers['content-type']='application/json';
    return fetch(base+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  }
  return{runtime,login,api,async close(){await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}};
}
test('Kanban HTTP aplica confirmacao, RBAC por perfil e transacao de baixa idempotente',async()=>{
  const ctx=await fixture();try{
    const manager=await ctx.login('gestor-fin','gestor-fin-123'),cashier=await ctx.login('caixa-fin','caixa-fin-123');
    const account=ctx.runtime.finance.createAccount({name:'Banco teste',type:'BANK'});
    const entry=ctx.runtime.finance.createEntry({kind:'PAYABLE',description:'Fornecedor teste',amountCents:9850,dueAt:'2026-11-25',accountId:account.id});
    const cards=await ctx.api(manager,'/api/v1/erp-finance/workspace/cards');
    assert.equal(cards.status,200);
    assert.ok((await cards.json()).find(c=>c.entryId===entry.id));
    assert.equal((await ctx.api(cashier,'/api/v1/erp-finance/workspace/cards')).status,403);
    const route='/api/v1/erp-finance/workspace/cards/'+encodeURIComponent('entry:'+entry.id)+'/move';
    const body={stage:'DONE',confirmed:true,method:'PIX',accountId:account.id,idempotencyKey:'api-kanban-001'};
    assert.equal((await ctx.api(manager,route,{method:'POST',body:{...body,confirmed:false}})).status,400);
    ctx.runtime.db.prepare("DELETE FROM profile_permissions WHERE profile_id='profile-manager' AND permission_id='finance.settle'").run();
    assert.equal((await ctx.api(manager,route,{method:'POST',body})).status,403);
    assert.equal((await ctx.api(manager,'/api/v1/finance/entries/'+entry.id+'/settle',{method:'POST',body:{amountCents:9850}})).status,403);
    assert.equal(ctx.runtime.finance.getEntry(entry.id).status,'OPEN');
    ctx.runtime.db.prepare("INSERT INTO profile_permissions(profile_id,permission_id,created_at) VALUES ('profile-manager','finance.settle',?)").run(new Date().toISOString());
    const response=await ctx.api(manager,route,{method:'POST',body});
    assert.equal(response.status,200);
    assert.equal((await response.json()).stage,'DONE');
    assert.equal((await ctx.api(manager,route,{method:'POST',body})).status,200);
    assert.equal(ctx.runtime.finance.getEntry(entry.id).settlements.length,1);
    assert.equal((await ctx.api(manager,'/api/v1/erp-finance/workspace/bi?from=2026-11-01&to=2026-11-30')).status,200);
    assert.equal((await ctx.api(manager,'/api/v1/erp-finance/workspace/cards',{method:'POST',body:{title:'Cobrar comprovante'}})).status,201);
  }finally{await ctx.close();}
});
test('Planilha HTTP atualiza somente manual e importacao ruim nao grava nenhuma linha',async()=>{
  const ctx=await fixture();try{
    const manager=await ctx.login('gestor-fin','gestor-fin-123');
    const entry=ctx.runtime.finance.createEntry({kind:'RECEIVABLE',description:'Cliente',amountCents:5000,dueAt:'2026-11-15'});
    const endpoint='/api/v1/erp-finance/workspace/entries/'+entry.id;
    const patch=await ctx.api(manager,endpoint,{method:'PATCH',body:{amountCents:5500,description:'Cliente revisado'}});
    assert.equal(patch.status,200);assert.equal((await patch.json()).amountCents,5500);
    const count=ctx.runtime.finance.listEntries().length;
    const result=await ctx.api(manager,'/api/v1/erp-finance/workspace/import',{method:'POST',body:{idempotencyKey:'bad',rows:[
      {kind:'PAYABLE',description:'Validada',amountCents:200,dueAt:'2026-11-17'},
      {kind:'PAYABLE',description:'Invalida',amountCents:-10,dueAt:'2026-11-17'}
    ]}});
    assert.equal(result.status,400);
    assert.equal(ctx.runtime.finance.listEntries().length,count);
  }finally{await ctx.close();}
});
