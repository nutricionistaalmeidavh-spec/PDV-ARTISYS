'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('artisysDesktop', {
  getConfig: () => ipcRenderer.invoke('artisys:config'),
  apiRequest: (request) => ipcRenderer.invoke('artisys:api', request),
  window: {
    minimize: () => ipcRenderer.send('artisys:window:minimize'),
    maximize: () => ipcRenderer.send('artisys:window:maximize'),
    close: () => ipcRenderer.send('artisys:window:close')
  }
});
