const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rpmLab', { exportRecords: records => ipcRenderer.invoke('rpm:export', { records }) });
