'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('../server/local-server');

let mainWindow = null;
let runtime = null;
let localServer = null;
let apiBase = '';
const installToken = randomBytes(32).toString('hex');

function rendererPath(...parts) {
  return path.join(__dirname, 'renderer', ...parts);
}

async function startEmbeddedServer() {
  const dbPath = path.join(app.getPath('userData'), 'pdv-artisys.sqlite');
  runtime = createPdvRuntime({ dbPath });
  localServer = createLocalServer({ runtime, host: '127.0.0.1', port: 0, token: installToken });
  const address = await localServer.start();
  apiBase = `http://127.0.0.1:${address.port}`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1536,
    height: 1024,
    minWidth: 1180,
    minHeight: 760,
    show: false,
    frame: false,
    backgroundColor: '#f5f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(rendererPath('index.html'));
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

function registerIpc() {
  ipcMain.handle('artisys:config', () => ({
    apiBase,
    terminalId: process.env.PDV_TERMINAL_ID || 'PDV-01',
    terminalName: process.env.PDV_TERMINAL_NAME || 'Terminal PDV-01',
    storeName: process.env.PDV_STORE_NAME || 'Loja Matriz',
    version: app.getVersion()
  }));

  ipcMain.handle('artisys:api', async (_event, request = {}) => {
    const method = String(request.method || 'GET').toUpperCase();
    const rawPath = String(request.path || '/api/v1/health');
    if (!rawPath.startsWith('/api/v1/')) throw new Error('Rota de API invalida.');
    const headers = { accept: 'application/json' };
    if (request.sessionToken) headers.authorization = `Bearer ${request.sessionToken}`;
    if (request.mutationId) headers['x-mutation-id'] = String(request.mutationId);
    if (rawPath === '/api/v1/auth/login' || rawPath === '/api/v1/setup/admin') headers['x-pdv-token'] = installToken;
    let body;
    if (request.body !== undefined && request.body !== null) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.body);
    }
    const response = await fetch(`${apiBase}${rawPath}`, { method, headers, body });
    let payload = null;
    const text = await response.text();
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = { error: text }; }
    }
    return { ok: response.ok, status: response.status, payload };
  });

  ipcMain.on('artisys:window:minimize', () => mainWindow?.minimize());
  ipcMain.on('artisys:window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('artisys:window:close', () => mainWindow?.close());
}

async function shutdown() {
  try {
    if (localServer) await localServer.stop();
  } finally {
    localServer = null;
    if (runtime) runtime.close();
    runtime = null;
  }
}

app.whenReady().then(async () => {
  registerIpc();
  await startEmbeddedServer();
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { void shutdown(); });
