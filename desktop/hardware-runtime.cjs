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

function loadModules(modules) {
  if (modules) return modules;
  return {
    serial: require('@artisys/serialport'),
    printing: require('@artisys/printing')
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

  let scale = null;
  if (String(env.PDV_SCALE_PORT || '').trim()) {
    const profile = {
      path:String(env.PDV_SCALE_PORT).trim(),
      baudRate:readPositiveInteger(env.PDV_SCALE_BAUD, 9600, 'PDV_SCALE_BAUD')
    };
    const transport = serial.createSerialTransport({ profile });
    const session = serial.createRequestResponseSession({
      transport,
      request:env.PDV_SCALE_COMMAND || '',
      timeoutMs:readPositiveInteger(env.PDV_SCALE_TIMEOUT_MS, 1500, 'PDV_SCALE_TIMEOUT_MS'),
      parse:buffer => serial.parseNumericWeight(Buffer.isBuffer(buffer) ? buffer.toString('utf8') : buffer)
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

  return Object.freeze({ status, readWeight, tare, openDrawer, print });
}

module.exports = { createPdvHardwareRuntime, readBoolean, readPositiveInteger };
