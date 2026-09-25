'use strict';

const { app, ipcMain, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');
const { createUpdaterService } = require('./updater-service.cjs');
require('./main.cjs');
require('./telemetry-bootstrap.cjs');

const electronMajor = Number(String(process.versions.electron || '').split('.')[0] || 0);
const legacyRuntime = electronMajor > 0 && electronMajor <= 22;

const service = createUpdaterService({
  app,
  autoUpdater,
  updateUrl: process.env.ARTISYS_UPDATE_URL || '',
  enabled: !legacyRuntime,
  onState: (state) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('updater:state', state);
    }
  }
});

ipcMain.handle('updater:state', async () => service.state());
ipcMain.handle('updater:check', async () => service.check());
ipcMain.handle('updater:download', async () => service.download());
ipcMain.handle('updater:install', async () => service.install());

void app.whenReady().then(() => service.start());
