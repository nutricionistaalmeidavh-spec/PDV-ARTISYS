'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvHardwareRuntime } = require('../desktop/hardware-runtime.cjs');

function fakeModules(calls) {
  return {
    serial: {
      createSerialTransport({ profile }) {
        calls.push(['serial-transport', profile]);
        return { status:async()=>({ available:true, path:profile.path, baudRate:profile.baudRate }) };
      },
      createRequestResponseSession(options) {
        calls.push(['request-session', options]);
        return { run:async()=>({weight:0.742,unit:'kg'}) };
      },
      createScaleAdapter({ session, profile }) {
        return {
          status:async()=>({ available:true, path:profile.path, baudRate:profile.baudRate, unit:'kg' }),
          readWeight:()=>session.run()
        };
      },
      createDrawerAdapter(){ return { status:async()=>({available:false}), open:async()=>true }; },
      parseNumericWeight(value){ return Number(value); }
    },
    printing: {
      normalizePrinterProfile(profile){ return profile; },
      createElectronPrinterDriver(){ return { status:async()=>({available:true,mode:'electron'}), print:async()=>({success:true}) }; },
      createThermalPrinterDriver(){ return { status:async()=>({available:true,mode:'thermal'}), print:async()=>({success:true}) }; },
      createTransportPrinterDriver(){ return { status:async()=>({available:true,mode:'transport'}), print:async()=>({success:true}) }; }
    }
  };
}

test('Toledo preset wires ENQ and Prt5 parser into the hardware request session', async () => {
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_SCALE_PORT:'COM3', PDV_SCALE_PRESET:'toledo-prix3-prt5' },
    modules:fakeModules(calls)
  });
  const session=calls.find((entry)=>Array.isArray(entry)&&entry[0]==='request-session')?.[1];
  assert.ok(session);
  assert.deepEqual(Buffer.from(session.request), Buffer.from([0x05]));
  assert.deepEqual(session.parse(Buffer.from([0x02,0x30,0x30,0x37,0x34,0x32,0x03])), {weight:0.742,unit:'kg',stable:true});
  const diagnostics=await runtime.diagnostics();
  assert.equal(diagnostics.configuration.scale.preset,'toledo-prix3-prt5');
  assert.equal(diagnostics.configuration.scale.protocol,'toledo-prt5');
});

test('unknown scale preset fails closed instead of silently falling back', () => {
  assert.throws(()=>createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_SCALE_PORT:'COM3', PDV_SCALE_PRESET:'fabricante-inexistente' },
    modules:fakeModules([])
  }), /preset|balanca|desconhecido/i);
});
