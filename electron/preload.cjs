const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codeclub', {
  invoke: (command, args) => ipcRenderer.invoke('native:invoke', { command, args }),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  selectProjectFolder: () => ipcRenderer.invoke('projects:select-folder'),
  selectFiles: () => ipcRenderer.invoke('files:select'),
  readFile: (filePath) => ipcRenderer.invoke('files:read', filePath),
  readTextFile: (filePath) => ipcRenderer.invoke('files:read-text', filePath),
  fileExists: (filePath) => ipcRenderer.invoke('files:exists', filePath),
  makeDirectory: (directory) => ipcRenderer.invoke('files:mkdir', directory),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('files:write-text', filePath, content),
  removeFile: (filePath) => ipcRenderer.invoke('files:remove', filePath),
  joinPath: (...parts) => ipcRenderer.invoke('path:join', parts),
  appConfigDir: () => ipcRenderer.invoke('path:app-config'),
  appCacheDir: () => ipcRenderer.invoke('path:app-cache'),
  readProjectChat: (projectPath, chatId) => ipcRenderer.invoke('chats:read-project', projectPath, chatId),
  writeProjectChat: (projectPath, chatId, content) => ipcRenderer.invoke('chats:write-project', projectPath, chatId, content),
  switchProject: (projectId) => ipcRenderer.invoke('projects:switch', projectId),
  renameProject: (projectId, name) => ipcRenderer.invoke('projects:rename', projectId, name),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  reloadApp: () => ipcRenderer.invoke('app:reload'),
  setComputerOverlay: (payload) => ipcRenderer.invoke('computer:overlay', payload),
  onComputerEscape: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('computer:escape', listener);
    return () => ipcRenderer.removeListener('computer:escape', listener);
  },
  computerMenuAction: (action) => ipcRenderer.send('computer:menu-action', action),
  onComputerContext: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on('computer:context-action', listener);
    return () => ipcRenderer.removeListener('computer:context-action', listener);
  },
});
