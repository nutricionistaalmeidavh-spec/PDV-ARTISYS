'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeScaleConfig } = require('../desktop/hardware-config-store.cjs');
const { createPdvHardwareRuntime } = require('../desktop/hardware-runtime.cjs');

function fakeModules() {
  return {
    serial: {
      createSerialPortManager(){ return { list:async()=>[] }; },
      parseNumericWeight(value){ return Number(String(value).trim()); },
      createSerialTransport(){ throw new Error('serial transport must not be used by QA simulator'); },
      createRequestResponseSession(){ throw new Error('serial session must not be used by QA simulator'); },
      createScaleAdapter(){ throw new Error('scale adapter must not be used by QA simulator'); }
    },
    printing: {
      normalizePrinterProfile(profile){ return profile; },
      createElectronPrinterDriver(){ return { status:async()=>({available:true}), print:async()=>({success:true}) }; }
    }
  };
}

test('scale configuration preserves roadmap connection and baud fields', () => {
  const config = normalizeScaleConfig({
    profile:'toledo-prix3-prt5',
    port:' COM8 ',
    connection:'usb-serial',
    baud:4800
  });
  assert.deepEqual(config, {
    profile:'toledo-prix3-prt5',
    port:'COM8',
    connection:'usb-serial',
    baud:4800
  });
});

test('hardware scale UI exposes connection and baud and sends them to configureScale', () => {
  const source = fs.readFileSync(path.join(__dirname,'../desktop/renderer/hardware-scale-ui.js'),'utf8');
  assert.match(source, /id="scale-connection"/);
  assert.match(source, /id="scale-baud"/);
  assert.match(source, /configureScale\(\{profile,port,connection,baud,requestCommand\}\)/);
});

test('QA scale simulator exists only when ARTISYS_QA=1', async () => {
  const qaRuntime = createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ ARTISYS_QA:'1', PDV_QA_SCALE_WEIGHT_KG:'0.742' },
    modules:fakeModules()
  });
  const qaStatus = await qaRuntime.status();
  assert.deepEqual(qaStatus.scale, { available:true, mode:'qa-simulator' });
  assert.deepEqual(await qaRuntime.readWeight(), { weight:0.742, unit:'kg' });

  const productionRuntime = createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ ARTISYS_QA:'0', PDV_QA_SCALE_WEIGHT_KG:'0.742' },
    modules:fakeModules()
  });
  const productionStatus = await productionRuntime.status();
  assert.equal(productionStatus.scale.available, false);
  await assert.rejects(() => productionRuntime.readWeight(), /nao configurada/i);
});
