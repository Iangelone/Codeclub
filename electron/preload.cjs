const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeclub', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  selectProjectFolder: () => ipcRenderer.invoke('projects:select-folder'),
  switchProject: (projectId) => ipcRenderer.invoke('projects:switch', projectId),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
});
