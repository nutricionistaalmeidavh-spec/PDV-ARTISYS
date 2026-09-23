'use strict';

function createHardwareController(driver = {}) {
  return Object.freeze({
    async status() {
      return typeof driver.status === 'function' ? driver.status() : { available:false };
    },
    async listSerialPorts(){
      return typeof driver.listSerialPorts==='function'?driver.listSerialPorts():[];
    },
    async diagnostics(){
      return typeof driver.diagnostics==='function'?driver.diagnostics():{status:await this.status(),serialPorts:[]};
    },
    async configureScale(input = {}) {
      if (typeof driver.configureScale !== 'function') throw new Error('Configuracao de balanca indisponivel.');
      return driver.configureScale(input || {});
    },
    async readWeight() {
      if (typeof driver.readWeight !== 'function') throw new Error('Balanca nao configurada.');
      const raw = await driver.readWeight();
      const weight = Number(raw && typeof raw === 'object' ? raw.weight : raw);
      if (!Number.isFinite(weight) || weight < 0) throw new Error('Leitura de peso invalida.');
      return {
        weight:Math.round(weight * 1000) / 1000,
        unit:String(raw && typeof raw === 'object' && raw.unit ? raw.unit : 'kg')
      };
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
    },
    async testPrinter(text){if(typeof driver.testPrinter==='function')return driver.testPrinter(text);return this.print({text:String(text||'TESTE DE IMPRESSAO\nDOCUMENTO NAO FISCAL\n')});},
    async testDrawer(){if(typeof driver.testDrawer==='function')return driver.testDrawer();return this.openDrawer();},
    async testScale(){if(typeof driver.testScale==='function')return driver.testScale();return this.readWeight();}
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
  handle('artisys:hardware:ports', () => controller.listSerialPorts());
  handle('artisys:hardware:diagnostics', () => controller.diagnostics());
  handle('artisys:hardware:scale-configure', input => controller.configureScale(input));
  handle('artisys:hardware:scale-read', () => controller.readWeight());
  handle('artisys:hardware:scale-tare', () => controller.tare());
  handle('artisys:hardware:drawer-open', () => controller.openDrawer());
  handle('artisys:hardware:print', input => controller.print(input));
  handle('artisys:hardware:test-printer', input => controller.testPrinter(input?.text));
  handle('artisys:hardware:test-drawer', () => controller.testDrawer());
  handle('artisys:hardware:test-scale', () => controller.testScale());
}

module.exports = { createHardwareController, registerHardwareIpc };
