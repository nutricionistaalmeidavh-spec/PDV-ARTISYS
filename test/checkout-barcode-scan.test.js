const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('checkout barcode input filters products without rebuilding the checkout input',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/function renderCheckoutProductGrid\(\)/);
  const binding=app.match(/function bindCheckoutEvents\(\) \{([\s\S]*?)\n  \}/)?.[1]||'';
  const inputHandler=binding.split('\n').find(line=>line.includes("search?.addEventListener('input'"))||'';
  assert.match(inputHandler,/state\.productQuery = event\.target\.value; renderCheckoutProductGrid\(\);/);
  assert.doesNotMatch(inputHandler,/renderCheckout\(\)/);
});

test('checkout QA simulates an EAN scanner key by key and asserts digit order is preserved',()=>{
  const barcode='7891234567895';
  const flow=JSON.parse(read('qa/flows/checkout-ux-preservation.json'));
  const barcodeSetup=flow.steps.find(step=>step.selector==="#product-form input[name='barcode']");
  assert.equal(barcodeSetup?.action,'fill');
  assert.equal(barcodeSetup?.value,barcode);

  const scannerSteps=flow.steps.filter(step=>/^ux-barcode-\d{2}$/.test(step.name||''));
  assert.equal(scannerSteps.length,barcode.length);
  assert.equal(scannerSteps.map(step=>step.key).join(''),barcode);
  assert.ok(scannerSteps.every(step=>step.action==='press'&&step.selector==='#product-search'));

  const assertion=flow.steps.find(step=>step.name==='ux-barcode-order-preserved');
  assert.equal(assertion?.action,'expectValue');
  assert.equal(assertion?.selector,'#product-search');
  assert.equal(assertion?.expected,barcode);

  const productMatch=flow.steps.find(step=>step.name==='ux-barcode-product-found');
  assert.equal(productMatch?.action,'expectText');
  assert.equal(productMatch?.selector,'.product-grid');
  assert.equal(productMatch?.expected,'QA UX Balcao');
});
