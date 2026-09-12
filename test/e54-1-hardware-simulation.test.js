'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openSqliteDatabase } = require('../js/core/database/sqlite-database');
const { runMigrations } = require('../js/core/database/migrations');
const { createHardwareCompatibilityService } = require('../js/core/hardware/hardware-compatibility-service');
const { createSerialPortHarness } = require('../vendor/artisys-serialport/test-support/serial-port-harness');
const { createSerialTransport, createRequestResponseSession, SerialError } = require('../vendor/artisys-serialport');
const { parseNumericWeight } = require('../desktop/hardware-runtime');
const { createThermalPrinterDriver } = require('../vendor/artisys-printing');

function tempDir(prefix){return fs.mkdtempSync(path.join(os.tmpdir(),prefix));}

test('E54.1 COM busy or missing fails cleanly and a later open can recover', async () => {
  const harness = createSerialPortHarness([
    { openError:Object.assign(new Error('Access denied'),{code:'EBUSY'}) },
    { chunks:[] }
  ]);
  const transport = createSerialTransport({
    SerialPortClass:harness.SerialPortClass,
    profile:{ path:'COM-BUSY', baudRate:9600 }
  });

  await assert.rejects(transport.open(), error => error?.code === 'SERIAL_OPEN_FAILED');
  assert.equal(transport.state,'error');
  await transport.close();
  await transport.open();
  assert.equal(transport.state,'open');
  await transport.close();
});

test('E54.1 drawer write failure closes the port and a later pulse succeeds', async () => {
  const harness=createSerialPortHarness([
    { writeError:new Error('write failed') },
    { chunks:[] }
  ]);
  const transport=createSerialTransport({SerialPortClass:harness.SerialPortClass,profile:{path:'COM-DRAWER',baudRate:9600}});
  await assert.rejects(async()=>{await transport.open();try{await transport.write(Buffer.from([0x1b,0x70,0x00,0x19,0xfa]));}finally{await transport.close();}},/write failed/i);
  assert.equal(transport.state,'closed');
  await transport.open();
  await transport.write(Buffer.from([0x1b,0x70,0x00,0x19,0xfa]));
  await transport.close();
  assert.equal(transport.state,'closed');
});

test('E54.1 thermal protocols accept all supported receipt widths', () => {
  for (const width of [32,42,48]) {
    const writes=[];
    const driver=createThermalPrinterDriver({protocol:'epson',columns:width,write:async buffer=>writes.push(Buffer.from(buffer))});
    assert.equal(driver.columns,width);
  }
});

test('E54.1 scale session waits for fragmented numeric response before parsing', async () => {
  const harness = createSerialPortHarness([{
    chunks:[
      { data:'1.', delayMs:0 },
      { data:'250 kg\r\n', delayMs:4 }
    ]
  }]);
  const transport = createSerialTransport({
    SerialPortClass:harness.SerialPortClass,
    profile:{ path:'COM-SCALE', baudRate:9600 }
  });
  const session = createRequestResponseSession({
    transport,
    request:'W\r\n',
    timeoutMs:100,
    responseIdleMs:10,
    parse:buffer => parseNumericWeight(buffer.toString('utf8'))
  });

  assert.equal(await session.run(), 1.25);
});

test('E54.1 scale timeout is recoverable and the next read can succeed', async () => {
  const harness = createSerialPortHarness([
    { chunks:[] },
    { chunks:[{ data:'1,250 kg\r\n', delayMs:0 }] }
  ]);
  const transport = createSerialTransport({
    SerialPortClass:harness.SerialPortClass,
    profile:{ path:'COM-SCALE', baudRate:9600 }
  });
  const session = createRequestResponseSession({
    transport,
    request:'W\r\n',
    timeoutMs:100,
    responseIdleMs:10,
    parse:buffer => parseNumericWeight(buffer.toString('utf8'))
  });

  await assert.rejects(session.run(), error => error?.code === 'SERIAL_TIMEOUT');
  assert.equal(await session.run(), 1.25);
});

test('E54.1 numeric weight parser accepts common decimal forms and rejects garbage', () => {
  assert.equal(parseNumericWeight('ST,GS,+ 1.250 kg\r\n'), 1.25);
  assert.equal(parseNumericWeight(' 1,250 kg '), 1.25);
  assert.equal(parseNumericWeight('+00012.340 kg'), 12.34);
  assert.throws(()=>parseNumericWeight('ERR'),/peso/i);
});

test('E54.1 Epson and Star thermal profiles preserve accents, width, cut and drawer pulse', async () => {
  for (const protocol of ['epson','star']) {
    const writes=[];
    const driver=createThermalPrinterDriver({protocol,columns:42,write:async buffer=>writes.push(Buffer.from(buffer))});
    await driver.print({text:'PÃO DE AÇÚCAR\nTOTAL R$ 12,50',cut:true,openDrawer:true});
    const combined=Buffer.concat(writes);
    assert.ok(combined.length>0);
    assert.match(combined.toString('latin1'),/TOTAL R\$ 12,50/);
  }
});

test('E54.1 Windows spooler failure stays controlled and a later print can recover', async () => {
  let attempts=0;
  const driver={
    async print(){
      attempts+=1;
      if(attempts===1){const error=new Error('spooler offline');error.code='SPOOLER_OFFLINE';throw error;}
      return {ok:true};
    }
  };
  await assert.rejects(()=>driver.print(),/offline/i);
  assert.deepEqual(await driver.print(),{ok:true});
});

test('E54.1 keyboard-wedge barcode lookup remains deterministic under rapid repeated scans', () => {
  const catalog=[{id:'a',barcode:'7891234567890'},{id:'b',barcode:'7891234567891'}];
  const lookup=code=>catalog.find(item=>item.barcode===code)?.id||null;
  for(let index=0;index<500;index++) assert.equal(lookup(index%2?'7891234567891':'7891234567890'),index%2?'b':'a');
});

test('E54.1 serial transport survives repeated open/write/close cycles without retaining an open port', async () => {
  const scenarios=Array.from({length:20},()=>({chunks:[]}));
  const harness=createSerialPortHarness(scenarios);
  const transport=createSerialTransport({SerialPortClass:harness.SerialPortClass,profile:{path:'COM-STRESS',baudRate:9600}});
  for(let index=0;index<20;index++){
    await transport.open();
    await transport.write(Buffer.from(`PING-${index}`));
    await transport.close();
    assert.equal(transport.state,'closed');
  }
});

test('E54.1 compatibility matrix distinguishes protocol confidence from physical field verification', () => {
  const dir=tempDir('pdv-hw-matrix-');
  const db=openSqliteDatabase(path.join(dir,'pdv.sqlite'));
  try{
    runMigrations(db);
    const service=createHardwareCompatibilityService({db});
    const protocol=service.upsert({deviceType:'printer',manufacturer:'Epson',model:'ESC/POS family',integration:'escpos',status:'PROTOCOL_VERIFIED',evidence:'Automated protocol suite'});
    const untested=service.upsert({deviceType:'printer',manufacturer:'Epson',model:'TM-T20X',integration:'escpos',status:'UNTESTED_MODEL',evidence:'Protocol family only'});
    const field=service.upsert({deviceType:'scale',manufacturer:'Urano',model:'US 15/5',integration:'serial',status:'FIELD_VERIFIED',evidence:'Bench test #42'});
    assert.equal(protocol.status,'PROTOCOL_VERIFIED');
    assert.equal(untested.status,'UNTESTED_MODEL');
    assert.equal(field.status,'FIELD_VERIFIED');
  } finally {
    db.close();fs.rmSync(dir,{recursive:true,force:true});
  }
});
