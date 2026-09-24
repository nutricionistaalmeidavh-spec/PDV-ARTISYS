'use strict';

function readPositiveInteger(value, fallback, name) {
  const parsed = Number(value == null || value === '' ? fallback : value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} invalido.`);
  return parsed;
}

function readBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function readUranoRequestCommand(value) {
  if (value == null || String(value).trim() === '') return 0x04;
  const text = String(value).trim().toLowerCase();
  const parsed = /^0x[0-9a-f]+$/.test(text) ? Number.parseInt(text.slice(2), 16) : Number(text);
  if (![0x04, 0x05].includes(parsed)) throw new Error('PDV_SCALE_URANO_REQUEST invalido. Use 0x04 ou 0x05.');
  return parsed;
}

function loadModules(modules) {
  if (modules) return modules;
  return {
    serial: require('@artisys/serialport'),
    printing: require('@artisys/printing')
  };
}

function sanitizePort(port={}){
  return {
    path:String(port.path||''),
    manufacturer:port.manufacturer?String(port.manufacturer):null,
    vendorId:port.vendorId?String(port.vendorId):null,
    productId:port.productId?String(port.productId):null,
    pnpId:port.pnpId?String(port.pnpId):null
  };
}

function createPdvHardwareRuntime({ BrowserWindow, env = process.env, modules = null } = {}) {
  const shared = loadModules(modules);
  const serial = shared.serial;
  const printing = shared.printing;
  if (!serial || !printing) throw new TypeError('Modulos ArtiSys de hardware indisponiveis.');

  const printerMode = String(env.PDV_PRINTER_MODE || 'electron').trim().toLowerCase();
  if (!['electron','thermal','serial'].includes(printerMode)) throw new Error('PDV_PRINTER_MODE invalido. Use electron, thermal ou serial.');

  const receiptWidth = readPositiveInteger(env.PDV_RECEIPT_WIDTH, 42, 'PDV_RECEIPT_WIDTH');
  if (![32,42,48].includes(receiptWidth)) throw new Error('PDV_RECEIPT_WIDTH invalida.');

  let serialManager=null;
  try{if(typeof serial.createSerialPortManager==='function')serialManager=serial.createSerialPortManager();}catch{/* hardware opcional */}

  const scaleProfileName = String(env.PDV_SCALE_PROFILE || 'generic').trim().toLowerCase();
  if (!['generic','urano-pop-s'].includes(scaleProfileName)) {
    throw new Error('PDV_SCALE_PROFILE invalido. Use generic ou urano-pop-s.');
  }

  let scale = null;
  let scaleSettleMs = null;
  let scaleMetadata = {
    profile: scaleProfileName,
    manufacturer: null,
    model: null,
    dataBits: null,
    stopBits: null,
    parity: null,
    requestCommand: null
  };
  if (String(env.PDV_SCALE_PORT || '').trim()) {
    const path = String(env.PDV_SCALE_PORT).trim();
    let profile;
    let request;
    let parse;

    if (scaleProfileName === 'urano-pop-s') {
      if (typeof serial.createUranoPopSProtocol !== 'function') {
        throw new Error('Perfil Urano POP-S indisponivel no modulo serial.');
      }
      const requestCommand = readUranoRequestCommand(env.PDV_SCALE_URANO_REQUEST);
      const protocol = serial.createUranoPopSProtocol({ requestCommand });
      profile = { path, ...protocol.serial };
      request = protocol.request;
      parse = protocol.parse;
      scaleMetadata = {
        profile: protocol.id || 'urano-pop-s',
        manufacturer: protocol.manufacturer || 'Urano',
        model: protocol.model || 'US 31/2 POP-S',
        dataBits: Number(protocol.serial?.dataBits || 8),
        stopBits: Number(protocol.serial?.stopBits || 2),
        parity: String(protocol.serial?.parity || 'none'),
        requestCommand: `0x${requestCommand.toString(16).padStart(2,'0')}`
      };
    } else {
      profile = {
        path,
        baudRate:readPositiveInteger(env.PDV_SCALE_BAUD, 9600, 'PDV_SCALE_BAUD')
      };
      request = env.PDV_SCALE_COMMAND || '';
      parse = buffer => serial.parseNumericWeight(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : buffer);
    }

    scaleSettleMs = readPositiveInteger(env.PDV_SCALE_SETTLE_MS, 30, 'PDV_SCALE_SETTLE_MS');
    const transport = serial.createSerialTransport({ profile });
    const session = serial.createRequestResponseSession({
      transport,
      request,
      timeoutMs:readPositiveInteger(env.PDV_SCALE_TIMEOUT_MS, 1500, 'PDV_SCALE_TIMEOUT_MS'),
      responseIdleMs:scaleSettleMs,
      parse
    });
    scale = serial.createScaleAdapter({ session, profile });
  }

  let cashDrawer = null;
  if (String(env.PDV_DRAWER_PORT || '').trim()) {
    const profile = {
      path:String(env.PDV_DRAWER_PORT).trim(),
      baudRate:readPositiveInteger(env.PDV_DRAWER_BAUD, 9600, 'PDV_DRAWER_BAUD')
    };
    const transport = serial.createSerialTransport({ profile });
    cashDrawer = serial.createDrawerAdapter({ transport });
  }

  const basePrinterProfile = {
    id:'pdv-receipt',
    width:receiptWidth,
    printerType:String(env.PDV_PRINTER_TYPE || 'generic').trim().toLowerCase(),
    deviceName:String(env.PDV_PRINTER_NAME || '').trim() || null,
    silent:readBoolean(env.PDV_PRINT_SILENT, false),
    cut:readBoolean(env.PDV_PRINTER_CUT, true),
    openDrawerAfterPrint:readBoolean(env.PDV_PRINTER_OPEN_DRAWER, false)
  };

  let printerProfile;
  let printer;
  if (printerMode === 'electron') {
    printerProfile = printing.normalizePrinterProfile({ ...basePrinterProfile, mode:'electron' });
    printer = printing.createElectronPrinterDriver({ BrowserWindow });
  } else if (printerMode === 'thermal') {
    if (!['epson','star'].includes(basePrinterProfile.printerType)) {
      throw new Error('PDV_PRINTER_TYPE obrigatoria quando PDV_PRINTER_MODE=thermal. Use epson ou star.');
    }
    printerProfile = printing.normalizePrinterProfile({
      ...basePrinterProfile,
      mode:'thermal',
      interface:String(env.PDV_PRINTER_INTERFACE || '').trim()
    });
    printer = printing.createThermalPrinterDriver({ timeoutMs:readPositiveInteger(env.PDV_PRINTER_TIMEOUT_MS, 5000, 'PDV_PRINTER_TIMEOUT_MS') });
  } else {
    const printerPort = String(env.PDV_PRINTER_PORT || '').trim();
    if (!printerPort) throw new Error('PDV_PRINTER_PORT obrigatoria quando PDV_PRINTER_MODE=serial.');
    const transport = serial.createSerialTransport({
      profile:{
        path:printerPort,
        baudRate:readPositiveInteger(env.PDV_PRINTER_BAUD, 9600, 'PDV_PRINTER_BAUD')
      }
    });
    printerProfile = printing.normalizePrinterProfile({ ...basePrinterProfile, mode:'transport' });
    printer = printing.createTransportPrinterDriver({ transport });
  }

  async function status() {
    const printerStatus = typeof printer.status === 'function' ? await printer.status(printerProfile) : { available:true };
    return {
      barcodeScanner:{ available:true, mode:'keyboard-wedge' },
      scale:scale ? await scale.status() : { available:false, reason:'not-configured' },
      printer:printerMode === 'serial' ? { ...printerStatus, mode:'serial' } : printerStatus,
      cashDrawer:cashDrawer ? await cashDrawer.status() : { available:false, reason:'not-configured' }
    };
  }

  async function listSerialPorts(){
    if(!serialManager||typeof serialManager.list!=='function')return[];
    try{return(await serialManager.list()).map(sanitizePort).filter(port=>port.path);}catch(error){return[{path:'',manufacturer:null,vendorId:null,productId:null,pnpId:null,error:String(error?.message||'Falha ao listar portas seriais.')}];}
  }

  async function readWeight() {
    if (!scale) throw new Error('Balanca nao configurada.');
    const result = await scale.readWeight();
    const weight = Number(result && typeof result === 'object' ? result.weight : result);
    if (!Number.isFinite(weight) || weight < 0) throw new Error('Leitura de peso invalida.');
    return { weight:Math.round(weight * 1000) / 1000, unit:String(result?.unit || 'kg') };
  }

  async function tare() {
    if (!scale || typeof scale.tare !== 'function') throw new Error('Tara nao suportada.');
    return scale.tare();
  }

  async function openDrawer() {
    if (!cashDrawer) throw new Error('Gaveta nao configurada.');
    return cashDrawer.open();
  }

  async function print(job = {}) {
    const width = Number(job.width || printerProfile.width || 42);
    if (![32,42,48].includes(width)) throw new Error('Largura de impressao invalida.');
    const text = String(job.text || '');
    if (!text) throw new Error('Conteudo de impressao vazio.');
    const profile = printing.normalizePrinterProfile({ ...printerProfile, width });
    return printer.print({ ...job, text, width }, profile);
  }

  async function diagnostics(){
    return{
      status:await status(),
      serialPorts:await listSerialPorts(),
      configuration:{
        printer:{mode:printerMode,type:basePrinterProfile.printerType,width:receiptWidth,deviceName:basePrinterProfile.deviceName||null,interface:printerMode==='thermal'?String(env.PDV_PRINTER_INTERFACE||'').trim()||null:null,serialPort:printerMode==='serial'?String(env.PDV_PRINTER_PORT||'').trim()||null:null},
        scale:{
          configured:Boolean(scale),
          port:String(env.PDV_SCALE_PORT||'').trim()||null,
          baud:scaleProfileName==='urano-pop-s'&&scale?9600:(scale?readPositiveInteger(env.PDV_SCALE_BAUD,9600,'PDV_SCALE_BAUD'):null),
          responseIdleMs:scaleSettleMs,
          ...scaleMetadata
        },
        drawer:{configured:Boolean(cashDrawer),port:String(env.PDV_DRAWER_PORT||'').trim()||null,baud:cashDrawer?readPositiveInteger(env.PDV_DRAWER_BAUD,9600,'PDV_DRAWER_BAUD'):null}
      },
      note:'Diagnostico local sanitizado; nao declara homologacao fisica sem evidencia registrada.'
    };
  }
  async function testPrinter(text='TESTE DE IMPRESSAO\nDOCUMENTO NAO FISCAL\n'){return print({text:String(text||'TESTE DE IMPRESSAO\nDOCUMENTO NAO FISCAL\n'),width:receiptWidth});}
  async function testDrawer(){return openDrawer();}
  async function testScale(){return readWeight();}

  return Object.freeze({ status, listSerialPorts, diagnostics, readWeight, tare, openDrawer, print, testPrinter, testDrawer, testScale });
}

module.exports = { createPdvHardwareRuntime, readBoolean, readPositiveInteger, readUranoRequestCommand, sanitizePort };
