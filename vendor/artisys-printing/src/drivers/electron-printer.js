'use strict';
const { wrapPrintingError } = require('../errors');
const { normalizePrinterProfile } = require('../printer-profile');
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}
function createElectronPrinterDriver({ BrowserWindow } = {}) {
  if (typeof BrowserWindow !== 'function') throw new TypeError('BrowserWindow is required.');
  async function print(rendered, rawProfile = {}) {
    const profile=normalizePrinterProfile({ ...rawProfile, mode:'electron' });
    const input=typeof rendered === 'object' && rendered !== null && !Buffer.isBuffer(rendered) ? rendered : { text:rendered };
    const width=Number(input.width || profile.width || 42);
    const text=String(input.text ?? '');
    if (!text) throw wrapPrintingError(new Error('Conteudo de impressao vazio.'),'PRINTER_RENDER_FAILED');
    const window=new BrowserWindow({ width:width <= 32 ? 320 : 420, height:640, show:false, webPreferences:{ sandbox:true, nodeIntegration:false, contextIsolation:true } });
    try {
      const safe=escapeHtml(text);
      const html=`<pre style="font-family:Consolas,monospace;font-size:12px;white-space:pre-wrap">${safe}</pre>`;
      await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      const result=await new Promise(resolve => {
        window.webContents.print({ silent:profile.silent, printBackground:false, deviceName:profile.deviceName || undefined }, (success, failureReason) => resolve({ success:Boolean(success), failureReason:failureReason || '' }));
      });
      return { ...result, driver:'electron', device:profile.deviceName, printedAt:result.success ? new Date().toISOString() : null };
    } catch (error) { throw wrapPrintingError(error,'PRINTER_WRITE_FAILED'); }
    finally { if (window && typeof window.isDestroyed === 'function' && !window.isDestroyed()) window.close(); }
  }
  async function status() { return { available:true, mode:'electron' }; }
  return Object.freeze({ print, status });
}
module.exports = { createElectronPrinterDriver, escapeHtml };
