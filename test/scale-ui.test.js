'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const scaleUi = require('../desktop/renderer/scale-ui.js');

test('scale presets expose current POP-S plus PR40 protocol profiles', () => {
  const presets = scaleUi.getScalePresets();
  assert.equal(presets.some(item => item.id === 'urano-pop-s' && item.serial === '9600 / 8N2'), true);
  assert.equal(presets.some(item => item.id === 'toledo-prix3-prt5' && item.models.includes('Prix 3 Fit')), true);
  assert.equal(presets.some(item => item.id === 'urano-udc' && item.models.includes('UDC CO-E')), true);
  assert.equal(presets.some(item => item.id === 'filizola-bp-cs' && item.models.includes('BP-S')), true);
});

test('checkout scale status distinguishes connected, disconnected, unstable and error states', () => {
  assert.equal(scaleUi.classifyScaleState({ status:{available:true} }).kind, 'connected');
  assert.equal(scaleUi.classifyScaleState({ status:{available:false,reason:'not-configured'} }).kind, 'disconnected');
  assert.equal(scaleUi.classifyScaleState({ error:{code:'SCALE_WEIGHT_UNSTABLE',message:'Peso instavel.'} }).kind, 'unstable');
  assert.equal(scaleUi.classifyScaleState({ error:{message:'Falha serial'} }).kind, 'error');
  assert.match(scaleUi.renderScaleStatusMarkup({kind:'connected',label:'Balança conectada'}), /data-scale-status/);
});

test('weighted checkout calculates quantity and total from integer grams', () => {
  const kg = scaleUi.calculateWeightedSale({ id:'tomate', unit:'KG', salePriceCents:899 }, 742);
  assert.deepEqual(kg, { productId:'tomate', grams:742, quantity:0.742, unit:'KG', unitPriceCents:899, totalCents:667 });
  assert.equal(scaleUi.weightedCartSummary(kg), '0,742 kg × R$ 8,99/kg');
  const grams = scaleUi.calculateWeightedSale({ id:'tempero', unit:'G', salePriceCents:5 }, 250);
  assert.equal(grams.quantity, 250);
  assert.equal(grams.totalCents, 1250);
  assert.equal(scaleUi.weightedCartSummary(grams), '250 g × R$ 0,05/g');
});

test('scale readings normalize to grams and invalid/zero manual input is rejected', () => {
  assert.equal(scaleUi.readingToGrams({weight:0.742,unit:'kg'}), 742);
  assert.equal(scaleUi.readingToGrams({weight:742,unit:'g'}), 742);
  assert.equal(scaleUi.manualWeightToGrams('0,742', 'KG'), 742);
  assert.equal(scaleUi.manualWeightToGrams('742', 'G'), 742);
  assert.throws(() => scaleUi.manualWeightToGrams('0', 'KG'), /Peso manual inválido/i);
  assert.throws(() => scaleUi.readingToGrams({weight:-1,unit:'kg'}), /Leitura de peso inválida/i);
});

test('KG and G products render explicit weighing confirmation and manual fallback', () => {
  assert.equal(scaleUi.isWeightedProduct({unit:'KG'}), true);
  assert.equal(scaleUi.isWeightedProduct({unit:'g'}), true);
  assert.equal(scaleUi.isWeightedProduct({unit:'UN'}), false);
  const preview = scaleUi.calculateWeightedSale({ id:'tomate', name:'Tomate', unit:'KG', salePriceCents:899 }, 742);
  const html = scaleUi.renderWeightedDialogMarkup({ id:'tomate', name:'Tomate', unit:'KG', salePriceCents:899 }, { weight:0.742, unit:'kg' }, {kind:'connected',label:'Balança conectada'}, preview);
  assert.match(html, /data-scale-weigh-dialog/);
  assert.match(html, /0,742 kg/);
  assert.match(html, /R\$\s*6,67/);
  assert.match(html, /data-scale-manual-weight/);
  assert.match(html, /data-add-weighted-item/);
  assert.match(html, /data-scale-read-again/);
});
