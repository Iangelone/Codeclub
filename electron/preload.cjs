const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeclub', {
  listProjects: () => ipcRenderer.invoke('projects:list'),
  selectProjectFolder: () => ipcRenderer.invoke('projects:select-folder'),
  selectFiles: () => ipcRenderer.invoke('files:select'),
  readFile: (filePath) => ipcRenderer.invoke('files:read', filePath),
  readTextFile: (filePath) => ipcRenderer.invoke('files:read-text', filePath),
  readProjectChat: (projectPath, chatId) => ipcRenderer.invoke('chats:read-project', projectPath, chatId),
  writeProjectChat: (projectPath, chatId, content) => ipcRenderer.invoke('chats:write-project', projectPath, chatId, content),
  switchProject: (projectId) => ipcRenderer.invoke('projects:switch', projectId),
  renameProject: (projectId, name) => ipcRenderer.invoke('projects:rename', projectId, name),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
});
