'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvHardwareRuntime } = require('../desktop/hardware-runtime.cjs');

function fakeModules() {
  return {
    serial: {
      createSerialPortManager(){ return { list:async()=>[] }; },
      createSerialTransport(){ throw new Error('serial transport must not be created for QA scale simulator'); },
      createRequestResponseSession(){ throw new Error('request session must not be created for QA scale simulator'); },
      createScaleAdapter(){ throw new Error('scale adapter must not be created for QA scale simulator'); },
      createDrawerAdapter(){ throw new Error('drawer adapter not expected'); },
      parseNumericWeight(value){ return Number(value); }
    },
    printing: {
      normalizePrinterProfile(profile){ return profile; },
      createElectronPrinterDriver(){ return { status:async()=>({available:true,mode:'electron'}), print:async()=>({success:true,driver:'electron'}) }; },
      createThermalPrinterDriver(){ return { status:async()=>({available:true,mode:'thermal'}), print:async()=>({success:true,driver:'thermal'}) }; },
      createTransportPrinterDriver(){ return { status:async()=>({available:true,mode:'transport'}), print:async()=>({success:true,driver:'transport'}) }; }
    }
  };
}

test('QA scale simulator exposes a stable 0.742 kg reading without serial hardware', async () => {
  const runtime = createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ ARTISYS_QA:'1', PDV_QA_SCALE_WEIGHT_KG:'0.742' },
    modules:fakeModules()
  });

  const status = await runtime.status();
  assert.equal(status.scale.available, true);
  assert.equal(status.scale.mode, 'qa-simulator');
  assert.deepEqual(await runtime.readWeight(), { weight:0.742, unit:'kg' });

  const diagnostics = await runtime.diagnostics();
  assert.equal(diagnostics.configuration.scale.simulated, true);
  assert.equal(diagnostics.configuration.scale.weightKg, 0.742);
});

test('QA scale simulator cannot activate unless ARTISYS_QA is exactly 1', async () => {
  const runtime = createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ ARTISYS_QA:'0', PDV_QA_SCALE_WEIGHT_KG:'0.742' },
    modules:fakeModules()
  });

  const status = await runtime.status();
  assert.equal(status.scale.available, false);
  await assert.rejects(() => runtime.readWeight(), /Balanca nao configurada/);
});
