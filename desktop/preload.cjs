'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artisysDesktop', {
  getConfig: () => ipcRenderer.invoke('artisys:config'),
  apiRequest: (request) => ipcRenderer.invoke('artisys:api', request),
  imports: {
    pickFile: () => ipcRenderer.invoke('artisys:imports:pick')
  },
  photos: {
    sync: (input) => ipcRenderer.invoke('artisys:photos:sync', input),
    status: () => ipcRenderer.invoke('artisys:photos:status'),
    dataUrl: (input) => ipcRenderer.invoke('artisys:photos:data-url', input),
    pickAndUpload: (input) => ipcRenderer.invoke('artisys:photos:pick-upload', input),
    remove: (input) => ipcRenderer.invoke('artisys:photos:remove', input)
  },
  hardware: {
    status: () => ipcRenderer.invoke('artisys:hardware:status'),
    listSerialPorts: () => ipcRenderer.invoke('artisys:hardware:ports'),
    diagnostics: () => ipcRenderer.invoke('artisys:hardware:diagnostics'),
    readWeight: () => ipcRenderer.invoke('artisys:hardware:scale-read'),
    tare: () => ipcRenderer.invoke('artisys:hardware:scale-tare'),
    openDrawer: () => ipcRenderer.invoke('artisys:hardware:drawer-open'),
    print: (job) => ipcRenderer.invoke('artisys:hardware:print', job),
    testPrinter: (text) => ipcRenderer.invoke('artisys:hardware:test-printer', { text }),
    testDrawer: () => ipcRenderer.invoke('artisys:hardware:test-drawer'),
    testScale: () => ipcRenderer.invoke('artisys:hardware:test-scale')
  },
  fiscal: {
    status: () => ipcRenderer.invoke('artisys:fiscal:status'),
    save: (connection) => ipcRenderer.invoke('artisys:fiscal:save', connection),
    remove: () => ipcRenderer.invoke('artisys:fiscal:remove'),
    test: () => ipcRenderer.invoke('artisys:fiscal:test')
  },
  updater: {
    state: () => ipcRenderer.invoke('artisys:updater:state'),
    check: () => ipcRenderer.invoke('artisys:updater:check'),
    download: () => ipcRenderer.invoke('artisys:updater:download'),
    install: () => ipcRenderer.invoke('artisys:updater:install'),
    onStateChanged: (callback) => {
      const handler = (_event, state) => callback(state);
      ipcRenderer.on('artisys:updater:state-changed', handler);
      return () => ipcRenderer.removeListener('artisys:updater:state-changed', handler);
    }
  },
  window: {
    minimize: () => ipcRenderer.send('artisys:window:minimize'),
    maximize: () => ipcRenderer.send('artisys:window:maximize'),
    close: () => ipcRenderer.send('artisys:window:close')
  }
});
