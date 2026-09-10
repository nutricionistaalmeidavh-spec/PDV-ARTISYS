'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const runtimePath = '../desktop/hardware-runtime.cjs';

function fakeModules(calls) {
  return {
    serial: {
      createSerialTransport({ profile }) {
        calls.push(['serial-transport', profile]);
        return {
          async open(){ calls.push(['transport-open', profile.path]); },
          async close(){ calls.push(['transport-close', profile.path]); },
          async write(data){ calls.push(['transport-write', profile.path, Buffer.from(data).toString()]); },
          async drain(){ calls.push(['transport-drain', profile.path]); },
          onData(){ return ()=>{}; },
          async status(){ return { available:true, state:'closed', path:profile.path, baudRate:Number(profile.baudRate || 9600) }; }
        };
      },
      createRequestResponseSession(){ return { run:async()=>1.23456 }; },
      createScaleAdapter(){ return { status:async()=>({available:true,path:'COM3',baudRate:9600,unit:'kg'}), readWeight:async()=>({weight:1.235,unit:'kg'}) }; },
      createDrawerAdapter({ transport }) { return { status:()=>transport.status(), open:async()=>{ calls.push('drawer-open'); return true; } }; },
      parseNumericWeight(value){ return Number(value); }
    },
    printing: {
      normalizePrinterProfile(profile){ return profile; },
      createElectronPrinterDriver(){ return { status:async()=>({available:true,mode:'electron'}), print:async()=>{ calls.push('electron-print'); return {success:true,driver:'electron'}; } }; },
      createThermalPrinterDriver(){ return { status:async()=>({available:true,mode:'thermal'}), print:async()=>{ calls.push('thermal-print'); return {success:true,driver:'thermal'}; } }; },
      createTransportPrinterDriver(){ return { status:async()=>({available:true,mode:'transport'}), print:async()=>{ calls.push('transport-print'); return {success:true,driver:'transport'}; } }; }
    }
  };
}

test('defaults to Electron printing and reports unconfigured scale/drawer', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({ BrowserWindow:function(){}, env:{}, modules:fakeModules(calls) });
  const result=await runtime.print({text:'cupom',width:42});
  const status=await runtime.status();
  assert.equal(result.driver,'electron');
  assert.deepEqual(calls,['electron-print']);
  assert.equal(status.printer.mode,'electron');
  assert.equal(status.scale.available,false);
  assert.equal(status.cashDrawer.available,false);
  assert.equal(status.barcodeScanner.mode,'keyboard-wedge');
});

test('configured scale and drawer use the shared serial module', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_SCALE_PORT:'COM3', PDV_SCALE_BAUD:'9600', PDV_DRAWER_PORT:'COM4', PDV_DRAWER_BAUD:'9600' },
    modules:fakeModules(calls)
  });
  assert.deepEqual(await runtime.readWeight(),{weight:1.235,unit:'kg'});
  assert.equal(await runtime.openDrawer(),true);
  const status=await runtime.status();
  assert.equal(status.scale.available,true);
  assert.equal(status.cashDrawer.available,true);
  assert.equal('requestCommand' in status.scale,false);
});

test('thermal mode selects thermal driver without silent fallback', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_PRINTER_MODE:'thermal', PDV_PRINTER_TYPE:'epson', PDV_PRINTER_INTERFACE:'tcp://127.0.0.1:9100' },
    modules:fakeModules(calls)
  });
  const result=await runtime.print({text:'cupom',width:42});
  assert.equal(result.driver,'thermal');
  assert.equal(calls.includes('thermal-print'),true);
  assert.equal(calls.includes('electron-print'),false);
});

test('thermal mode requires an explicit Epson or Star protocol', () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  assert.throws(() => createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_PRINTER_MODE:'thermal', PDV_PRINTER_INTERFACE:'tcp://127.0.0.1:9100' },
    modules:fakeModules([])
  }), /PDV_PRINTER_TYPE/);
});

test('serial printer mode selects transport driver and creates a serial transport', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_PRINTER_MODE:'serial', PDV_PRINTER_PORT:'COM5', PDV_PRINTER_BAUD:'19200' },
    modules:fakeModules(calls)
  });
  const result=await runtime.print({text:'cupom',width:42});
  assert.equal(result.driver,'transport');
  assert.equal(calls.includes('transport-print'),true);
  assert.equal(calls.some(entry=>Array.isArray(entry) && entry[0]==='serial-transport' && entry[1].path==='COM5'),true);
});

test('invalid printer mode fails at startup instead of guessing a driver', () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  assert.throws(()=>createPdvHardwareRuntime({ BrowserWindow:function(){}, env:{PDV_PRINTER_MODE:'cloud'}, modules:fakeModules([]) }), /PDV_PRINTER_MODE invalido/);
});
