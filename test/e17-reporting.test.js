'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createReportingService}=require('../js/domains/reports/reporting-service');

function fixture(){
  const db=openDatabase(':memory:');runMigrations(db);
  db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run('u1','ana','Ana','cashier','h','s',1,'2026-09-01','2026-09-01');
  db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES ('c1','Bebidas',1,'2026-09-01','2026-09-01')").run();
  db.prepare("INSERT INTO customers (id,name,document,phone,email,notes,credit_limit_cents,credit_used_cents,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run('customer-1','Cliente QA',null,null,null,null,0,0,1,'2026-09-01','2026-09-01');
  const product=db.prepare(`INSERT INTO products (id,sku,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  product.run('p1','SKU1','Café','c1','UN',1000,600,1,2,1,'2026-09-01','2026-09-01');
  product.run('p2','SKU2','Água','c1','UN',500,200,1,3,1,'2026-09-01','2026-09-01');
  db.prepare("INSERT INTO inventory_balances (product_id,quantity,updated_at) VALUES ('p1',3,'2026-09-09')").run();
  db.prepare("INSERT INTO inventory_balances (product_id,quantity,updated_at) VALUES ('p2',1,'2026-09-09')").run();
  const sale=db.prepare(`INSERT INTO sales (id,sale_number,terminal_id,operator_id,customer_id,status,subtotal_cents,discount_cents,total_cents,change_cents,opened_at,completed_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  sale.run('s1','V-001','T1','u1','customer-1','COMPLETED',2000,0,2000,0,'2026-09-09T10:00:00Z','2026-09-09T10:05:00Z','2026-09-09T10:05:00Z');
  sale.run('s2','V-002','T1','u1',null,'COMPLETED',1000,100,900,0,'2026-09-09T11:00:00Z','2026-09-09T11:05:00Z','2026-09-09T11:05:00Z');
  const item=db.prepare(`INSERT INTO sale_items (id,sale_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  item.run('i1','s1','p1','Café','SKU1',2,1000,2000,'2026-09-09','2026-09-09');item.run('i2','s2','p1','Café','SKU1',1,1000,1000,'2026-09-09','2026-09-09');
  const pay=db.prepare("INSERT INTO payments (id,sale_id,method,amount_cents,created_at) VALUES (?,?,?,?,?)");pay.run('pa1','s1','CASH',2000,'2026-09-09');pay.run('pa2','s2','PIX',900,'2026-09-09');
  db.prepare(`INSERT INTO cash_sessions (id,terminal_id,operator_id,status,initial_cash_cents,expected_cash_cents,counted_cash_cents,divergence_cents,opened_at,closed_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run('cs1','T1','u1','CLOSED',0,2000,1900,-100,'2026-09-09T09:00:00Z','2026-09-09T18:00:00Z');
  db.prepare(`INSERT INTO financial_entries (id,kind,description,amount_cents,due_at,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run('f1','PAYABLE','Conta',5000,'2026-09-10','OPEN','2026-09-01','2026-09-01');
  return {db,reports:createReportingService({db,now:()=> '2026-09-10T12:00:00Z'})};
}

test('sales report aggregates complete customer-facing management data',()=>{
  const {db,reports}=fixture();
  const r=reports.buildSalesSummary({from:'2026-09-09T00:00:00Z',to:'2026-09-09T23:59:59Z'});
  assert.equal(r.salesCount,2);assert.equal(r.grossSalesCents,2900);assert.equal(r.averageTicketCents,1450);
  assert.equal(r.discountCents,100);
  assert.deepEqual(r.paymentsByMethod,{CASH:2000,PIX:900});
  assert.equal(r.topProducts[0].productId,'p1');assert.equal(r.topProducts[0].quantity,3);
  assert.equal(r.estimatedMarginCents,1100);
  assert.equal(r.operators[0].operatorName,'Ana');assert.equal(r.operators[0].salesCents,2900);
  assert.equal(r.customers.find(row=>row.customerId==='customer-1').customerName,'Cliente QA');
  assert.equal(r.customers.find(row=>row.customerId==='customer-1').salesCents,2000);
  assert.equal(r.customers.find(row=>row.customerId===null).customerName,'Consumidor não identificado');
  assert.equal(r.categories[0].categoryName,'Bebidas');
  assert.equal(r.categories[0].quantity,3);
  assert.equal(r.categories[0].grossCents,3000);
  assert.equal(r.sales.length,2);
  assert.deepEqual(r.sales.find(row=>row.saleNumber==='V-001').paymentMethods,['CASH']);
  assert.equal(r.sales.find(row=>row.saleNumber==='V-001').customerName,'Cliente QA');
  db.close();
});

test('inventory cash and finance summaries expose actionable management data',()=>{
  const {db,reports}=fixture();
  const inventory=reports.buildInventorySummary();
  assert.equal(inventory.skuCount,2);assert.equal(inventory.lowStockCount,1);assert.equal(inventory.costValueCents,2000);
  assert.equal(inventory.purchaseSuggestionCount,1);
  const water=inventory.items.find(item=>item.productId==='p2');
  assert.equal(water.lowStock,true);
  assert.equal(water.suggestedPurchaseQuantity,2);
  const cash=reports.buildCashSummary({from:'2026-09-09',to:'2026-09-10'});
  assert.equal(cash.closedSessions,1);assert.equal(cash.divergenceCents,-100);assert.equal(cash.divergentSessions,1);
  const finance=reports.buildFinanceSummary({asOf:'2026-09-10T12:00:00Z'});
  assert.equal(finance.payableOpenCents,5000);assert.equal(finance.overduePayableCents,5000);
  db.close();
});

test('sales CSV is semicolon separated and quotes text safely',()=>{
  const {db,reports}=fixture();
  const csv=reports.exportSalesCsv({from:'2026-09-09T00:00:00Z',to:'2026-09-09T23:59:59Z'});
  assert.match(csv,/venda;data;operador;status;total_centavos/);
  assert.match(csv,/V-001/);assert.match(csv,/2900|2000/);
  assert.equal(csv.includes('[object Object]'),false);
  db.close();
});
