'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createFiscalDraftService}=require('../server/acbrlib/fiscal-draft-service');

const product='SKU-123';
const sale=()=>({
 id:'sale-1',saleNumber:'CX-1',status:'COMPLETED',customerId:null,
 subtotalCents:2000,discountCents:200,totalCents:1800,changeCents:200,
 completedAt:'2026-11-04T12:00:00.000Z',
 items:[{id:'line-1',productId:product,productName:'Café',sku:'CAFE',quantity:2,unitPriceCents:1000,totalCents:2000,allocatedDiscountCents:200,netTotalCents:1800}],
 payments:[{method:'CASH',amountCents:2000}]
});
function make(t,{getSale=()=>sale(),dbName=':memory:'}={}){
 const db=openDatabase(dbName);runMigrations(db);
 const service=createFiscalDraftService({db,sales:{getSaleDetails:getSale},now:()=> '2026-11-04T12:15:00.000Z'});
 t.after(()=>db.close());return{db,service};
}
function config(service){
 service.saveCompany({name:'Comércio Teste',cnpj:'12345678000195',uf:'SP',stateRegistration:'123456789',crt:'1',environment:'homologation',series:1});
 service.saveProductProfile({productId:product,ncm:'09012100',cfop:'5102',origin:'0',csosn:'102',pisCst:'49',cofinsCst:'49',unit:'UN',reviewedBy:'contador',reviewedAt:'2026-11-04'});
}
test('fiscal drafts never create tables until the optional module is explicitly constructed',t=>{
 const db=openDatabase(':memory:');t.after(()=>db.close());runMigrations(db);
 const before=db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'acbr_fiscal_%'").all();
 assert.equal(before.length,0);
 createFiscalDraftService({db,sales:{getSaleDetails:()=>sale()}});
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='acbr_fiscal_documents'").get());
});
test('company and product profiles are explicit and cannot infer taxes',t=>{
 const {service}=make(t);
 assert.throws(()=>service.saveCompany({cnpj:'123'}),/CNPJ|empresa/i);
 assert.throws(()=>service.saveProductProfile({productId:product,ncm:'00000000',cfop:'5102'}),/revis|tribut|origem|código|perfil/i);
 config(service);
 const company=service.getCompany();
 assert.equal(company.cnpj,'12345678000195');
 assert.equal(service.getProductProfile(product).ncm,'09012100');
 assert.equal(company.autoIssue,false);
});
test('preparing fiscal document uses immutable completed sale snapshot with exact discount and payments',t=>{
 const {db,service}=make(t);config(service);
 const original=db.prepare('SELECT COUNT(*) AS n FROM domain_events').get().n;
 const draft=service.prepareSale('sale-1');
 assert.equal(draft.status,'REVIEW_REQUIRED');
 assert.equal(draft.totalCents,1800);
 assert.equal(draft.snapshot.items[0].netTotalCents,1800);
 assert.equal(draft.snapshot.items[0].quantityMilli,2000);
 assert.equal(draft.snapshot.payments[0].amountCents,2000);
 assert.equal(draft.model,65);
 assert.equal(service.listDocuments().length,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM domain_events').get().n,original);
 assert.equal(service.prepareSale('sale-1').id,draft.id);
 assert.equal(service.prepareSale('sale-1').snapshotHash,draft.snapshotHash);
});
test('missing profile never consumes fiscal numbering',t=>{
 const {db,service}=make(t);
 service.saveCompany({name:'Loja',cnpj:'12345678000195',uf:'SP',stateRegistration:'123',crt:'1',environment:'homologation',series:1});
 assert.throws(()=>service.prepareSale('sale-1'),/perfil|tribut/i);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM acbr_fiscal_sequences').get().n,0);
});
test('a second service instance preserves document and sequence and rejects duplicated invoice',t=>{
 const {db,service}=make(t);config(service);
 const first=service.prepareSale('sale-1');
 const next=createFiscalDraftService({db,sales:{getSaleDetails:()=>sale()}});
 assert.equal(next.getDocument(first.id).snapshotHash,first.snapshotHash);
 assert.equal(next.prepareSale('sale-1').id,first.id);
 assert.equal(db.prepare('SELECT next_number FROM acbr_fiscal_sequences').get().next_number,2);
});
test('sale must be completed and values must reconcile before saving or reserving a number',t=>{
 let current=sale();const {db,service}=make(t,{getSale:()=>current});config(service);
 current={...current,status:'OPEN'};
 assert.throws(()=>service.prepareSale('sale-1'),/concluída/i);
 current={...sale(),totalCents:1999};
 assert.throws(()=>service.prepareSale('sale-1'),/total|centavos/i);
 current={...sale(),payments:[{method:'CASH',amountCents:1900}]};
 assert.throws(()=>service.prepareSale('sale-1'),/pagamento|troco/i);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM acbr_fiscal_sequences').get().n,0);
});
test('fiscal remains disabled for real transmissions even with a prepared document',t=>{
 const {service}=make(t);config(service);
 const draft=service.prepareSale('sale-1');
 assert.equal(service.getStatus().emissionEnabled,false);
 assert.equal(service.getStatus().provider,'acbrlib-local');
 assert.throws(()=>service.transmit(draft.id),/homolog|bloquead|desabilitad/i);
 assert.equal(service.getDocument(draft.id).status,'REVIEW_REQUIRED');
});

test('the same completed sale cannot reserve both NFC-e and NF-e for the same environment',t=>{
 const {db,service}=make(t);config(service);
 service.prepareSale('sale-1',{documentType:'nfce'});
 assert.throws(()=>service.prepareSale('sale-1',{documentType:'nfe'}),/já possui|outra nota|modelo|documento fiscal/i);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM acbr_fiscal_documents').get().n,1);
});
