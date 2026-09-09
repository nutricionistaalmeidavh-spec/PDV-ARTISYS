'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {SqliteOutboxStore}=require('../js/core/database/outbox-store');
const {SqliteEffectStore}=require('../js/core/database/effect-store');
const {DomainEventBus}=require('../js/core/domain-event-bus');
const {DomainEventDispatcher}=require('../js/core/domain-event-dispatcher');
const {validateConnection,validateSecretConnection,publicConnection,validateReference}=require('../js/domains/fiscal/fiscal-core');
const {createFocusFiscalProvider}=require('../js/domains/fiscal/focus-fiscal-provider');
const {createFiscalService}=require('../js/domains/fiscal/fiscal-service');
const {registerFiscalEffects}=require('../js/domains/fiscal/fiscal-effects');
const {createFiscalConnectionStore}=require('../desktop/fiscal-bridge.cjs');

test('fiscal core supports nfce/nfe and public metadata never exposes token',()=>{
  assert.deepEqual(validateConnection({provider:'focus',environment:'homologation',documentType:'nfce'}),{provider:'focus',environment:'homologation',documentType:'nfce'});
  const secret=validateSecretConnection({provider:'focus',environment:'production',documentType:'nfe',token:'secret-token-123'});
  const pub=publicConnection(secret);assert.deepEqual(pub,{configured:true,provider:'focus',environment:'production',documentType:'nfe'});assert.equal('token' in pub,false);
  assert.equal(validateReference('VENDA_001'),'VENDA_001');
  assert.throws(()=>validateConnection({provider:'focus',environment:'x',documentType:'nfce'}),/ambiente/i);
});

test('Focus provider uses correct environment/routes and keeps credential out of public status',async()=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{calls.push({url,options});return {ok:true,status:200,headers:{get:()=> 'application/json'},text:async()=>JSON.stringify({status:'autorizado',chave_nfe:'KEY123',numero:'10',serie:'1'})};};
  const provider=createFocusFiscalProvider({connection:{provider:'focus',environment:'homologation',documentType:'nfce',token:'focus-token-123'},fetchImpl});
  assert.equal((await provider.status()).configured,true);assert.equal(JSON.stringify(await provider.status()).includes('focus-token-123'),false);
  const issued=await provider.issue({documentType:'nfce',reference:'VENDA001',payload:{natureza_operacao:'Venda'}});
  assert.equal(issued.ok,true);assert.match(calls[0].url,/homologacao\.focusnfe\.com\.br\/v2\/nfce\?ref=VENDA001/);assert.equal(calls[0].options.method,'POST');
  assert.match(calls[0].options.headers.Authorization,/^Basic /);
  await provider.query('VENDA001','nfce');assert.match(calls[1].url,/\/v2\/nfce\/VENDA001$/);
  await provider.cancel('VENDA001','Cancelamento solicitado pelo cliente','nfce');assert.equal(calls[2].options.method,'DELETE');
});

function seedSale(db){
  db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run('u1','admin','Admin','admin','h','s',1,'2026-09-09','2026-09-09');
  db.prepare(`INSERT INTO sales (id,sale_number,terminal_id,operator_id,status,subtotal_cents,discount_cents,total_cents,change_cents,opened_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('s1','V001','T1','u1','COMPLETED',1000,0,1000,0,'2026-09-09','2026-09-09','2026-09-09');
}

test('fiscal request persists payload and issue effect is durable/idempotent with retry after failure',async()=>{
  const db=openDatabase(':memory:');runMigrations(db);seedSale(db);let n=0;
  const outbox=new SqliteOutboxStore(db);const effectStore=new SqliteEffectStore(db);const bus=new DomainEventBus();
  const service=createFiscalService({db,outbox,now:()=> '2026-09-09T12:00:00Z',idFactory:p=>`${p}-${++n}`});
  let calls=0;let fail=true;
  const resolver=async()=>({issue:async doc=>{calls++;return fail?{ok:false,status:503,error:'SEFAZ indisponivel'}:{ok:true,status:200,data:{status:'autorizado',chave_nfe:'KEY',numero:'1',serie:'1'}};}});
  registerFiscalEffects({bus,effectStore,fiscalService:service,providerResolver:resolver});
  const dispatcher=new DomainEventDispatcher({bus,outbox});
  const doc=service.requestIssue({saleId:'s1',provider:'focus',documentType:'nfce',environment:'homologation',reference:'V001',payload:{natureza_operacao:'Venda'},actor:{userId:'u1',role:'admin',terminalId:'T1'}});
  assert.equal(doc.status,'PENDING');assert.deepEqual(doc.requestPayload,{natureza_operacao:'Venda'});
  let result=await dispatcher.dispatchPending();assert.equal(result.failed,0);assert.equal(service.getDocument(doc.id).status,'FAILED');assert.equal(calls,1);
  fail=false;service.retryIssue(doc.id,{actor:{userId:'u1',role:'admin',terminalId:'T1'}});result=await dispatcher.dispatchPending();assert.equal(result.failed,0);
  const issued=service.getDocument(doc.id);assert.equal(issued.status,'ISSUED');assert.equal(issued.accessKey,'KEY');assert.equal(calls,2);
  await dispatcher.dispatchPending();assert.equal(calls,2);
  db.close();
});

test('fiscal secret store encrypts at rest and returns only public metadata',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-fiscal-'));
  const app={getPath:()=>dir};
  const safeStorage={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(`ENC:${[...text].reverse().join('')}`),decryptString:buffer=>[...buffer.toString().slice(4)].reverse().join('')};
  const store=createFiscalConnectionStore({app,safeStorage});
  const pub=store.saveSecret({provider:'focus',environment:'homologation',documentType:'nfce',token:'ultra-secret-token'});
  assert.equal(pub.configured,true);assert.equal('token' in pub,false);
  assert.equal(store.readSecret().token,'ultra-secret-token');
  const raw=fs.readFileSync(path.join(dir,'pdv-fiscal-connection.enc'),'utf8');assert.equal(raw.includes('ultra-secret-token'),false);
  store.removeSecret();assert.deepEqual(store.publicStatus(),{configured:false});
  fs.rmSync(dir,{recursive:true,force:true});
});
