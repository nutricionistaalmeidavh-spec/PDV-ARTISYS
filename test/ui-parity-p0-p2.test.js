'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const root=path.resolve(__dirname,'..');
const rendererPath=path.join(root,'desktop','renderer','ui-parity-p0-p2.js');

function source(file){return fs.readFileSync(path.join(root,file),'utf8');}

test('P0-P2 parity renderer is loaded and parses',()=>{
  assert.ok(fs.existsSync(rendererPath),'desktop/renderer/ui-parity-p0-p2.js must exist');
  const parsed=spawnSync(process.execPath,['--check',rendererPath],{encoding:'utf8'});
  assert.equal(parsed.status,0,`${parsed.stdout||''}\n${parsed.stderr||''}`);
  assert.match(source('desktop/renderer/index.html'),/ui-parity-p0-p2\.js/);
});

test('P0 exposes partial purchase receiving and partial sales-order fulfillment',()=>{
  const ui=source('desktop/renderer/ui-parity-p0-p2.js');
  for(const marker of [
    'p0-partial-receipt-panel','data-partial-receive','data-receive-qty','purchaseReceipts',
    'p0-partial-fulfillment-panel','data-partial-fulfill','data-fulfill-qty','fulfillSalesOrder'
  ]) assert.ok(ui.includes(marker),`P0 UI marker missing: ${marker}`);
  assert.match(ui,/quantity\s*>\s*0/);
  assert.match(ui,/pendingQuantity/);
});

test('P1 exposes failed print retry, terminal administration and purchase receipt history',()=>{
  const ui=source('desktop/renderer/ui-parity-p0-p2.js');
  for(const marker of [
    'p1-print-retry-panel','retryPrint','status:\'FAILED\'',
    'p1-terminal-admin-panel','/api/v1/lan/pairing-codes','/api/v1/terminals',
    'p1-purchase-receipts-panel','purchaseReceipts'
  ]) assert.ok(ui.includes(marker),`P1 UI marker missing: ${marker}`);
});

test('P2 exposes return details and import batch lookup',()=>{
  const ui=source('desktop/renderer/ui-parity-p0-p2.js');
  for(const marker of [
    'p2-return-details-panel','returnDetails','data-return-details',
    'p2-import-batch-panel','importBatch','ops-import-batch-lookup'
  ]) assert.ok(ui.includes(marker),`P2 UI marker missing: ${marker}`);
});

test('P0-P2 parity operations are registered with UI and E2E evidence',()=>{
  const registry=JSON.parse(source('release/customer-operations.json'));
  const ids=new Set(registry.operations.map(item=>item.id));
  for(const id of [
    'procurement.partial-receive','orders.partial-fulfill','printing.failed.retry',
    'lan.pairing-code.create','lan.terminal.status.update','procurement.receipt.list',
    'returns.details.get','imports.batch.get'
  ]) assert.ok(ids.has(id),`operation missing from parity registry: ${id}`);
  const flow=source('qa/flows/ui-parity-p0-p2.json');
  for(const marker of ['p0-partial-receipt-panel','p0-partial-fulfillment-panel','p1-print-retry-panel','p1-terminal-admin-panel','p2-return-details-panel','p2-import-batch-panel'])assert.ok(flow.includes(marker),`E2E marker missing: ${marker}`);
});
