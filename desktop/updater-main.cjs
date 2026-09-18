'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createUpdaterService } = require('./updater-service.cjs');

require('./main.cjs');

let updater = null;

function getMainWindow() {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) || null;
}

function envelope(fn) {
  return async () => {
    try { return { ok: true, data: await fn() }; }
    catch (error) { return { ok: false, error: { message: error?.message || 'Erro inesperado.' } }; }
  };
}

app.whenReady().then(() => {
  updater = createUpdaterService({
    app,
    autoUpdater,
    updateUrl: process.env.PDV_UPDATE_URL || '',
    onState: (state) => {
      const window = getMainWindow();
      if (window) window.webContents.send('artisys:updater:state-changed', state);
    }
  });

  ipcMain.handle('artisys:updater:state', envelope(() => updater.state()));
  ipcMain.handle('artisys:updater:check', envelope(() => updater.check()));
  ipcMain.handle('artisys:updater:download', envelope(() => updater.download()));
  ipcMain.handle('artisys:updater:install', envelope(() => updater.install()));
  updater.start();
}).catch((error) => console.error('Updater bootstrap failed', error));
