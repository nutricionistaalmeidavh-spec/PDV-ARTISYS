'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../desktop/renderer/ui-model');
const {renderSaleReceipt}=require('../js/domains/printing/receipt-renderer');
const {createElectronPrinterDriver}=require('../vendor/artisys-printing/src/drivers/electron-printer');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runReleaseMigrations}=require('../js/core/database/release-migrations');
const {runVerticalMigrations}=require('../js/core/database/vertical-migrations');
const {SqliteOutboxStore}=require('../js/core/database/outbox-store');
const {createCatalogService}=require('../js/domains/catalog/catalog-service');
const {createInventoryService}=require('../js/domains/inventory/inventory-service');
const {createSaleService}=require('../js/domains/sales/sale-service');

const root=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');

test('cash checkout exposes received amount and computes live change without forcing exact payment',()=>{
  assert.equal(typeof ui.calculateCashChange,'function');
  assert.deepEqual(ui.calculateCashChange(199,1000),{receivedCents:1000,remainingCents:0,changeCents:801,sufficient:true});
  assert.deepEqual(ui.calculateCashChange(199,100),{receivedCents:100,remainingCents:99,changeCents:0,sufficient:false});
  const app=read('desktop/renderer/app.js');
  assert.match(app,/id=\"cash-received-value\"/);
  assert.match(app,/id=\"cash-change-value\"/);
  assert.match(app,/Valor recebido/);
  assert.doesNotMatch(app,/state\.paymentDraft\s*=\s*\[\{\s*method,\s*amountCents:\s*state\.sale\.totalCents\s*\}\]/);
});

test('receipt prints friendly cash label, amount received and change',()=>{
  const text=renderSaleReceipt({
    storeName:'B1 Limpe',
    sale:{
      id:'s1',saleNumber:'V-1',status:'COMPLETED',operatorName:'Administrador',sellerName:'Administrador',customerName:'Cliente Teste',
      subtotalCents:199,totalCents:199,discountCents:0,changeCents:801,completedAt:'2026-09-24T13:00:00Z',
      items:[{productName:'Prendedor',quantity:1,unitPriceCents:199,totalCents:199}],
      payments:[{method:'CASH',amountCents:1000}]
    },
    width:48
  });
  assert.match(text,/Operador: Administrador/);
  assert.match(text,/Cliente: Cliente Teste/);
  assert.match(text,/Dinheiro recebido\s+10,00/);
  assert.match(text,/Troco\s+8,01/);
  assert.doesNotMatch(text,/\bCASH\b/);
});

test('sale details expose readable operator and customer names for receipt snapshots',()=>{
  const db=openDatabase(':memory:');runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);let seq=0;const ids=p=>`${p}-${++seq}`;
  const catalog=createCatalogService({db,now:()=> '2026-09-24T13:00:00Z',idFactory:ids});
  catalog.createUser({id:'u1',username:'admin',name:'Administrador',role:'admin',password:'senha-forte-123'});
  catalog.upsertCustomer({id:'c1',name:'Cliente Teste',creditLimitCents:0,creditUsedCents:0});
  catalog.upsertProduct({id:'p1',sku:'1',name:'Prendedor',salePriceCents:199,minimumStock:0});
  const inventory=createInventoryService({db,now:()=> '2026-09-24T13:00:00Z',idFactory:ids});
  inventory.move({productId:'p1',type:'opening',quantityDelta:5});
  const sales=createSaleService({db,outbox:new SqliteOutboxStore(db),now:()=> '2026-09-24T13:00:00Z',idFactory:ids});
  sales.openSale({id:'s1',saleNumber:'V-1',terminalId:'PDV-01',operatorId:'u1',customerId:'c1'});
  sales.addItem('s1',{productId:'p1',quantity:1});
  const details=sales.getSaleDetails('s1');
  assert.equal(details.operatorName,'Administrador');
  assert.equal(details.customerName,'Cliente Teste');
  db.close();
});

test('electron POS80 receipt centers the printable sheet inside the physical 80 mm page',async()=>{
  let loaded='';let options=null;
  class FakeWindow{
    constructor(){this.webContents={executeJavaScript:async()=>600,print:(value,cb)=>{options=value;cb(true,'');}};}
    async loadURL(url){loaded=decodeURIComponent(url.slice(url.indexOf(',')+1));}
    isDestroyed(){return false;}
    close(){}
  }
  const driver=createElectronPrinterDriver({BrowserWindow:FakeWindow});
  const result=await driver.print({text:'CUPOM\n',paperMm:80,width:48},{mode:'electron',width:48,deviceName:'POS80 Printer'});
  assert.equal(result.success,true);
  assert.equal(options.pageSize.width,80000);
  assert.match(loaded,/class=\"receipt-sheet\"/);
  assert.match(loaded,/justify-content:center/);
  assert.match(loaded,/width:100%/);
});

test('printing settings recognize POS80 and SMX-T80E as 80 mm devices',()=>{
  const source=read('desktop/renderer/post-sale-receipt-ui.js');
  assert.match(source,/suggestPaperForPrinter/);
  assert.match(source,/POS80/i);
  assert.match(source,/SMX-T80E/i);
  assert.match(source,/paper\.value\s*=\s*'80'/);
});
