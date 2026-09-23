'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const scaleUi = require('../desktop/renderer/scale-ui.js');

test('scale settings expose the supported checkout scale presets and required controls', () => {
  const presets = scaleUi.getScalePresets();
  assert.equal(presets.some(item => item.id === 'toledo-prix3-prt5' && item.models.includes('Prix 3 Fit')), true);
  assert.equal(presets.some(item => item.id === 'urano-pop' && item.models.includes('POP-Z')), true);
  assert.equal(presets.some(item => item.id === 'urano-udc' && item.models.includes('UDC CO-E')), true);
  assert.equal(presets.some(item => item.id === 'filizola-bp-cs' && item.models.includes('BP-S')), true);

  const html = scaleUi.renderScaleSettingsMarkup({ ports:[{path:'COM7',manufacturer:'USB Serial'}], configuration:{scale:{preset:'toledo-prix3-prt5',port:'COM7'}} });
  assert.match(html, /data-scale-preset/);
  assert.match(html, /data-scale-connection/);
  assert.match(html, /data-scale-port/);
  assert.match(html, /data-scale-detect-ports/);
  assert.match(html, /data-scale-test/);
  assert.match(html, /Toledo/);
  assert.match(html, /Prix 3 Fit/);
});

test('checkout scale status distinguishes connected, disconnected, unstable and error states', () => {
  assert.equal(scaleUi.classifyScaleState({ status:{available:true} }).kind, 'connected');
  assert.equal(scaleUi.classifyScaleState({ status:{available:false,reason:'not-configured'} }).kind, 'disconnected');
  assert.equal(scaleUi.classifyScaleState({ error:{code:'SCALE_WEIGHT_UNSTABLE',message:'Peso instavel.'} }).kind, 'unstable');
  assert.equal(scaleUi.classifyScaleState({ error:{message:'Falha serial'} }).kind, 'error');

  const html = scaleUi.renderScaleStatusMarkup({kind:'connected',label:'Balança conectada'});
  assert.match(html, /data-scale-status/);
  assert.match(html, /Balança conectada/);
});

test('weighted checkout calculates quantity and total from integer grams', () => {
  const kg = scaleUi.calculateWeightedSale({ id:'tomate', unit:'KG', salePriceCents:899 }, 742);
  assert.deepEqual(kg, {
    productId:'tomate',
    grams:742,
    quantity:0.742,
    unit:'KG',
    unitPriceCents:899,
    totalCents:667
  });
  assert.equal(scaleUi.weightedCartSummary(kg), '0,742 kg × R$ 8,99/kg');

  const grams = scaleUi.calculateWeightedSale({ id:'tempero', unit:'G', salePriceCents:5 }, 250);
  assert.equal(grams.quantity, 250);
  assert.equal(grams.totalCents, 1250);
  assert.equal(scaleUi.weightedCartSummary(grams), '250 g × R$ 0,05/g');
});

test('scale readings normalize to grams and manual input respects product unit', () => {
  assert.equal(scaleUi.readingToGrams({weight:0.742,unit:'kg'}), 742);
  assert.equal(scaleUi.readingToGrams({weight:742,unit:'g'}), 742);
  assert.equal(scaleUi.manualWeightToGrams('0,742', 'KG'), 742);
  assert.equal(scaleUi.manualWeightToGrams('742', 'G'), 742);
  assert.throws(() => scaleUi.manualWeightToGrams('0', 'KG'), /Peso manual inválido/i);
});

test('KG and G products open a weighing view with total, manual fallback and explicit confirmation', () => {
  assert.equal(scaleUi.isWeightedProduct({unit:'KG'}), true);
  assert.equal(scaleUi.isWeightedProduct({unit:'g'}), true);
  assert.equal(scaleUi.isWeightedProduct({unit:'UN'}), false);

  const preview = scaleUi.calculateWeightedSale({ id:'tomate', name:'Tomate', unit:'KG', salePriceCents:899 }, 742);
  const html = scaleUi.renderWeightedDialogMarkup(
    { id:'tomate', name:'Tomate', unit:'KG', salePriceCents:899 },
    { weight:0.742, unit:'kg' },
    {kind:'connected',label:'Balança conectada'},
    preview
  );
  assert.match(html, /data-scale-weigh-dialog/);
  assert.match(html, /Tomate/);
  assert.match(html, /0,742 kg/);
  assert.match(html, /R\$\s*6,67/);
  assert.match(html, /data-scale-total-value/);
  assert.match(html, /data-scale-manual-weight/);
  assert.match(html, /data-scale-manual-apply/);
  assert.match(html, /data-add-weighted-item/);
  assert.match(html, /data-scale-read-again/);
  assert.match(html, /data-scale-close/);
});
