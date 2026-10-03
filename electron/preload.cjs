const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  chatPage: (project, id, before, limit) => ipcRenderer.invoke('chats:page', project, id, before, limit),
  chatTurns: (project, id, before, limit, direction) => ipcRenderer.invoke('chats:turn-page', project, id, before, limit, direction),
  chatContext: (project, id) => ipcRenderer.invoke('chats:context', project, id),
  chatSaveTail: (project, id, start, messages, expectedTotal) => ipcRenderer.invoke('chats:tail', project, id, start, messages,expectedTotal),
  chatAppend: (project, id, message) => ipcRenderer.invoke('chats:append', project, id, message),
  chatAll: (project, id) => ipcRenderer.invoke('chats:all', project, id),
  chatSearch: (project, id, query) => ipcRenderer.invoke('chats:search', project, id, query),
  chatCopy: (from, to, id) => ipcRenderer.invoke('chats:copy', from, to, id),
  chatDelete: (project, id) => ipcRenderer.invoke('chats:delete', project, id),
  chatTranscript: (project, id, markdown) => ipcRenderer.invoke('chats:transcript', project, id, markdown),
  writeProjectChat: (projectPath, chatId, content) => ipcRenderer.invoke('chats:write-project', projectPath, chatId, content),
  switchProject: (projectId) => ipcRenderer.invoke('projects:switch', projectId),
  renameProject: (projectId, name) => ipcRenderer.invoke('projects:rename', projectId, name),
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsFullScreen: () => ipcRenderer.invoke('window:is-full-screen'),
  onFullscreenChange: (handler) => {
    const listener = (_event, isFullscreen) => handler(Boolean(isFullscreen));
    ipcRenderer.on('window:fullscreen-change', listener);
    return () => ipcRenderer.removeListener('window:fullscreen-change', listener);
  },
  floatingResize: (expanded, animate = true) => ipcRenderer.invoke('codeclub:floating-resize', expanded, animate),
  floatingClose: () => ipcRenderer.invoke('codeclub:floating-close'),
  floatingHidden: (revision) => ipcRenderer.invoke('codeclub:floating-hidden', revision),
  onFloatingHide: (handler) => {
    const listener = (_event, revision) => handler(revision);
    ipcRenderer.on('codeclub:floating-hide', listener);
    return () => ipcRenderer.removeListener('codeclub:floating-hide', listener);
  },
  floatingPointer: (inside) => ipcRenderer.invoke('codeclub:floating-pointer',inside),
  sessionList: () => ipcRenderer.invoke('codeclub:sessions-list'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  integrationConfig: () => ipcRenderer.invoke('codeclub:integration-config'),
  integrationSave: (config) => ipcRenderer.invoke('codeclub:integration-save',config),
  hooksPreview: () => ipcRenderer.invoke('codeclub:hooks-preview'),
  hooksInstall: (id) => ipcRenderer.invoke('codeclub:hooks-install',id),
  credentialPresent: (key) => ipcRenderer.invoke('codeclub:credential-present',key),
  credentialSet: (key,value,origin) => ipcRenderer.invoke('codeclub:credential-set',key,value,origin),
  openExternal: (url) => ipcRenderer.invoke('codeclub:external-open',url),
  sessionSelect: (chat) => ipcRenderer.invoke('codeclub:session-select',chat),
  sessionSelected: () => ipcRenderer.invoke('codeclub:session-selected'),
  sessionClaim: (chat) => ipcRenderer.invoke('codeclub:session-claim',chat),
  sessionPublish: (chat,runId,update) => ipcRenderer.invoke('codeclub:session-publish',chat,runId,update),
  sessionCommand: (chat,action,approvalId) => ipcRenderer.invoke('codeclub:session-command',chat,action,approvalId),
  sessionOpen: (chat) => ipcRenderer.invoke('codeclub:session-open',chat),
  onSessions: (handler) => { const listener=(_event,items)=>handler(items);ipcRenderer.on('codeclub:sessions',listener);return ()=>ipcRenderer.removeListener('codeclub:sessions',listener); },
  onSessionCommand: (handler) => { const listener=(_event,command)=>handler(command);ipcRenderer.on('codeclub:session-command',listener);return ()=>ipcRenderer.removeListener('codeclub:session-command',listener); },
  onSessionOpen: (handler) => { const listener=(_event,chat)=>handler(chat);ipcRenderer.on('codeclub:session-open',listener);return ()=>ipcRenderer.removeListener('codeclub:session-open',listener); },
  floatingDrag: (phase, point) => ipcRenderer.invoke('codeclub:floating-drag', phase, point),
  floatingOpenMain: () => ipcRenderer.invoke('codeclub:floating-open-main'),
  onMainShow: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('codeclub:main-show', listener);
    return () => ipcRenderer.removeListener('codeclub:main-show', listener);
  },
  onFloatingShow: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('codeclub:floating-show', listener);
    return () => ipcRenderer.removeListener('codeclub:floating-show', listener);
  },
  reloadApp: () => ipcRenderer.invoke('app:reload'),
  getAutoUpdateStatus: () => ipcRenderer.invoke('app:update-status'),
  checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
  installUpdate: () => ipcRenderer.invoke('app:install-update'),
  onAutoUpdate: (handler) => {
    const listener = (_event, state) => handler(state);
    ipcRenderer.on('app:auto-update', listener);
    return () => ipcRenderer.removeListener('app:auto-update', listener);
  },
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
