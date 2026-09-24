'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artisysDesktop', {
  getConfig: () => ipcRenderer.invoke('artisys:config'),
  apiRequest: (request) => ipcRenderer.invoke('artisys:api', request),
  imports: { pickFile: () => ipcRenderer.invoke('artisys:imports:pick') },
  photos: {
    sync: (input) => ipcRenderer.invoke('artisys:photos:sync', input), status: () => ipcRenderer.invoke('artisys:photos:status'), dataUrl: (input) => ipcRenderer.invoke('artisys:photos:data-url', input), pickAndUpload: (input) => ipcRenderer.invoke('artisys:photos:pick-upload', input), remove: (input) => ipcRenderer.invoke('artisys:photos:remove', input)
  },
  hardware: {
    status: () => ipcRenderer.invoke('artisys:hardware:status'),
    listSerialPorts: () => ipcRenderer.invoke('artisys:hardware:ports'),
    listPrinters: () => ipcRenderer.invoke('artisys:hardware:printers'),
    diagnostics: () => ipcRenderer.invoke('artisys:hardware:diagnostics'),
    configureScale: (input) => ipcRenderer.invoke('artisys:hardware:scale-configure', input),
    readWeight: () => ipcRenderer.invoke('artisys:hardware:scale-read'),
    tare: () => ipcRenderer.invoke('artisys:hardware:scale-tare'),
    openDrawer: () => ipcRenderer.invoke('artisys:hardware:drawer-open'),
    print: (job) => ipcRenderer.invoke('artisys:hardware:print', job),
    testPrinter: (text) => ipcRenderer.invoke('artisys:hardware:test-printer', { text }),
    testDrawer: () => ipcRenderer.invoke('artisys:hardware:test-drawer'),
    testScale: () => ipcRenderer.invoke('artisys:hardware:test-scale')
  },
  receipts: {
    printSale: (input) => ipcRenderer.invoke('artisys:receipts:print-sale', input),
    saveSalePdf: (input) => ipcRenderer.invoke('artisys:receipts:save-pdf', input)
  },
  fiscal: {
    status: () => ipcRenderer.invoke('artisys:fiscal:status'), save: (connection) => ipcRenderer.invoke('artisys:fiscal:save', connection), remove: () => ipcRenderer.invoke('artisys:fiscal:remove'), test: () => ipcRenderer.invoke('artisys:fiscal:test'), sefazStatus: () => ipcRenderer.invoke('artisys:fiscal:sefaz-status'), certificateStatus: () => ipcRenderer.invoke('artisys:fiscal:certificate-status'), importCertificate: (input) => ipcRenderer.invoke('artisys:fiscal:certificate-import', input), setEnvironment: (environment) => ipcRenderer.invoke('artisys:fiscal:set-environment', { environment })
  },
  updater: {
    state: () => ipcRenderer.invoke('updater:state'), check: () => ipcRenderer.invoke('updater:check'), download: () => ipcRenderer.invoke('updater:download'), install: () => ipcRenderer.invoke('updater:install'),
    onState: (handler) => { const listener = (_event, state) => handler(state); ipcRenderer.on('updater:state', listener); return () => ipcRenderer.removeListener('updater:state', listener); }
  },
  window: { minimize: () => ipcRenderer.send('artisys:window:minimize'), maximize: () => ipcRenderer.send('artisys:window:maximize'), close: () => ipcRenderer.send('artisys:window:close') }
});