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
  assert.match(binding,/search\?\.addEventListener\('input', \(\) => \{ state\.productQuery = search\.value; renderCheckoutProductGrid\(\); \}\);/);
  assert.doesNotMatch(binding,/search\?\.addEventListener\('input',[\s\S]*?renderCheckout\(\)/);
});

test('checkout QA simulates a fast EAN scanner and asserts digit order is preserved',()=>{
  const barcode='7891234567895';
  const flow=JSON.parse(read('qa/flows/checkout-ux-preservation.json'));
  const barcodeSetup=flow.steps.find(step=>step.selector==="#product-form input[name='barcode']");
  assert.equal(barcodeSetup?.action,'fill');
  assert.equal(barcodeSetup?.value,barcode);

  const scanIndex=flow.steps.findIndex(step=>step.name==='ux-scan-barcode-sequentially');
  assert.ok(scanIndex>=0,'missing simulated barcode scanner step');
  const scan=flow.steps[scanIndex];
  assert.equal(scan.action,'type');
  assert.equal(scan.selector,'#product-search');
  assert.equal(scan.value,barcode);
  assert.ok(Number(scan.delayMs)>=0);

  const assertion=flow.steps.slice(scanIndex+1).find(step=>step.name==='ux-scan-barcode-order-preserved');
  assert.equal(assertion?.action,'expectValue');
  assert.equal(assertion?.selector,'#product-search');
  assert.equal(assertion?.expected,barcode);

  const runtime=read('qa/runtime/src/steps.js');
  assert.match(runtime,/case 'type': await locator\(page, step\)\.pressSequentially\(resolveSecret\(step, env\), \{ delay: Number\(step\.delayMs \?\? 0\) \}\); break;/);
});
