'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, dialog, nativeImage } = require('electron');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { applyPendingRestore } = require('../js/core/backup/pending-restore');
const { createLocalServer } = require('../server/local-server');
const { resolveBootstrapConfig, validateBootstrapConfig, shouldStartEmbeddedServer } = require('./bootstrap-config.cjs');
const { createTerminalCredentialStore } = require('./terminal-credentials.cjs');
const { registerImportIpc } = require('./import-bridge.cjs');
const { createProductPhotoClient, registerProductPhotoIpc } = require('./product-photo-bridge.cjs');
const { createHardwareController, registerHardwareIpc } = require('./hardware-bridge.cjs');
const { createPdvHardwareRuntime } = require('./hardware-runtime.cjs');
const { createFiscalConnectionStore, createFiscalProviderResolver, registerFiscalIpc } = require('./fiscal-bridge.cjs');

if (process.env.ARTISYS_QA === '1') {
  const explicitQaUserData = String(process.env.ARTISYS_QA_USER_DATA_DIR || '').trim();
  const qaUserData = explicitQaUserData || path.join(os.tmpdir(), 'artisys-pdv-qa', `${process.pid}-${Date.now()}`);
  app.setPath('userData', qaUserData);
}

let mainWindow = null;
let runtime = null;
let localServer = null;
let lanServer = null;
let apiBase = '';
let bootstrapConfig = null;
let terminalCredentialStore = null;
let hardwareController = null;
let fiscalStore = null;
let printWorker = null;
let printWorkerBusy = false;
const installToken = randomBytes(32).toString('hex');

function rendererPath(...parts) {
  return path.join(__dirname, 'renderer', ...parts);
}

async function startEmbeddedServer() {
  const dbPath = path.join(app.getPath('userData'), 'pdv-artisys.sqlite');
  const backupDir = path.join(app.getPath('userData'), 'backups');
  applyPendingRestore({ dbPath, backupDir });
  const fiscalProviderResolver = fiscalStore ? createFiscalProviderResolver({ store:fiscalStore }) : async () => null;
  runtime = createPdvRuntime({
    dbPath,
    backupDir,
    diagnosticsDir:path.join(app.getPath('userData'),'diagnostics'),
    productPhotoDir:path.join(app.getPath('userData'),'product-photos'),
    appVersion:app.getVersion(),
    serverVersion:app.getVersion(),
    fiscalProviderResolver,
    receiptOptions: {
      storeName: bootstrapConfig?.storeName || process.env.PDV_STORE_NAME || 'Loja Matriz',
      width: Number(process.env.PDV_RECEIPT_WIDTH || 42)
    }
  });

  localServer = createLocalServer({ runtime, host: '127.0.0.1', port: 0, token: installToken, requireTerminalAuth:false });
  const localAddress = await localServer.start();
  apiBase = `http://127.0.0.1:${localAddress.port}`;

  if (process.env.PDV_ENABLE_LAN !== 'false') {
    const lanHost = process.env.PDV_LAN_HOST || '0.0.0.0';
    const lanPort = Number(process.env.PDV_LAN_PORT || 4174);
    if (!Number.isInteger(lanPort) || lanPort < 1 || lanPort > 65535) throw new Error('PDV_LAN_PORT invalida.');
    lanServer = createLocalServer({ runtime, host:lanHost, port:lanPort, token:installToken, requireTerminalAuth:true });
    await lanServer.start();
  }
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

function buildHardwareController() {
  const hardwareRuntime = createPdvHardwareRuntime({ BrowserWindow, env:process.env });
  return createHardwareController(hardwareRuntime);
}

function startPrintWorker() {
  if (printWorker || process.env.PDV_AUTO_PRINT === 'false' || !runtime) return;
  const tick = async () => {
    if (printWorkerBusy || !runtime || !hardwareController) return;
    const job = runtime.printing.listJobs({ status:'PENDING' })[0];
    if (!job) return;
    printWorkerBusy = true;
    try {
      await runtime.printing.processJob(job.id, { print: input => hardwareController.print(input) });
    } catch (error) {
      runtime.logger?.log({ level:'error', subsystem:'printing', message:error?.message || 'Falha ao processar impressao.' });
    } finally {
      printWorkerBusy = false;
    }
  };
  printWorker = setInterval(() => { void tick(); }, 1200);
  void tick();
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
    } else if (rawPath === '/api/v1/auth/login' || rawPath === '/api/v1/setup/admin' || rawPath.startsWith('/api/v1/restaurant/') || rawPath.startsWith('/api/v1/vertical/')) {
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
