'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, nativeImage, safeStorage } = require('electron');
const { startServer } = require('../server/app');
const { createAppRuntime } = require('../js/runtime/app-runtime');
const { resolveBootstrapConfig, validateBootstrapConfig, shouldStartEmbeddedServer } = require('./bootstrap-config.cjs');
const { createTerminalCredentialStore } = require('./terminal-credential-store.cjs');
const { buildHardwareController, registerHardwareIpc } = require('./hardware-bridge.cjs');
const { createFiscalConnectionStore, registerFiscalIpc } = require('./fiscal-bridge.cjs');
const { registerImportIpc } = require('./import-bridge.cjs');
const { createProductPhotoClient, registerProductPhotoIpc } = require('./product-photo-bridge.cjs');

if (process.env.ARTISYS_QA_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.ARTISYS_QA_USER_DATA_DIR));

let mainWindow = null;
let runtime = null;
let localServer = null;
let lanServer = null;
let apiBase = null;
let installToken = '';
let bootstrapConfig = null;
let terminalCredentialStore = null;
let hardwareController = null;
let fiscalStore = null;
let printWorker = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#09111f',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });
}

async function startEmbeddedServer() {
  const userData = app.getPath('userData');
  runtime = createAppRuntime({
    dataDir: userData,
    terminalId: bootstrapConfig?.terminalId || 'PDV-01',
    terminalName: bootstrapConfig?.terminalName || 'Terminal PDV-01',
    storeName: bootstrapConfig?.storeName || 'Loja Matriz'
  });
  const started = await startServer({
    runtime,
    host: '127.0.0.1',
    port: 0,
    installToken: runtime.installation.getToken(),
    requireTerminalAuth: false
  });
  localServer = started.server;
  installToken = runtime.installation.getToken();
  apiBase = `http://127.0.0.1:${started.port}`;

  if (bootstrapConfig?.lanEnabled) {
    const lan = await startServer({
      runtime,
      host: bootstrapConfig.lanHost || '0.0.0.0',
      port: bootstrapConfig.lanPort || 4174,
      installToken,
      requireTerminalAuth: true
    });
    lanServer = lan.server;
  }
}

function startPrintWorker() {
  if (!runtime || printWorker) return;
  const drain = async () => {
    try {
      await runtime.printing.processPending(async job => hardwareController?.print(job) || false);
    } catch (error) {
      console.error('Falha ao processar fila de impressão:', error);
    }
  };
  printWorker = setInterval(() => { void drain(); }, 1500);
  void drain();
}

function registerIpc() {
  ipcMain.handle('artisys:config', () => ({
    apiBase,
    deploymentProfile: bootstrapConfig?.profile || 'server-terminal',
    terminalId: bootstrapConfig?.terminalId || 'PDV-01',
    terminalName: bootstrapConfig?.terminalName || 'Terminal PDV-01',
    storeName: bootstrapConfig?.storeName || 'Loja Matriz',
    lanEnabled: Boolean(lanServer),
    version: app.getVersion()
  }));

  ipcMain.handle('artisys:api', async (_event, request = {}) => {
    const method = String(request.method || 'GET').toUpperCase();
    const rawPath = String(request.path || '/api/v1/health');
    if (!rawPath.startsWith('/api/v1/')) throw new Error('Rota de API invalida.');
    const headers = { accept: 'application/json' };
    if (request.sessionToken) headers.authorization = `Bearer ${request.sessionToken}`;
    if (request.mutationId) headers['x-mutation-id'] = String(request.mutationId);
    if (bootstrapConfig?.profile === 'terminal') {
      headers['x-terminal-id'] = bootstrapConfig.terminalId;
      headers['x-terminal-key'] = bootstrapConfig.terminalKey;
    } else if (rawPath === '/api/v1/auth/login' || rawPath === '/api/v1/setup/admin' || rawPath.startsWith('/api/v1/restaurant/') || rawPath.startsWith('/api/v1/vertical/') || rawPath.startsWith('/api/v1/product-variants')) {
      headers['x-pdv-token'] = installToken;
    }
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

  hardwareController = buildHardwareController();
  const trustedSender = event => Boolean(mainWindow && event.sender === mainWindow.webContents);
  registerHardwareIpc({ ipcMain, controller: hardwareController, isTrustedSender: trustedSender });
  registerFiscalIpc({ ipcMain, store:fiscalStore, isTrustedSender:trustedSender });
  registerImportIpc({ ipcMain, dialog, getParentWindow:()=>mainWindow, isTrustedSender:trustedSender });
  const photoClient=createProductPhotoClient({cacheDir:path.join(app.getPath('userData'),'photo-cache',bootstrapConfig?.terminalId||'PDV-01'),getApiBase:()=>apiBase,getTerminalHeaders:()=>bootstrapConfig?.profile==='terminal'?{'x-terminal-id':bootstrapConfig.terminalId,'x-terminal-key':bootstrapConfig.terminalKey}:{}});
  registerProductPhotoIpc({ipcMain,dialog,nativeImage,client:photoClient,getParentWindow:()=>mainWindow,isTrustedSender:trustedSender});

  ipcMain.on('artisys:window:minimize', () => mainWindow?.minimize());
  ipcMain.on('artisys:window:maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  ipcMain.on('artisys:window:close', () => mainWindow?.close());
}

async function shutdown() {
  if (printWorker) clearInterval(printWorker);
  printWorker = null;
  try {
    if (lanServer) await lanServer.stop();
    if (localServer) await localServer.stop();
  } finally {
    lanServer = null;
    localServer = null;
    if (runtime) runtime.close();
    runtime = null;
  }
}

app.whenReady().then(async () => {
  const deploymentPath = path.join(app.getPath('userData'), 'deployment.json');
  const publicBootstrap = resolveBootstrapConfig({ env:process.env, configPath:deploymentPath });
  terminalCredentialStore = createTerminalCredentialStore({ app, safeStorage });
  if (publicBootstrap.profile === 'terminal') {
    const bootstrapSecret = String(process.env.PDV_TERMINAL_KEY || '').trim();
    if (bootstrapSecret) terminalCredentialStore.save(bootstrapSecret);
    const terminalKey = bootstrapSecret || terminalCredentialStore.load();
    bootstrapConfig = { ...publicBootstrap, terminalKey };
  } else {
    bootstrapConfig = publicBootstrap;
  }
  validateBootstrapConfig(bootstrapConfig);
  fiscalStore = createFiscalConnectionStore({ app, safeStorage });
  if (shouldStartEmbeddedServer(bootstrapConfig)) await startEmbeddedServer();
  else apiBase = bootstrapConfig.apiBase.replace(/\/+$/, '');
  registerIpc();
  createMainWindow();
  startPrintWorker();
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
