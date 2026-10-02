'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, dialog, nativeImage } = require('electron');
const path = require('node:path');
const { existsSync } = require('node:fs');
const { mkdir, writeFile } = require('node:fs/promises');
const { randomBytes, createHash } = require('node:crypto');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { applyPendingRestore } = require('../js/core/backup/pending-restore');
const { resolvePrintingPreferences } = require('../js/domains/printing/printing-preferences');
const { createLocalServer } = require('../server/local-server');
const { resolveBootstrapConfig, validateBootstrapConfig, shouldStartEmbeddedServer } = require('./bootstrap-config.cjs');
const { createTerminalCredentialStore } = require('./terminal-credentials.cjs');
const { registerImportIpc } = require('./import-bridge.cjs');
const { createProductPhotoClient, registerProductPhotoIpc } = require('./product-photo-bridge.cjs');
const { createHardwareController, registerHardwareIpc } = require('./hardware-bridge.cjs');
const { createPdvHardwareRuntime } = require('./hardware-runtime.cjs');
const { createHardwareConfigStore } = require('./hardware-config-store.cjs');
const { createReceiptActions, registerReceiptIpc } = require('./receipt-actions.cjs');
const { createFiscalConnectionStore, createFiscalProviderResolver, registerFiscalIpc } = require('./fiscal-bridge.cjs');
const { createFiscalCredentialStore } = require('./fiscal-credential-store.cjs');
const { createNfseProviderResolver } = require('./nfse-provider-resolver.cjs');
const { createFiscalSidecarRuntime } = require('./fiscal-sidecar-runtime.cjs');
const { resolveFiscalRuntimePaths } = require('./fiscal-runtime-paths.cjs');
const { loadDataServerConfig, saveDataServerConfig, isHostMode, isExternalMode, publicDataServerConfig } = require('./data-server-config.cjs');
const { migrateLegacyDataServerCredential, saveDataServerSelection, testDataServerTarget } = require('./data-server-runtime.cjs');

let mainWindow = null;
let runtime = null;
let localServer = null;
let lanServer = null;
let apiBase = '';
let bootstrapConfig = null;
let terminalCredentialStore = null;
let hardwareController = null;
let hardwareConfigStore = null;
let fiscalStore = null;
let fiscalCredentialStore = null;
let fiscalSidecar = null;
let fiscalProviderResolver = async () => null;
let nfseProviderResolver = async () => null;
let printWorker = null;
let printWorkerBusy = false;
let installationWasExisting = true;
let dataServerConfig = null;
let dataServerConfigPath = '';
const installToken = randomBytes(32).toString('hex');
const API_TIMEOUT_MS = 12000;

async function fetchWithTimeout(url, options = {}, timeoutMs = API_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal:controller.signal }); }
  catch (error) {
    if (error?.name === 'AbortError') throw new Error('O servidor não respondeu dentro do tempo esperado.');
    throw new Error(`Não foi possível acessar o servidor: ${error?.message || error}`);
  } finally { clearTimeout(timer); }
}

function rendererPath(...parts) {
  return path.join(__dirname, 'renderer', ...parts);
}

function currentPrintingPreferences() {
  return resolvePrintingPreferences({ settings:runtime?.settings || null, env:process.env, isExistingInstall:installationWasExisting });
}

function terminalCredentialConfigured() {
  try { return Boolean(terminalCredentialStore?.status?.().configured); }
  catch { return false; }
}

async function startEmbeddedServer() {
  const dbPath = path.join(app.getPath('userData'), 'pdv-artisys.sqlite');
  const backupDir = path.join(app.getPath('userData'), 'backups');
  applyPendingRestore({ dbPath, backupDir });
  installationWasExisting = existsSync(dbPath);
  const installationId=createHash('sha256').update(path.resolve(dbPath)).digest('hex').slice(0,32);
  runtime = createPdvRuntime({
    dbPath,
    backupDir,
    diagnosticsDir:path.join(app.getPath('userData'),'diagnostics'),
    productPhotoDir:path.join(app.getPath('userData'),'product-photos'),
    appVersion:app.getVersion(),
    serverVersion:app.getVersion(),
    fiscalProviderResolver,
    nfseProviderResolver,
    installationId,
    accountEndpoint:bootstrapConfig?.accountEndpoint || '',
    requireCommercialActivation:bootstrapConfig?.requireCommercialActivation === true,
    receiptOptions: {
      storeName: bootstrapConfig?.storeName || process.env.PDV_STORE_NAME || 'Loja Matriz',
      width: Number(process.env.PDV_RECEIPT_WIDTH || 42)
    }
  });

  if (!app.isPackaged && process.env.ARTISYS_QA === '1' && process.env.ARTISYS_QA_AUTO_ADMIN === '1' && runtime.catalog.countUsers() === 0) {
    runtime.catalog.createUser({
      id:'qa-admin',
      username:'qaadmin',
      name:'QA Administrador',
      role:'admin',
      password:'QaLocalOnly-12345!',
      active:true
    });
  }

  localServer = createLocalServer({ runtime, host: '127.0.0.1', port: 0, token: installToken, requireTerminalAuth:false, isExistingInstall:installationWasExisting });
  const localAddress = await localServer.start();
  apiBase = `http://127.0.0.1:${localAddress.port}`;

  if (isHostMode(dataServerConfig)) {
    const lanHost = dataServerConfig.host;
    const lanPort = dataServerConfig.port;
    if (!Number.isInteger(lanPort) || lanPort < 1 || lanPort > 65535) throw new Error('PDV_LAN_PORT invalida.');
    lanServer = createLocalServer({ runtime, host:lanHost, port:lanPort, token:installToken, requireTerminalAuth:true, isExistingInstall:installationWasExisting });
    try {
      await lanServer.start();
    } catch (error) {
      console.error('Servidor LAN configurado, mas indisponível.', error);
      try { await lanServer.stop(); } catch {}
      lanServer = null;
      throw new Error(`Não foi possível iniciar o PC principal na porta ${lanPort}. Nenhum fallback foi aplicado.`);
    }
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
  const storedScale = hardwareConfigStore?.load()?.scale || null;
  const hardwareEnv = { ...process.env };
  if (storedScale) {
    hardwareEnv.PDV_SCALE_PROFILE = storedScale.profile;
    hardwareEnv.PDV_SCALE_PORT = storedScale.port;
    if (storedScale.requestCommand) hardwareEnv.PDV_SCALE_URANO_REQUEST = storedScale.requestCommand;
  }
  const hardwareRuntime = createPdvHardwareRuntime({
    BrowserWindow,
    env:hardwareEnv,
    resolvePrinterPreferences:() => currentPrintingPreferences()
  });
  return createHardwareController(hardwareRuntime, {
    onScaleConfigured: configuration => hardwareConfigStore?.saveScale({
      profile:configuration.profile,
      port:configuration.port || '',
      requestCommand:configuration.requestCommand || undefined
    })
  });
}

function terminalApiHeaders() {
  if (bootstrapConfig?.profile !== 'terminal') return {};
  return {
    'x-terminal-id':bootstrapConfig.terminalId,
    'x-terminal-key':bootstrapConfig.terminalKey
  };
}

async function receiptApiRequest(rawPath,{method='GET',sessionToken='',body=undefined}={}) {
  const headers={
    accept:'application/json',
    authorization:`Bearer ${String(sessionToken||'')}`,
    ...terminalApiHeaders()
  };
  let requestBody;
  if(body!==undefined){headers['content-type']='application/json';requestBody=JSON.stringify(body);}
  const response=await fetchWithTimeout(`${apiBase}${rawPath}`,{method,headers,body:requestBody});
  const text=await response.text();
  let payload=null;
  if(text){try{payload=JSON.parse(text);}catch{payload={error:text};}}
  if(!response.ok)throw new Error(payload?.error||`Erro HTTP ${response.status}`);
  return payload;
}

async function fetchSaleReceipt(saleId, sessionToken) {
  return receiptApiRequest(`/api/v1/sales/${encodeURIComponent(saleId)}/receipt`,{sessionToken});
}

async function createSalePrintAttempt(saleId,sessionToken) {
  return receiptApiRequest(`/api/v1/sales/${encodeURIComponent(saleId)}/print-attempts`,{method:'POST',sessionToken});
}

async function finishSalePrintAttempt(saleId,jobId,outcome,sessionToken) {
  return receiptApiRequest(`/api/v1/sales/${encodeURIComponent(saleId)}/print-attempts/${encodeURIComponent(jobId)}/result`,{method:'POST',sessionToken,body:outcome});
}

async function writeReceiptFile(filePath, bytes) {
  const target=path.resolve(String(filePath||''));
  await mkdir(path.dirname(target),{recursive:true});
  await writeFile(target,bytes);
}

function startPrintWorker() {
  if (printWorker || !runtime) return;
  const tick = async () => {
    if (printWorkerBusy || !runtime || !hardwareController) return;
    let preferences;
    try { preferences = currentPrintingPreferences(); }
    catch (error) {
      runtime.logger?.log({ level:'error', subsystem:'printing', message:error?.message || 'Falha ao resolver configuracao de impressao.' });
      return;
    }
    if (!preferences.autoPrint) return;
    const job = runtime.printing.listJobs({ status:'PENDING', type:'SALE_RECEIPT' })[0];
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
    version: app.getVersion(),
    dataServer: publicDataServerConfig(dataServerConfig,terminalCredentialConfigured())
  }));

  ipcMain.handle('artisys:data-server:state', () => publicDataServerConfig(dataServerConfig,terminalCredentialConfigured()));
  ipcMain.handle('artisys:data-server:save', (_event, input = {}) => {
    dataServerConfig = saveDataServerSelection({
      db:runtime?.db||null,
      filePath:dataServerConfigPath,
      input,
      currentConfig:dataServerConfig,
      credentialStore:terminalCredentialStore
    });
    return { config:publicDataServerConfig(dataServerConfig,terminalCredentialConfigured()), restartRequired:true };
  });
  ipcMain.handle('artisys:data-server:test', async (_event, input = {}) => testDataServerTarget({
    input,
    currentConfig:dataServerConfig,
    credentialStore:terminalCredentialStore,
    fetchImpl:(url,options)=>fetchWithTimeout(url,options,5000),
    timeoutMs:5000
  }));
  ipcMain.handle('artisys:data-server:restart', () => { app.relaunch(); app.exit(0); });

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
    } else if (rawPath === '/api/v1/auth/login' || rawPath === '/api/v1/setup/admin' || rawPath.startsWith('/api/v1/setup/activation/') || rawPath.startsWith('/api/v1/restaurant/') || rawPath.startsWith('/api/v1/vertical/') || rawPath.startsWith('/api/v1/product-variants')) {
      headers['x-pdv-token'] = installToken;
    }
    let body;
    if (request.body !== undefined && request.body !== null) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(request.body);
    }
    const response = await fetchWithTimeout(`${apiBase}${rawPath}`, { method, headers, body });
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
  const receiptActions=createReceiptActions({
    BrowserWindow,
    dialog,
    writeFile:writeReceiptFile,
    getReceipt:fetchSaleReceipt,
    createPrintAttempt:createSalePrintAttempt,
    finishPrintAttempt:finishSalePrintAttempt,
    printReceipt:receipt=>hardwareController.print({
      id:`sale-${receipt.saleId}`,
      text:receipt.text,
      width:receipt.width,
      paperMm:receipt.paperMm,
      logoDataUrl:receipt.logoDataUrl||null
    }),
    env:process.env,
    getParentWindow:()=>mainWindow
  });
  registerReceiptIpc({ipcMain,actions:receiptActions,isTrustedSender:trustedSender});
  registerFiscalIpc({
    ipcMain,
    store:fiscalStore,
    credentialStore:fiscalCredentialStore,
    isTrustedSender:trustedSender,
    resolveSession:sessionToken=>receiptApiRequest('/api/v1/auth/session',{sessionToken}),
    providerResolver:fiscalProviderResolver,
    sidecarBaseUrlResolver:()=>fiscalSidecar?.getBaseUrl() || null,
    dialog,
    getParentWindow:()=>mainWindow,
    onCertificateSaved:status=>runtime?.fiscalConfiguration?.saveCertificateMetadata?.({certificateName:status.certificateName,...(status.certificate||{})}),
    isProductionEnabled:()=>runtime?.fiscalProduction?.getActivation?.().enabled===true
  });
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
    if (fiscalSidecar) {
      try { await fiscalSidecar.stop(); }
      catch (error) { console.error(error); }
    }
    fiscalSidecar = null;
  }
}

app.whenReady().then(async () => {
  dataServerConfigPath = path.join(app.getPath('userData'), 'data-server.json');
  dataServerConfig = loadDataServerConfig(dataServerConfigPath);
  // QA runs must be deterministic: choose local storage without opening the
  // first-run selector (which intentionally restarts the app after saving).
  // This is restricted to the automated QA process and never affects installs.
  if (process.env.ARTISYS_QA === '1' && process.env.ARTISYS_QA_AUTO_LOCAL === '1' && !dataServerConfig.selected) {
    dataServerConfig = saveDataServerConfig(dataServerConfigPath, { mode:'local', host:'127.0.0.1', port:4174, terminalId:'PDV-01' });
  }
  const deploymentPath = path.join(app.getPath('userData'), 'deployment.json');
  const publicBootstrap = resolveBootstrapConfig({ env:process.env, configPath:deploymentPath });
  terminalCredentialStore = createTerminalCredentialStore({ app, safeStorage });
  dataServerConfig = migrateLegacyDataServerCredential({ config:dataServerConfig, filePath:dataServerConfigPath, credentialStore:terminalCredentialStore });
  hardwareConfigStore = createHardwareConfigStore({ filePath:path.join(app.getPath('userData'), 'hardware.json') });
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
  fiscalCredentialStore = createFiscalCredentialStore({ app, safeStorage });
  fiscalProviderResolver = createFiscalProviderResolver({
    store:fiscalStore,
    credentialStore:fiscalCredentialStore,
    sidecarBaseUrlResolver:()=>fiscalSidecar?.getBaseUrl() || null
  });
  nfseProviderResolver = createNfseProviderResolver({credentialStore:fiscalCredentialStore,env:process.env});

  if (!isExternalMode(dataServerConfig) && shouldStartEmbeddedServer(bootstrapConfig)) {
    const fiscalRuntimePaths = resolveFiscalRuntimePaths({ app, processObj:process, dirname:__dirname });
    fiscalSidecar = createFiscalSidecarRuntime({
      env:process.env,
      entryPath:fiscalRuntimePaths.sidecarEntryPath,
      cwd:fiscalRuntimePaths.runtimeDir,
      onError:error => console.error(error)
    });
    try {
      await fiscalSidecar.start();
    } catch (error) {
      console.error('Fiscal sidecar indisponivel; PDV continuara sem emissao local.', error);
    }
    await startEmbeddedServer();
  } else {
    apiBase = isExternalMode(dataServerConfig) ? dataServerConfig.serverUrl : bootstrapConfig.apiBase.replace(/\/+$/, '');
    if (isExternalMode(dataServerConfig)) {
      const terminalKey=terminalCredentialStore.load();
      if(!terminalKey)throw new Error('Credencial segura deste terminal não está configurada. Configure novamente o servidor de dados.');
      bootstrapConfig = { ...bootstrapConfig, profile:'terminal', terminalId:dataServerConfig.terminalId, terminalKey, apiBase };
      validateBootstrapConfig(bootstrapConfig);
    }
  }

  registerIpc();
  createMainWindow();
  startPrintWorker();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
}).catch((error) => {
  console.error('Falha fatal ao iniciar o ArtiSys PDV.', error);
  try {
    dialog.showErrorBox(
      'ArtiSys PDV - Falha na inicialização',
      `${error?.message || error}\n\nReinicie o computador e tente novamente. Se o problema continuar, envie esta mensagem ao suporte ArtiSys.`
    );
  } catch {}
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => { void shutdown(); });
