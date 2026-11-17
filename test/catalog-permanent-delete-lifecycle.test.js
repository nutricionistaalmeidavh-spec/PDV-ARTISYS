'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createCatalogService}=require('../js/domains/catalog/catalog-service');
function fixture(){
  const db=openDatabase(':memory:');
  runMigrations(db);
  let n=0;
  const catalog=createCatalogService({db,idFactory:p=>p+'-'+(++n),now:()=>new Date('2026-11-17T12:00:00Z').toISOString()});
  return {db,catalog,close:()=>db.close()};
}
test('produto novo sem dependencias pode ser excluido realmente, sem restar registro em products',()=>{
  const f=fixture();try{
    const p=f.catalog.upsertProduct({id:'unused',name:'Item criado errado',salePriceCents:100,trackStock:true});
    const preview=f.catalog.previewPermanentDeletion(p.id);
    assert.equal(preview.allowed,true);
    assert.equal(preview.stockQuantity,0);
    const result=f.catalog.deleteProductPermanently(p.id,{confirmationName:'Item criado errado'}, {kind:'human',userId:'admin'});
    assert.equal(result.deleted,true);
    assert.equal(f.catalog.getProduct(p.id),null);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS total FROM inventory_balances WHERE product_id=?').get(p.id).total,0);
    assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.ok(f.db.prepare("SELECT 1 FROM audit_log WHERE action='product.delete' AND entity_id=?").get(p.id));
  }finally{f.close();}
});
test('previsualizacao de produto ja excluido retorna 404 e nunca confunde com bloqueio de negocio',()=>{
  const f=fixture();try{
    const p=f.catalog.upsertProduct({id:'deleted-with-e2e',name:'Registro apagado',salePriceCents:150});
    f.catalog.deleteProductPermanently(p.id,{confirmationName:p.name});
    assert.throws(()=>f.catalog.previewPermanentDeletion(p.id),error=>error.statusCode===404);
  }finally{f.close();}
});

test('bloqueia exclusao permanente quando houver saldo de estoque',()=>{
  const f=fixture();try{
    const p=f.catalog.upsertProduct({id:'with-stock',name:'Com saldo',salePriceCents:300,trackStock:true});
    f.db.prepare('UPDATE inventory_balances SET quantity=2 WHERE product_id=?').run(p.id);
    assert.equal(f.catalog.previewPermanentDeletion(p.id).allowed,false);
    assert.throws(()=>f.catalog.deleteProductPermanently(p.id,{confirmationName:p.name}),/saldo|estoque/i);
    assert.ok(f.catalog.getProduct(p.id));
  }finally{f.close();}
});
test('nao apaga historico nem associacoes sem foreign key e reporta bloqueio antes de apagar',()=>{
  const f=fixture();try{
    const p=f.catalog.upsertProduct({id:'linked',name:'Item em uso',salePriceCents:200});
    f.db.exec('CREATE TABLE qa_product_usage (id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id))');
    f.db.prepare('INSERT INTO qa_product_usage(id,product_id) VALUES (?,?)').run('usage-1',p.id);
    const preview=f.catalog.previewPermanentDeletion(p.id);
    assert.equal(preview.allowed,false);
    assert.ok(preview.dependencies.some(item=>item.table==='qa_product_usage'));
    assert.throws(()=>f.catalog.deleteProductPermanently(p.id,{confirmationName:p.name}),/vinculad|referenc|histórico|associa/i);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM qa_product_usage').get().n,1);
    assert.ok(f.catalog.getProduct(p.id));
  }finally{f.close();}
});
test('confirmacao incorreta nao exclui, mesmo sem vinculos',()=>{
  const f=fixture();try{
    const p=f.catalog.upsertProduct({id:'unconfirmed',name:'Exclusao confirmada',salePriceCents:120});
    assert.throws(()=>f.catalog.deleteProductPermanently(p.id,{confirmationName:'Outro nome'}),/confirma|nome/i);
    assert.ok(f.catalog.getProduct(p.id));
  }finally{f.close();}
});
test('inativos continuam pesquisaveis e podem ser reativados sem publicar automaticamente',()=>{
  const f=fixture();try{
    const p=f.catalog.upsertProduct({id:'restore',name:'Produto inativado',salePriceCents:990,menuEnabled:true,usageType:'DIRECT'});
    f.catalog.removeProduct(p.id);
    assert.equal(f.catalog.listProducts().some(x=>x.id===p.id),false);
    assert.equal(f.catalog.listProducts({includeInactive:true}).some(x=>x.id===p.id),true);
    const restored=f.catalog.reactivateProduct(p.id,{kind:'human',userId:'admin'});
    assert.equal(restored.id,p.id);
    assert.equal(restored.active,true);
    assert.equal(restored.menuEnabled,false);
    assert.ok(f.catalog.listProducts().some(x=>x.id===p.id));
  }finally{f.close();}
});
test('fluxos de interface incluem excluir definitivo, reativar e atualizar tabela apos salvar',()=>{
  const fs=require('node:fs'), path=require('node:path'), read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
  const app=read('desktop/renderer/app.js');
  const inventory=read('desktop/renderer/operational-pages.js');
  const client=read('desktop/renderer/api-client.js');
  assert.match(inventory,/Produtos inativos/);
  assert.match(inventory,/data-inventory-delete-product/);
  assert.match(inventory,/data-inventory-reactivate-product/);
  assert.match(app,/deleteProductPermanently/);
  assert.match(app,/product:changed/);
  assert.match(client,/previewPermanentDeletion/);
  assert.match(client,/reactivateProduct/);
});
