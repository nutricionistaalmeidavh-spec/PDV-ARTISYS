'use strict';

const { createScaleProtocolRegistry } = require('../js/hardware/scale-protocols');

function readPositiveInteger(value, fallback, name) {
  const parsed = Number(value == null || value === '' ? fallback : value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} invalido.`);
  return parsed;
}

function readBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
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

  const scaleRegistry = createScaleProtocolRegistry();
  const qaScaleWeightCandidate = Number(env.PDV_QA_SCALE_WEIGHT_KG);
  const qaScaleWeightKg = String(env.ARTISYS_QA || '') === '1' && Number.isFinite(qaScaleWeightCandidate) && qaScaleWeightCandidate > 0
    ? Math.round(qaScaleWeightCandidate * 1000) / 1000
    : null;
  let scale = null;
  let scaleSettleMs = null;
  let scalePreset = null;
  let scaleProtocol = null;
  let scaleConfiguration = Object.freeze({
    configured:false,
    enabled:false,
    port:null,
    baud:null,
    connection:'serial',
    responseIdleMs:null,
    timeoutMs:null,
    preset:null,
    protocol:null,
    documentationStatus:null
  });

  function buildScale(input = {}) {
    const enabled = input.enabled !== false;
    const port = String(input.port || '').trim();
    if (!enabled || !port) {
      scale = null;
      scaleSettleMs = null;
      scalePreset = null;
      scaleProtocol = null;
      scaleConfiguration = Object.freeze({
        configured:false,
        enabled:false,
        port:null,
        baud:null,
        connection:String(input.connection || 'serial').trim().toLowerCase() || 'serial',
        responseIdleMs:null,
        timeoutMs:null,
        preset:null,
        protocol:null,
        documentationStatus:null
      });
      return { ...scaleConfiguration };
    }

    const connection = String(input.connection || 'serial').trim().toLowerCase();
    if (!['serial','usb-serial'].includes(connection)) throw new Error('Conexao da balanca invalida. Use serial ou usb-serial.');

    const presetId = String(input.preset || '').trim();
    scalePreset = presetId ? scaleRegistry.getPreset(presetId) : null;
    scaleProtocol = presetId ? scaleRegistry.getProtocolForPreset(presetId) : null;
    const defaultScaleBaud = scalePreset?.defaultBaudRate || 9600;
    const baud = readPositiveInteger(input.baud, defaultScaleBaud, 'PDV_SCALE_BAUD');
    const timeoutMs = readPositiveInteger(input.timeoutMs, 1500, 'PDV_SCALE_TIMEOUT_MS');
    scaleSettleMs = readPositiveInteger(input.responseIdleMs ?? input.settleMs, 30, 'PDV_SCALE_SETTLE_MS');
    const profile = { path:port, baudRate:baud };
    const transport = serial.createSerialTransport({ profile });
    const hasExplicitCommand = input.command != null && String(input.command) !== '';
    const request = hasExplicitCommand ? input.command : (scaleProtocol ? scaleProtocol.request() : '');
    const parse = scaleProtocol
      ? buffer => scaleProtocol.parse(buffer).weight
      : buffer => serial.parseNumericWeight(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : buffer);
    const session = serial.createRequestResponseSession({
      transport,
      request,
      timeoutMs,
      responseIdleMs:scaleSettleMs,
      parse
    });
    scale = serial.createScaleAdapter({ session, profile });
    scaleConfiguration = Object.freeze({
      configured:true,
      enabled:true,
      port,
      baud,
      connection,
      responseIdleMs:scaleSettleMs,
      timeoutMs,
      preset:scalePreset?.id || null,
      protocol:scaleProtocol?.id || null,
      documentationStatus:scalePreset?.documentationStatus || null
    });
    return { ...scaleConfiguration };
  }

  if (String(env.PDV_SCALE_PORT || '').trim()) {
    buildScale({
      enabled:true,
      port:env.PDV_SCALE_PORT,
      baud:env.PDV_SCALE_BAUD,
      connection:env.PDV_SCALE_CONNECTION || 'serial',
      preset:env.PDV_SCALE_PRESET,
      command:env.PDV_SCALE_COMMAND,
      timeoutMs:env.PDV_SCALE_TIMEOUT_MS,
      responseIdleMs:env.PDV_SCALE_SETTLE_MS
    });
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

  async function configureScale(input = {}) {
    return buildScale(input);
  }

  async function status() {
    const printerStatus = typeof printer.status === 'function' ? await printer.status(printerProfile) : { available:true };
    return {
      barcodeScanner:{ available:true, mode:'keyboard-wedge' },
      scale:scale ? await scale.status() : qaScaleWeightKg != null ? { available:true, mode:'qa-simulator' } : { available:false, reason:'not-configured' },
      printer:printerMode === 'serial' ? { ...printerStatus, mode:'serial' } : printerStatus,
      cashDrawer:cashDrawer ? await cashDrawer.status() : { available:false, reason:'not-configured' }
    };
  }

  async function listSerialPorts(){
    if(!serialManager||typeof serialManager.list!=='function')return[];
    try{return(await serialManager.list()).map(sanitizePort).filter(port=>port.path);}catch(error){return[{path:'',manufacturer:null,vendorId:null,productId:null,pnpId:null,error:String(error?.message||'Falha ao listar portas seriais.')}];}
  }

  async function readWeight() {
    if (!scale) {
      if (qaScaleWeightKg != null) return { weight:qaScaleWeightKg, unit:'kg' };
      throw new Error('Balanca nao configurada.');
    }
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
        scale:qaScaleWeightKg != null && !scale ? { ...scaleConfiguration, simulated:true, weightKg:qaScaleWeightKg } : { ...scaleConfiguration },
        drawer:{configured:Boolean(cashDrawer),port:String(env.PDV_DRAWER_PORT||'').trim()||null,baud:cashDrawer?readPositiveInteger(env.PDV_DRAWER_BAUD,9600,'PDV_DRAWER_BAUD'):null}
      },
      note:'Diagnostico local sanitizado; nao declara homologacao fisica sem evidencia registrada.'
    };
  }
  async function testPrinter(text='TESTE DE IMPRESSAO\nDOCUMENTO NAO FISCAL\n'){return print({text:String(text||'TESTE DE IMPRESSAO\nDOCUMENTO NAO FISCAL\n'),width:receiptWidth});}
  async function testDrawer(){return openDrawer();}
  async function testScale(){return readWeight();}

  return Object.freeze({ status, listSerialPorts, diagnostics, configureScale, readWeight, tare, openDrawer, print, testPrinter, testDrawer, testScale });
}

module.exports = { createPdvHardwareRuntime, readBoolean, readPositiveInteger, sanitizePort };
