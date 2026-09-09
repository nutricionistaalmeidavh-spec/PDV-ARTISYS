'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artisysDesktop', {
  getConfig: () => ipcRenderer.invoke('artisys:config'),
  apiRequest: (request) => ipcRenderer.invoke('artisys:api', request),
  hardware: {
    status: () => ipcRenderer.invoke('artisys:hardware:status'),
    readWeight: () => ipcRenderer.invoke('artisys:hardware:scale-read'),
    tare: () => ipcRenderer.invoke('artisys:hardware:scale-tare'),
    openDrawer: () => ipcRenderer.invoke('artisys:hardware:drawer-open'),
    print: (job) => ipcRenderer.invoke('artisys:hardware:print', job)
  },
  fiscal: {
    status: () => ipcRenderer.invoke('artisys:fiscal:status'),
    save: (connection) => ipcRenderer.invoke('artisys:fiscal:save', connection),
    remove: () => ipcRenderer.invoke('artisys:fiscal:remove'),
    test: () => ipcRenderer.invoke('artisys:fiscal:test')
  },
  window: {
    minimize: () => ipcRenderer.send('artisys:window:minimize'),
    maximize: () => ipcRenderer.send('artisys:window:maximize'),
    close: () => ipcRenderer.send('artisys:window:close')
  }
});
