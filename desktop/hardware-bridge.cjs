'use strict';

function createHardwareController(driver = {}) {
  return Object.freeze({
    async status() {
      return typeof driver.status === 'function' ? driver.status() : { available:false };
    },
    async readWeight() {
      if (typeof driver.readWeight !== 'function') throw new Error('Balanca nao configurada.');
      const weight = Number(await driver.readWeight());
      if (!Number.isFinite(weight) || weight < 0) throw new Error('Leitura de peso invalida.');
      return { weight: Math.round(weight * 1000) / 1000, unit:'kg' };
    },
    async tare() {
      if (typeof driver.tare !== 'function') throw new Error('Tara nao suportada.');
      return driver.tare();
    },
    async openDrawer() {
      if (typeof driver.openDrawer !== 'function') throw new Error('Gaveta nao configurada.');
      return driver.openDrawer();
    },
    async print(job = {}) {
      const width = Number(job.width || 42);
      if (![32,42,48].includes(width)) throw new Error('Largura de impressao invalida.');
      const text = String(job.text || '');
      if (!text) throw new Error('Conteudo de impressao vazio.');
      if (typeof driver.print !== 'function') throw new Error('Impressora nao configurada.');
      return driver.print({ ...job, text, width });
    }
  });
}

function registerHardwareIpc({ ipcMain, controller, isTrustedSender = null } = {}) {
  if (!ipcMain || !controller) throw new TypeError('ipcMain and controller are required.');
  const trusted = event => typeof isTrustedSender !== 'function' || Boolean(isTrustedSender(event));
  const handle = (channel, fn) => ipcMain.handle(channel, async (event, input) => {
    if (!trusted(event)) throw new Error('Origem IPC nao autorizada.');
    return fn(input || {});
  });
  handle('artisys:hardware:status', () => controller.status());
  handle('artisys:hardware:scale-read', () => controller.readWeight());
  handle('artisys:hardware:scale-tare', () => controller.tare());
  handle('artisys:hardware:drawer-open', () => controller.openDrawer());
  handle('artisys:hardware:print', input => controller.print(input));
}

function createElectronPrintDriver({ BrowserWindow } = {}) {
  if (!BrowserWindow) throw new TypeError('BrowserWindow is required.');
  return async function print(job = {}) {
    const width = Number(job.width || 42);
    const safe = String(job.text || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const window = new BrowserWindow({ width:width<=32?320:420, height:640, show:false, webPreferences:{sandbox:true,nodeIntegration:false,contextIsolation:true} });
    try {
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<pre style="font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap">${safe}</pre>`)}`);
      return await new Promise(resolve => window.webContents.print({ silent:Boolean(job.silent), printBackground:false, deviceName:job.printerName || undefined }, (success,failureReason) => resolve({ success, failureReason:failureReason || '' })));
    } finally {
      if (!window.isDestroyed()) window.close();
    }
  };
}

function createSerialScaleDriver({ SerialPortClass, path, baudRate = 9600, requestCommand = '', parseReading = null, timeoutMs = 1500 } = {}) {
  if (!SerialPortClass || !path) return null;
  const parse = typeof parseReading === 'function' ? parseReading : value => {
    const match = String(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (!match) throw new Error('Resposta da balanca sem peso reconhecivel.');
    return Number(match[0]);
  };
  async function readWeight() {
    const port = new SerialPortClass({ path, baudRate:Number(baudRate), autoOpen:false });
    return new Promise((resolve,reject) => {
      let buffer=''; let settled=false;
      const finish=(error,value)=>{ if(settled)return;settled=true;clearTimeout(timer);try{port.close(()=>{});}catch{} error?reject(error):resolve(value); };
      const timer=setTimeout(()=>finish(new Error('Tempo limite ao ler balanca.')),timeoutMs);
      port.on('data',chunk=>{ buffer+=Buffer.from(chunk).toString('utf8'); try { const value=parse(buffer); if(Number.isFinite(value)) finish(null,value); } catch {} });
      port.on('error',error=>finish(error));
      port.open(error=>{ if(error)return finish(error); if(requestCommand)port.write(requestCommand,writeError=>{if(writeError)finish(writeError);}); });
    });
  }
  return { status:async()=>({available:true,path,baudRate:Number(baudRate),unit:'kg'}), readWeight };
}

function createSerialDrawerDriver({ SerialPortClass, path, baudRate = 9600, pulse = Buffer.from([0x1b,0x70,0x00,0x19,0xfa]) } = {}) {
  if (!SerialPortClass || !path) return null;
  async function open() {
    const port = new SerialPortClass({ path, baudRate:Number(baudRate), autoOpen:false });
    return new Promise((resolve,reject) => {
      port.open(error => {
        if (error) return reject(error);
        port.write(pulse, writeError => {
          if (writeError) { try{port.close(()=>{});}catch{} return reject(writeError); }
          port.drain(drainError => {
            try{port.close(()=>{});}catch{}
            if (drainError) return reject(drainError);
            resolve(true);
          });
        });
      });
    });
  }
  return { status:async()=>({available:true,path,baudRate:Number(baudRate)}), open };
}

module.exports = { createHardwareController, registerHardwareIpc, createElectronPrintDriver, createSerialScaleDriver, createSerialDrawerDriver };
