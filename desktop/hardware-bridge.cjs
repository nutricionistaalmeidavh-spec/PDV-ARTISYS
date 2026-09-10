'use strict';

function createHardwareController(driver = {}) {
  return Object.freeze({
    async status() {
      return typeof driver.status === 'function' ? driver.status() : { available:false };
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

module.exports = { createHardwareController, registerHardwareIpc };
