import { createAppIpcRegistrar } from './ipc/register.js';
import { registerSettingsIpc } from './ipc/settings.js';
import { registerChatIpc } from './ipc/chats.js';
import { registerFileIpc } from './ipc/files.js';
import { nativeText, setNativeLanguage } from './i18n/index.js';
/** Privileged desktop boundary: owns windows, filesystem, processes, and IPC handlers used by the renderer preload. */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, safeStorage, screen, shell, Tray } from 'electron';
import { runProjectCommand } from './run-command.js';
import { readProjectGit } from './git-read.js';
import { isInsidePath, listProjectFiles, projectStorageKey, resolveProjectFile, searchProjectText } from './project-files.js';
import { listAgentPlugins, normalizePluginScope, pluginDirectory, safePluginFile, validPluginId } from './plugin-store.js';
import { TaskScheduler, type ScheduledTask, type TaskRun } from './task-scheduler.js';
import { CredentialVault } from './credential-vault.js';
import { requestAndroidPin } from './android-pin.js';
import { ActivityIntegrations } from './activity-integrations.js';
import { AgentRelay } from './agent-relay.js';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { SettingsStore } from './settings-store.js';
import { MobileSync } from './mobile-sync.js';
import { ChatStore } from './chat-store.js';
import { SessionHub, type SessionChat } from './session-hub.js';
import { spawn } from 'node:child_process';
import { createMcpSession } from './mcp-session.js';
import { userInfo } from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import electronUpdater from 'electron-updater';
import { createComputerUse } from './computer-use.js';
import { createComputerOverlayController } from './computer-overlay.js';
import { createAndroidUse } from './android-use.js';
import { AndroidCompanion } from './android-companion.js';
import { createExternalBrowserControl } from './external-browser.js';
import { EDGE_EXTENSION_ID, edgeExtensionPage } from './browser-extension-config.js';
import { createBrowserExtensionBridge } from './browser-extension-bridge.js';
import { createFloatingChat } from './floating-chat.js';
import { isAdministrator, launchAdministrator, foregroundApplication } from './administrator.js';
import { OrbLearning, proactiveOrbTask, type LearningOrb } from './orb-learning.js';
const { autoUpdater } = electronUpdater;

type Project = { id: string; name: string; path: string; createdAt: string; lastOpenedAt?: string };

// Shared build root in development and inside app.asar: build/electron -> build.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownsAppInstance = app.requestSingleInstanceLock();
if (!ownsAppInstance) app.quit();
app.on('second-instance', () => showMainWindow());
const desktopControl = createComputerUse(app.getAppPath(), app.isPackaged ? process.resourcesPath : undefined);
const androidControls = new Map<number, ReturnType<typeof createAndroidUse>>();
const androidPairingOwners = new Set<number>();
const androidPinLabels = new Map<number, Parameters<typeof requestAndroidPin>[1]>();
let androidCompanion: AndroidCompanion;
const browserExtensionBridge = createBrowserExtensionBridge();
const externalBrowserControl = createExternalBrowserControl(browserExtensionBridge);
const browserExtensionManagers = {
  edge: { name: 'Microsoft Edge', page: 'edge://extensions/', executable: ['Microsoft/Edge/Application/msedge.exe'] },
  chrome: { name: 'Google Chrome', page: 'chrome://extensions/', executable: ['Google/Chrome/Application/chrome.exe'] },
  brave: { name: 'Brave', page: 'brave://extensions/', executable: ['BraveSoftware/Brave-Browser/Application/brave.exe'] },
  opera: { name: 'Opera', page: 'opera://extensions/', executable: ['Programs/Opera/launcher.exe', 'Opera/launcher.exe'] },
  vivaldi: { name: 'Vivaldi', page: 'vivaldi://extensions/', executable: ['Vivaldi/Application/vivaldi.exe'] },
} as const;
type BrowserExtensionManagerId = keyof typeof browserExtensionManagers;
const browserExecutableCandidates = (id: BrowserExtensionManagerId) => {
  const executablePaths = browserExtensionManagers[id].executable;
  const roots = [process.env['PROGRAMFILES(X86)'], process.env.PROGRAMFILES, process.env.LOCALAPPDATA].filter((root): root is string => Boolean(root));
  return roots.flatMap(root => executablePaths.map(relative => path.join(root, relative)));
};
const findBrowserExecutable = async (id: BrowserExtensionManagerId) => {
  for (const candidate of browserExecutableCandidates(id)) {
    try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch { /* Continue through the standard install locations. */ }
  }
  return null;
};
const prepareBrowserExtension = async () => {
  const source = path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'browser-extension');
  const destination = path.join(app.getPath('userData'), 'browser-extension');
  await fs.access(path.join(source, 'manifest.json'));
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
  return destination;
};
let projects: Project[] = [];
let mainWindow: BrowserWindow | null = null;
type FullscreenRestore = { bounds: Electron.Rectangle; displayId: number; maximized: boolean };
let fullscreenRestore: FullscreenRestore | null = null;
let fullscreenTransition: 'entering' | 'leaving' | null = null;
let floatingChat: ReturnType<typeof createFloatingChat> | null = null;
let tray: Tray | null = null;
let isQuitting = false;
let administratorRestartPending = false;
let orbLearning: OrbLearning | undefined;
let orbLearningLanguage: 'es' | 'en' = 'es';
let orbLearningOrbs: () => LearningOrb[] = () => [];
const orbLearningActive = () => Boolean(!isQuitting && mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized() && powerMonitor.getSystemIdleTime() < 300 && powerMonitor.getSystemIdleState(300) !== 'locked');
let selectedSessionChat: SessionChat | null = null;
let credentialVault: CredentialVault;
let taskScheduler: TaskScheduler | undefined;
const taskWorkers = new Map<number, { window: BrowserWindow; task: ScheduledTask; run: TaskRun; controller: AbortController; terminals: Set<string>; complete: (error?: string) => void }>();
const modelRequests=new Map<string,AbortController>();
const sessionHub = new SessionHub(() => {
  if(isQuitting)return;
  for (const win of BrowserWindow.getAllWindows()) {
    if(win.isDestroyed() || win.webContents.isDestroyed())continue;
    if (win !== mainWindow && !floatingChat?.owns(win.webContents)) continue;
    win.webContents.send('codeclub:sessions', sessionHub.list().map(session => ({...session,localOwner:session.owner===win.webContents.id})));
  }
});
function requireAppSender(event: Electron.IpcMainInvokeEvent) {
  if (event.sender !== mainWindow?.webContents && !floatingChat?.owns(event.sender) && !taskWorkers.has(event.sender.id)) throw new Error('Unauthorized renderer');
}
const handleApp = createAppIpcRegistrar(ipcMain, requireAppSender);
function requireTaskUi(event: Electron.IpcMainInvokeEvent) {
  requireAppSender(event);
  if (taskWorkers.has(event.sender.id)) throw new Error('Unauthorized scheduler management');
}
function publishTaskChange() {
  if (isQuitting) return;
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.webContents.isDestroyed() && !taskWorkers.has(win.webContents.id)) win.webContents.send('codeclub:scheduled-tasks-changed');
}
async function executeScheduledTask(task: ScheduledTask, run: TaskRun): Promise<void> {
  if (task.proactive && (!orbLearningActive() || !orbLearningOrbs().some(orb => orb.id === task.orbId && orb.maximumAutonomy === true))) throw new Error('TASK_CANCELLED');
  // A saved preference is not an administrator token. Recheck every execution.
  if (task.requiresAdministrator && task.allowComputer !== false && !(await isAdministrator())) throw new Error('TASK_ADMIN_REQUIRED');
  return new Promise((resolve, reject) => {
    const worker = new BrowserWindow({ show: false, webPreferences: { preload: path.join(root, '..', 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, webviewTag: true, backgroundThrottling: false } });
    const owner = worker.webContents.id;
    const controller = new AbortController();
    const terminals = new Set<string>();
    let done = false;
    const complete = (error?: string) => {
      if (done) return; done = true; clearTimeout(timeout);
      controller.abort();
      if (error) for (const id of terminals) { const terminal = nativeTerminals.get(id); if (terminal) { try { terminal.child.kill(); } catch { /* PTY already exited. */ } } }
      taskWorkers.delete(owner); sessionHub.disconnect(owner);
      for (const [key, controller] of modelRequests) if (key.startsWith(`${owner}:`)) controller.abort();
      if (!worker.isDestroyed()) worker.destroy();
      if (error) reject(new Error(error)); else resolve();
    };
    const timeout = setTimeout(() => complete('TASK_TIMEOUT'), 30 * 60 * 1000);
    taskWorkers.set(owner, { window: worker, task, run, controller, terminals, complete });
    worker.webContents.on('render-process-gone', () => complete('TASK_INTERRUPTED'));
    worker.on('closed', () => complete('TASK_INTERRUPTED'));
    const devUrl = process.env.CODECLUB_NEXT_DEV_URL;
    const loading = devUrl ? worker.loadURL(`${devUrl.replace(/\/$/, '')}/?scheduledRunner=1`) : worker.loadFile(path.join(root, 'renderer', 'index.html'), { query: { scheduledRunner: '1' } });
    void loading.catch(() => complete('TASK_RUNNER_UNAVAILABLE'));
  });
}
type AutoUpdateState = { state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'; version?: string; percent?: number; error?: string };
let autoUpdateState: AutoUpdateState = { state: 'idle' };
const activeCommands = new Set<() => void>();
type NativeMcpSession = ReturnType<typeof createMcpSession>;
const nativeMcpSessions = new Map<string, NativeMcpSession>();
type NativeTerminal = { child: pty.IPty; info: any; buffer: string; bufferOffset: number };
const nativeTerminals = new Map<string, NativeTerminal>();

const { setComputerOverlay, destroyComputerOverlay, handleComputerMenuAction, updateComputerOverlayPalette } = createComputerOverlayController(root,
  () => { desktopControl.stop(); mainWindow?.webContents.send('computer:escape'); },
  payload => mainWindow?.webContents.send('computer:context-action', payload),
);

const projectsFile = () => path.join(app.getPath('userData'), 'projects.json');
const projectId = (value: string) => value.toLowerCase().replace(/[\\/:*?"<>|\s]+/g, '-');
async function loadProjects() { try { projects = JSON.parse(await fs.readFile(projectsFile(), 'utf8')); } catch { projects = []; } }
async function saveProjects() { await fs.mkdir(path.dirname(projectsFile()), { recursive: true }); await fs.writeFile(projectsFile(), JSON.stringify(projects, null, 2) + '\n', 'utf8'); }
function registerProject(folder: string): Project { const existing = projects.find((item) => item.path.toLowerCase() === folder.toLowerCase()); if (existing) return existing; const project = { id: projectId(folder), name: path.basename(folder) || folder, path: folder, createdAt: new Date().toISOString() }; projects = [...projects, project]; return project; }

const replacePluginVariables = (value: string, root: string, data: string) => String(value || '').replaceAll('${PLUGIN_ROOT}', root).replaceAll('${PLUGIN_DATA}', data);
async function startMcpSession(request: any) {
  const root = await fs.realpath(path.resolve(String(request.pluginRoot)));
  const dataPath = path.resolve(String(request.pluginData));
  await fs.mkdir(dataPath, { recursive: true });
  const data = await fs.realpath(dataPath);
  const command = replacePluginVariables(request.command || '', root, data);
  if (!command) throw new Error('MCP requiere un comando.');
  let commandPath = command;
  if (/^\.([\\/])/.test(command)) {
    commandPath = await fs.realpath(path.resolve(root, command));
    if (!isInsidePath(root, commandPath)) throw new Error('command escapa del plugin.');
  }
  const cwd = path.resolve(replacePluginVariables(request.cwd || root, root, data));
  const realCwd = await fs.realpath(cwd);
  if ((!isInsidePath(root, cwd) && !isInsidePath(data, cwd)) || (!isInsidePath(root, realCwd) && !isInsidePath(data, realCwd))) throw new Error('cwd escapa del plugin o de PLUGIN_DATA.');
  const env = { ...process.env, ...Object.fromEntries(Object.entries(request.env || {}).map(([key, value]) => [key, replacePluginVariables(String(value), root, data)])), PLUGIN_ROOT: root, PLUGIN_DATA: data } as NodeJS.ProcessEnv;
  const child = spawn(commandPath, (request.args || []).map((value: string) => replacePluginVariables(value, root, data)), { cwd: realCwd, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath) });
  const session = createMcpSession(child);
  try {
    await session.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Codeclub', version: app.getVersion() } }, 15000);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const tools = await session.request('tools/list', {}, 15000);
    const sessionId = `mcp-${randomUUID()}`;
    nativeMcpSessions.set(sessionId, session);
    child.once('exit', () => nativeMcpSessions.delete(sessionId));
    return { sessionId, tools: tools?.tools || [] };
  } catch (error) { session.close(); throw error; }
}

function shellCommand(shell: string) {
  if (shell === 'cmd') return { command: 'cmd.exe', args: ['/K'], label: 'Command Prompt' };
  if (shell === 'git-bash') return { command: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'], label: 'Git Bash' };
  if (shell === 'wsl') return { command: 'wsl.exe', args: [], label: 'WSL2' };
  return { command: 'powershell.exe', args: ['-NoLogo'], label: 'PowerShell' };
}

async function createNativeTerminal(request: any) {
  const shell = shellCommand(request.shell || 'powershell');
  let cwd = path.resolve(request.cwd || request.projectPath || process.cwd());
  if (request.isAgent) cwd = await resolveProjectFile(String(request.projectPath || ''), String(request.cwd || '.'));
  else cwd = await fs.realpath(cwd);
  if (!(await fs.stat(cwd)).isDirectory()) throw new Error('La carpeta de inicio de la terminal no es válida.');
  const id = `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const child = pty.spawn(shell.command, shell.args, { name: 'xterm-color', cols: 120, rows: 40, cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' } as Record<string, string> });
  const info = { id, name: String(request.name || 'Terminal'), shell: shell.label, cwd, projectPath: request.projectPath, is_agent: Boolean(request.isAgent), created_at: String(Date.now()), status: 'running' };
  const session: NativeTerminal = { child, info, buffer: '', bufferOffset: 0 };
  const append = (data: string) => {
    session.buffer += data;
    if (session.buffer.length > 240000) {
      const removed = session.buffer.length - 240000;
      session.buffer = session.buffer.slice(removed);
      session.bufferOffset += removed;
    }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('codeclub:terminal-output', { id });
    }
  };
  child.onData(append);
  child.onExit(() => { session.info.status = 'exited'; });
  nativeTerminals.set(id, session);
  return info;
}

async function invokeNativeCommand(command: string, args: any = {}, signal?: AbortSignal) {
  switch (command) {
    case 'codeclub_get_username': {
      try { return process.env.CODECLUB_USERNAME || userInfo().username || process.env.USERNAME || 'Usuario'; } catch { return process.env.CODECLUB_USERNAME || process.env.USERNAME || 'Usuario'; }
    }
    case 'codeclub_open_external': {
      const url = String(args.url || '');
      if (!/^https:\/\//i.test(url)) throw new Error('Solo se permiten enlaces HTTPS externos.');
      await shell.openExternal(url);
      return true;
    }
    case 'codeclub_get_app_version': return app.getVersion();
    case 'codeclub_browser_extension_info': {
      // A socket hello alone does not prove that the companion can serve requests.
      const connections = await Promise.all(browserExtensionBridge.list().map(async client => {
        try { await browserExtensionBridge.tabs(client.browserId); return client; } catch { return null; }
      }));
      const browsers = await Promise.all((Object.keys(browserExtensionManagers) as BrowserExtensionManagerId[]).map(async id => ({
        id,
        name: browserExtensionManagers[id].name,
        installed: Boolean(await findBrowserExecutable(id)),
        connected: connections.some(client => {
          if (!client) return false;
          const name = client.name.toLowerCase();
          return id === 'edge' ? name.includes('edge') : id === 'chrome' ? name.includes('chrome') : id === 'brave' ? name.includes('brave') : id === 'opera' ? name.includes('opera') : name.includes('vivaldi');
        }),
      })));
      return { browsers, extensionId: EDGE_EXTENSION_ID };
    }
    case 'codeclub_browser_extension_manage': {
      if (process.platform !== 'win32') throw new Error('El instalador de extensiones está disponible en Windows.');
      const id = String(args.browser || '') as BrowserExtensionManagerId;
      if (!Object.hasOwn(browserExtensionManagers, id)) throw new Error('Navegador no compatible.');
      if (!['install', 'uninstall'].includes(String(args.action || ''))) throw new Error('Acción de extensión inválida.');
      const browser = browserExtensionManagers[id];
      const executable = await findBrowserExecutable(id);
      if (!executable) throw new Error(`${browser.name} no está instalado en este equipo.`);
      const extensionPath = args.action === 'install' && id !== 'edge' ? await prepareBrowserExtension() : undefined;
      const targetUrl = id === 'edge' ? edgeExtensionPage(args.action as 'install' | 'uninstall') : browser.page;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, [targetUrl], { detached: true, stdio: 'ignore', windowsHide: false });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      if (extensionPath) {
        const error = await shell.openPath(extensionPath);
        if (error) throw new Error(`No se pudo abrir la carpeta de la extensión: ${error}`);
      }
      return { ok: true, browser: id, action: args.action === 'install' ? 'install' : 'uninstall', extensionPath };
    }
    case 'codeclub_git_read': {
      let root: string;
      try { root = await resolveProjectFile(String(args.projectPath || ''), '.'); } catch (error: any) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { code: 1, stdout: '', stderr: 'La carpeta del proyecto ya no está disponible.' };
        throw error;
      }
      return readProjectGit(root, args, signal);
    }
    case 'codeclub_list_files': return listProjectFiles(String(args.projectPath || ''), Number(args.maxFiles) || 400);
    case 'codeclub_path_kind': {
      try {
        const target = await resolveProjectFile(String(args.projectPath || ''), String(args.path || '.'));
        const stat = await fs.stat(target);
        return { kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other' };
      } catch (error: any) {
        if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
        return { kind: 'missing' };
      }
    }
    case 'codeclub_read_file': return fs.readFile(await resolveProjectFile(String(args.projectPath || ''), String(args.path || '')), 'utf8');
    case 'codeclub_search_text': return searchProjectText(String(args.projectPath || ''), String(args.query || ''), Number(args.maxMatches) || 80);
    case 'codeclub_write_file': {
      let target = await resolveProjectFile(String(args.projectPath || ''), String(args.path || ''), true);
      await fs.mkdir(path.dirname(target), { recursive: true });
      target = await resolveProjectFile(String(args.projectPath || ''), String(args.path || ''), true);
      await fs.writeFile(target, String(args.content ?? ''), 'utf8');
      return { ok: true, path: args.path };
    }
    case 'codeclub_run_command': {
      const request = args.request || {};
      const cwd = await resolveProjectFile(String(args.projectPath || ''), String(request.cwd || '.'));
      return runProjectCommand(request, cwd, activeCommands, signal);
    }
    case 'codeclub_mcp_stdio_start': return startMcpSession(args.request || {});
    case 'codeclub_mcp_stdio_call': {
      const request = args.request || {};
      const session = nativeMcpSessions.get(request.sessionId);
      if (!session) throw new Error('Sesión MCP inexistente.');
      return session.request('tools/call', { name: request.name, arguments: request.arguments || {} });
    }
    case 'codeclub_mcp_stdio_close': {
      const session = nativeMcpSessions.get(String(args.sessionId));
      if (session) { session.close(); nativeMcpSessions.delete(String(args.sessionId)); }
      return null;
    }
    case 'codeclub_agent_plugin_data': {
      const pluginId = String(args.pluginId || '').trim().toLowerCase();
      const scope = normalizePluginScope(args.scope, String(args.projectPath || ''));
      const dataRoot = scope === 'project' ? path.join('projects', projectStorageKey(String(args.projectPath || ''))) : 'global';
      if (!validPluginId(pluginId)) throw new Error('El identificador del plugin no es válido.');
      const target = path.join(app.getPath('userData'), 'agent-plugins', dataRoot, pluginId);
      await fs.mkdir(target, { recursive: true });
      return target;
    }
    case 'codeclub_agent_plugin_read_file': {
      const projectPath = String(args.projectPath || '');
      const scope = normalizePluginScope(args.scope, projectPath);
      const target = await safePluginFile(scope, projectPath, String(args.pluginId || '').trim().toLowerCase(), String(args.path || ''));
      return { content: await fs.readFile(target, 'utf8'), scope, pluginPath: pluginDirectory(scope, projectPath, String(args.pluginId || '').trim().toLowerCase()) };
    }
    case 'codeclub_agent_plugin_write_file': {
      const projectPath = String(args.projectPath || '');
      const scope = normalizePluginScope(args.scope, projectPath);
      const pluginId = String(args.pluginId || '').trim().toLowerCase();
      let target = await safePluginFile(scope, projectPath, pluginId, String(args.path || ''), true);
      await fs.mkdir(path.dirname(target), { recursive: true });
      target = await safePluginFile(scope, projectPath, pluginId, String(args.path || ''));
      await fs.writeFile(target, String(args.content ?? ''), 'utf8');
      return { ok: true, path: String(args.path || ''), absolutePath: target, scope, pluginPath: pluginDirectory(scope, projectPath, pluginId) };
    }
    case 'codeclub_agent_plugin_remove_skill': {
      const projectPath = String(args.projectPath || '');
      const scope = normalizePluginScope(args.scope, projectPath);
      const pluginId = String(args.pluginId || '').trim().toLowerCase();
      const skillId = String(args.skillId || '');
      if (!/^[a-zA-Z0-9_-]+$/.test(skillId)) throw new Error('Identificador de skill inválido.');
      const root = pluginDirectory(scope, projectPath, pluginId);
      const target = await safePluginFile(scope, projectPath, pluginId, `skills/${skillId}`);
      const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(target)]);
      const relative = path.relative(realRoot, realTarget);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('La skill queda fuera del plugin.');
      await fs.rm(target, { recursive: true, force: false });
      return { ok: true, pluginId, skillId, scope };
    }
    case 'codeclub_delete_agent_plugin': {
      const projectPath = String(args.projectPath || '');
      const scope = normalizePluginScope(args.scope, projectPath);
      const pluginId = String(args.pluginId || '').trim().toLowerCase();
      const target = pluginDirectory(scope, projectPath, pluginId);
      await fs.rm(target, { recursive: true, force: true });
      return { ok: true, deleted: pluginId, scope, pluginPath: target };
    }
    case 'codeclub_list_agent_plugins': return listAgentPlugins(String(args.projectPath || ''));
    case 'codeclub_terminal_list': return Array.from(nativeTerminals.values()).map((session) => session.info);
    case 'codeclub_terminal_create': return createNativeTerminal(args.request || {});
    case 'codeclub_terminal_snapshot': {
      const session = nativeTerminals.get(String(args.id));
      if (!session) throw new Error('Terminal no encontrada.');
      const nextOffset = session.bufferOffset + session.buffer.length;
      // AI reads a plain log; the visible terminal keeps its original VT stream.
      const format = (output: string) => args.plainText === true ? stripVTControlCharacters(output).replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n') : output;
      if (Number.isFinite(Number(args.offset))) {
        const offset = Math.max(0, Math.floor(Number(args.offset)));
        const truncated = offset < session.bufferOffset;
        const start = truncated ? 0 : Math.min(session.buffer.length, offset - session.bufferOffset);
        return { info: session.info, output: format(session.buffer.slice(start)), offset: nextOffset, truncated };
      }
      return { info: session.info, output: format(session.buffer), offset: nextOffset, truncated: false };
    }
    case 'codeclub_terminal_write': {
      const session = nativeTerminals.get(String(args.id));
      if (!session) throw new Error('Terminal no encontrada.');
      session.child.write(String(args.data || ''));
      return null;
    }
    case 'codeclub_terminal_resize': {
      const session = nativeTerminals.get(String(args.id));
      if (!session) throw new Error('Terminal no encontrada.');
      const cols = Math.max(2, Math.floor(Number(args.cols) || 0));
      const rows = Math.max(2, Math.floor(Number(args.rows) || 0));
      if (!Number.isFinite(cols) || !Number.isFinite(rows)) throw new Error('Tamaño de terminal inválido.');
      session.child.resize(cols, rows);
      return null;
    }
    case 'codeclub_terminal_rename': {
      const session = nativeTerminals.get(String(args.id));
      if (!session) throw new Error('Terminal no encontrada.');
      session.info.name = String(args.name || 'Terminal').trim().slice(0, 40) || 'Terminal';
      return session.info;
    }
    case 'codeclub_terminal_stop': {
      const session = nativeTerminals.get(String(args.id));
      if (!session) throw new Error('Terminal no encontrada.');
      session.child.kill(); session.info.status = 'stopped'; return session.info;
    }
    case 'codeclub_terminal_delete': {
      const session = nativeTerminals.get(String(args.id));
      if (session) { session.child.kill(); nativeTerminals.delete(String(args.id)); }
      return null;
    }
    case 'codeclub_computer_list_windows': return desktopControl.computer.run('windows');
    case 'codeclub_computer_screenshot': return desktopControl.computer.run('screenshot', args.request || {});
    case 'codeclub_computer_get_state': return desktopControl.computer.run('state', args.request || {});
    case 'codeclub_computer_action': return desktopControl.computer.run('action', args.request || {});
    case 'codeclub_computer_ocr': return desktopControl.computer.run('ocr', args.request || {});
    case 'codeclub_computer_stop': desktopControl.stop(); return { ok: true };
    case 'codeclub_external_browser_list': return externalBrowserControl.list(args.request || {});
    case 'codeclub_external_browser_state': return externalBrowserControl.getState(args.request || {});
    case 'codeclub_external_browser_tabs': return externalBrowserControl.manageTabs(args.request || {});
    case 'codeclub_external_browser_action': return externalBrowserControl.action(args.request || {});
    case 'codeclub_http_fetch': {
      const request = args.request || {};
      const url = String(request.url || '');
      if (!/^https?:\/\//i.test(url)) throw new Error('Solo se permiten URLs HTTP o HTTPS.');
      const requestHeaders = new Headers(Object.fromEntries(Array.isArray(request.headers) ? request.headers.map((header: any) => [String(header.name), String(header.value)]) : []));
      if(request.credentialKey){const secret=credentialVault.authorization(String(request.credentialKey),url);if(secret){if(new URL(url).hostname==='generativelanguage.googleapis.com'){requestHeaders.delete('authorization');requestHeaders.set('x-goog-api-key',secret);}else requestHeaders.set('authorization',`Bearer ${secret}`);}}
      const controller=new AbortController();
      const requestId=String(request.requestId||randomUUID());
      modelRequests.set(requestId,controller);
      try {
      const response = await fetch(url, {
        method: String(request.method || 'GET'),
        headers: requestHeaders,
        redirect: request.credentialKey?'error':'follow',
        body: request.body == null ? undefined : String(request.body),
        signal:controller.signal,
      });
      const headers: Array<{ name: string; value: string }> = [];
      response.headers.forEach((value, name) => headers.push({ name, value }));
      return { status: response.status, status_text: response.statusText, headers, body: await response.text() };
      } finally {modelRequests.delete(requestId);}
    }
    case 'codeclub_get_system_root': return process.platform === 'win32' ? `${process.env.SystemDrive || 'C:'}\\` : '/';
    default: throw new Error(`El comando nativo ${command} todavía no está implementado en Electron.`);
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  floatingChat?.hide();
  mainWindow.show();
  mainWindow.focus();
  if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) mainWindow.maximize();
  mainWindow.webContents.send('codeclub:main-show');
}

function toggleMainFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed() || fullscreenTransition) return;
  if (mainWindow.isFullScreen()) {
    fullscreenTransition = 'leaving';
    mainWindow.setFullScreen(false);
    return;
  }
  const bounds = mainWindow.getNormalBounds();
  fullscreenRestore = { bounds, displayId: screen.getDisplayMatching(bounds).id, maximized: mainWindow.isMaximized() };
  fullscreenTransition = 'entering';
  mainWindow.setFullScreen(true);
}

function restoreWindowAfterFullscreen() {
  if (!mainWindow || mainWindow.isDestroyed() || !fullscreenRestore) return;
  const restore = fullscreenRestore;
  fullscreenRestore = null;
  const displays = screen.getAllDisplays();
  const savedDisplay = displays.find((display) => display.id === restore.displayId);
  const display = savedDisplay || screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(restore.bounds.width, area.width);
  const height = Math.min(restore.bounds.height, area.height);
  const bounds = savedDisplay ? {
    x: Math.min(Math.max(restore.bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(restore.bounds.y, area.y), area.y + area.height - height),
    width,
    height,
  } : {
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    width,
    height,
  };

  if (restore.maximized && savedDisplay) {
    if (!mainWindow.isMaximized()) mainWindow.maximize();
    return;
  }
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  mainWindow.setBounds(bounds, false);
  if (restore.maximized) mainWindow.maximize();
}

function updateTrayMenu() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: nativeText('tray.open'), click: showMainWindow },
    { label: nativeText('tray.widget'), click: () => {
      if (!floatingChat?.isActive()) { mainWindow?.hide(); void floatingChat?.show().catch(() => showMainWindow()); }
      else floatingChat?.hide();
    } },
    { type: 'separator' },
    { label: nativeText('tray.quit'), click: () => { isQuitting = true; app.quit(); } },
  ]));
}

function createTray() {
  const iconPath = path.join(root, '..', 'public', 'icono', '256.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Codeclub');
  updateTrayMenu();
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function createWindow() {
  const iconPath = path.join(root, '..', 'public', 'icono', '512.png');
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    transparent: true,
    icon: iconPath,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(root, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F11') return;
    event.preventDefault();
    toggleMainFullscreen();
  });
  mainWindow.on('enter-full-screen', () => {
    fullscreenTransition = null;
    mainWindow?.webContents.send('window:fullscreen-change', true);
  });
  mainWindow.on('leave-full-screen', () => {
    restoreWindowAfterFullscreen();
    fullscreenTransition = null;
    mainWindow?.webContents.send('window:fullscreen-change', false);
  });
  if (process.platform === 'win32' && typeof mainWindow.setBackgroundMaterial === 'function') mainWindow.setBackgroundMaterial('acrylic');
  mainWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); mainWindow?.hide(); void floatingChat?.show().catch(() => showMainWindow()); } });
  const ownerId=mainWindow.webContents.id;
  mainWindow.webContents.on('destroyed', () => sessionHub.disconnect(ownerId));
  mainWindow.webContents.on('render-process-gone', () => sessionHub.disconnect(ownerId));
  mainWindow.once('ready-to-show', () => {
    showMainWindow();
    if (accessibilityDebugMode) mainWindow?.webContents.openDevTools({ mode: 'detach' });
  });
  const devUrl = process.env.CODECLUB_NEXT_DEV_URL;
  const orbSetup = process.argv.includes('--orb-admin-setup');
  const orbQuery = orbSetup ? { orbSetup: '1', orbComputer: '1', orbMaximumAutonomy: process.argv.includes('--orb-maximum-autonomy=1') ? '1' : '0' } : undefined;
  if (devUrl) {
    const url = new URL(devUrl);
    if (orbQuery) for (const [key, value] of Object.entries(orbQuery)) url.searchParams.set(key, value);
    void mainWindow.loadURL(url.toString());
  } else void mainWindow.loadFile(path.join(root, 'renderer', 'index.html'), { query: orbQuery });
}

function publishAutoUpdate(state: AutoUpdateState) {
  autoUpdateState = state;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('app:auto-update', state);
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.on('checking-for-update', () => publishAutoUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => publishAutoUpdate({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => publishAutoUpdate({ state: 'not-available' }));
  autoUpdater.on('download-progress', (progress) => publishAutoUpdate({ state: 'downloading', version: autoUpdateState.version, percent: progress.percent }));
  autoUpdater.on('update-downloaded', (info) => publishAutoUpdate({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (error) => publishAutoUpdate({ state: 'error', error: error instanceof Error ? error.message : String(error) }));
  const check = () => {
    if (['checking', 'downloading', 'downloaded'].includes(autoUpdateState.state)) return;
    void autoUpdater.checkForUpdates().catch((error) => publishAutoUpdate({ state: 'error', error: error instanceof Error ? error.message : String(error) }));
  };
  check();
  setInterval(check, 15 * 60 * 1000);
}

app.setAppUserModelId('com.codeclub.desktop');
// Expose Chromium's accessibility tree to Windows UI Automation and Computer Use.
app.commandLine.appendSwitch('force-renderer-accessibility');
const accessibilityDebugMode = !app.isPackaged && app.commandLine.hasSwitch('codeclub-a11y-debug');
app.whenReady().then(async () => {
  if (!ownsAppInstance) return;
  if (accessibilityDebugMode) app.setAccessibilitySupportEnabled(true);
  void browserExtensionBridge.start();
  app.once('will-quit', () => browserExtensionBridge.stop());
  credentialVault=new CredentialVault(app.getPath('userData'),safeStorage);
  androidCompanion=new AndroidCompanion(app.getPath('userData'),safeStorage);
  void androidCompanion.resume().catch(()=>undefined);
  credentialVault.migrate(path.join(app.getPath('userData'),'settings.json'));
  taskScheduler = new TaskScheduler(path.join(app.getPath('userData'), 'scheduled-tasks.json'), executeScheduledTask, publishTaskChange, (task, run) => {
    if (!task.proactive) orbLearning?.observeOutcome(run.status === 'completed' ? 'task-completed' : 'task-failed');
    if (task.notifications === 'Sin notificaciones' || (task.notifications === 'Solo errores' && run.status === 'completed')) return;
    if (Notification.isSupported()) {
      const notice = new Notification({ title: task.name, body: nativeText(run.status === 'completed' ? 'tasks.completed' : 'tasks.attention', task.language) });
      notice.on('click', () => { selectedSessionChat = { chatId: run.chatId, projectPath: task.projectPath, name: task.name }; showMainWindow(); }); notice.show();
    }
  });
  handleApp('codeclub:tasks-list', (event, projectPath: string) => { requireTaskUi(event); return taskScheduler!.list(String(projectPath || '')); });
  handleApp('codeclub:tasks-save', async (event, projectPath: string, task: ScheduledTask) => {
    requireTaskUi(event);
    if (projectPath && !(await fs.stat(path.resolve(projectPath))).isDirectory()) throw new Error('TASK_INVALID_PROJECT');
    return taskScheduler!.save(String(projectPath || ''), task);
  });
  handleApp('codeclub:tasks-delete', (event, projectPath: string, id: string) => { requireTaskUi(event); return taskScheduler!.remove(String(projectPath || ''), id); });
  handleApp('codeclub:tasks-run', (event, projectPath: string, id: string) => { requireTaskUi(event); return taskScheduler!.run(String(projectPath || ''), id); });
  handleApp('codeclub:tasks-cancel', (event, projectPath: string, id: string) => {
    requireTaskUi(event);
    if (taskScheduler!.cancelQueued(projectPath, id)) return true;
    const task = taskScheduler!.list(projectPath).find(task => task.id === id);
    const run = task?.runs.find(run => run.status === 'running');
    if (!run) return false;
    const command = sessionHub.command({ chatId: run.chatId, projectPath }, 'cancel');
    const worker = command && taskWorkers.get(command.owner);
    if (worker?.task.autonomous) worker.complete('TASK_CANCELLED');
    else if (worker) { worker.controller.abort(); worker.window.webContents.send('codeclub:session-command', command); }
    else for (const worker of taskWorkers.values()) if (worker.run.id === run.id) worker.complete('TASK_CANCELLED');
    return true;
  });
  handleApp('codeclub:task-assignment', event => { const worker = taskWorkers.get(event.sender.id); return worker ? { task: worker.task, run: worker.run } : null; });
  handleApp('codeclub:task-finish', (event, error?: string) => { const worker = taskWorkers.get(event.sender.id); if (!worker) throw new Error('Unauthorized task runner'); worker.complete(error); });
  const integrations=new ActivityIntegrations(path.join(app.getPath('userData'),'activity-integrations.json'),credentialVault,sessionHub);
  const relayHelper=app.isPackaged?path.join(process.resourcesPath,'agent-relay.ps1'):path.join(root,'..','electron','agent-relay.ps1');
  const relay=new AgentRelay(app.getPath('userData'),relayHelper,sessionHub);
  const updateRelay=()=>{if(integrations.getConfig().externalAgents&&!integrations.getConfig().paused)void relay.start().catch(()=>sessionHub.external('relay-status','External agents','error'));else relay.stop();};
  handleApp('codeclub:integration-config',event=>{requireAppSender(event);return integrations.getConfig();});
  handleApp('codeclub:integration-save',(event,config)=>{requireAppSender(event);const saved=integrations.save(config);updateRelay();return saved;});
  handleApp('codeclub:hooks-preview',async event=>{requireAppSender(event);const result=await dialog.showOpenDialog({properties:['openDirectory']});if(result.canceled||!result.filePaths[0])return null;return relay.preview(result.filePaths[0]);});
  handleApp('codeclub:hooks-install',(event,id:string)=>{requireAppSender(event);return relay.install(id);});
  updateRelay();app.once('will-quit',()=>relay.stop());
  integrations.start();
  app.once('will-quit',()=>integrations.stop());
  handleApp('codeclub:credential-present',(event,key:string)=>{requireAppSender(event);return credentialVault.present(key);});
  handleApp('codeclub:credential-set',(event,key:string,value:string,origin?:string)=>{requireAppSender(event);credentialVault.set(key,value,origin);});
  handleApp('codeclub:external-open',(event,url:string)=>{requireAppSender(event);const target=new URL(url);if(target.protocol!=='https:')throw new Error('Invalid external URL');return shell.openExternal(target.href);});
  handleApp('codeclub:sessions-list', event => { requireAppSender(event); return sessionHub.list().map(session=>({...session,localOwner:session.owner===event.sender.id})); });
  handleApp('codeclub:session-select', (event, chat: SessionChat) => { requireAppSender(event); if(chat?.chatId&&typeof chat.projectPath==='string')selectedSessionChat={chatId:chat.chatId,projectPath:chat.projectPath,name:chat.name,projectName:chat.projectName}; });
  handleApp('codeclub:session-selected', event => { requireAppSender(event);return selectedSessionChat; });
  handleApp('codeclub:session-claim', (event, chat: SessionChat) => { requireAppSender(event); return sessionHub.claim(event.sender.id,chat); });
  handleApp('codeclub:session-publish', (event, chat: SessionChat, runId: string, update: any) => { requireAppSender(event); return sessionHub.publish(event.sender.id,chat,runId,update); });
  handleApp('codeclub:session-command', (event, chat: SessionChat, action: string, approvalId?: string) => {
    requireAppSender(event);const command=sessionHub.command(chat,action,approvalId);if(!command)return false;
    const owner=BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()&&!win.webContents.isDestroyed()&&win.webContents.id===command.owner);
    if(!owner){sessionHub.disconnect(command.owner);return false;}
    if (action === 'cancel') taskWorkers.get(command.owner)?.controller.abort();
    owner.webContents.send('codeclub:session-command',command);return true;
  });
  handleApp('codeclub:session-open', (event, chat: SessionChat) => { requireAppSender(event);if(!chat?.chatId||typeof chat.projectPath!=='string')return;selectedSessionChat={chatId:chat.chatId,projectPath:chat.projectPath,name:chat.name,projectName:chat.projectName};showMainWindow(); });
  const chatStore = new ChatStore(app.getPath('userData'));
  chatStore.migrateGlobalSettings();
  const settingsStore = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), key => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('codeclub:settings-changed', { key });
    if (key === 'codeclub-language') { setNativeLanguage(settingsStore.get(key)); updateTrayMenu(); }
    if (key === 'codeclub_orbs') orbLearning?.refresh();
    if (key === 'codeclub_orbs') for (const worker of taskWorkers.values()) if (worker.task.proactive && !orbLearningOrbs().some(orb => orb.id === worker.task.orbId && orb.maximumAutonomy === true)) worker.complete('TASK_CANCELLED');
  });
  setNativeLanguage(settingsStore.get('codeclub-language'));
  updateTrayMenu();
  orbLearningOrbs = () => { const saved = settingsStore.get('codeclub_orbs'); return Array.isArray(saved) ? saved.filter(orb => orb && typeof orb.id === 'string') : []; };
  const mobileSync=new MobileSync(app.getPath('userData'),chatStore,settingsStore,sessionHub,()=>projects,(chat,action,approvalId)=>{
    const command=sessionHub.command(chat,action,approvalId);if(!command)return false;
    const owner=BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()&&win.webContents.id===command.owner);if(!owner)return false;
    if(action==='cancel')taskWorkers.get(command.owner)?.controller.abort();owner.webContents.send('codeclub:session-command',command);return true;
  });
  androidCompanion.applicationRequest=(device,request)=>mobileSync.request(device,request);
  handleApp('codeclub:mobile-next',async event=>{requireTaskUi(event);if(event.sender!==mainWindow?.webContents)return null;return mobileSync.next();});
  handleApp('codeclub:mobile-take',async(event,chat)=>{requireTaskUi(event);if(event.sender!==mainWindow?.webContents)return null;return mobileSync.take(event.sender.id,chat);});
  handleApp('codeclub:mobile-release',(event,id:string)=>{requireTaskUi(event);mobileSync.release(event.sender.id,id);});
  app.once('will-quit',()=>mobileSync.close());
  orbLearning = new OrbLearning(path.join(app.getPath('userData'), 'orb-learning.json'), {
    active: orbLearningActive,
    orbs: orbLearningOrbs,
    upcoming: () => taskScheduler?.upcoming() || [],
    busy: chatId => sessionHub.list().some(session => session.chatId === chatId && session.busy),
    suggest: async (orb, context) => {
      const id = `orb_proactive_${orb.id}`;
      const existing = taskScheduler!.list('').find(task => task.id === id);
      if (existing?.runs.some(run => ['running', 'queued'].includes(run.status))) return;
      taskScheduler!.save('', proactiveOrbTask(orb, context, orbLearningLanguage));
      taskScheduler!.run('', id);
    },
  });
  orbLearning.start();
  registerSettingsIpc(ipcMain, requireAppSender, settingsStore);
  // Recover orphaned orb conversations once, preserving explicitly deleted histories.
  if (!settingsStore.get('codeclub_orb_chat_index_repaired_v1')) {
    const indexed = settingsStore.get('codeclub_global_chats');
    const known = new Set((Array.isArray(indexed) ? indexed : []).map((chat: any) => chat.id));
    for (const task of taskScheduler.list('')) if (task.autonomous && task.id.startsWith('orb_')) {
      for (const run of task.runs) if (!known.has(run.chatId) && chatStore.hasMessages('', run.chatId)) {
        settingsStore.upsertGlobalChat({ id: run.chatId, name: task.name, customName: true }); known.add(run.chatId);
      }
    }
    settingsStore.set('codeclub_orb_chat_index_repaired_v1', true);
  }

  registerChatIpc(ipcMain, requireAppSender, chatStore, (project, id, message) => {
    if (typeof message?.mobileRequestId === 'string') mobileSync.accept(message.mobileRequestId);
    if (!project && message?.role === 'user' && !message.hidden) orbLearning?.respond(id);
  });
  app.once('will-quit', () => chatStore.close());
  await loadProjects();
  handleApp('projects:list', async () => {
    const available = await Promise.all(projects.map(async (project) => {
      try { return (await fs.stat(project.path)).isDirectory() ? project : null; } catch { return null; }
    }));
    return available.filter((project) => project !== null);
  });
  handleApp('projects:select-folder', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); if (result.canceled || !result.filePaths[0]) return null; const project = registerProject(result.filePaths[0]); await saveProjects(); return project; });
  registerFileIpc(ipcMain, requireAppSender, app.getPath('userData'), async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });
  handleApp('native:invoke', async (event, payload: { command: string; args?: Record<string, unknown> }) => {
    if (!payload || typeof payload.command !== 'string' || (payload.args !== undefined && (!payload.args || typeof payload.args !== 'object' || Array.isArray(payload.args)))) throw new Error('INVALID_NATIVE_REQUEST');
    if (payload.command === 'codeclub_orb_observe') {
      requireTaskUi(event);
      orbLearningLanguage = payload.args?.language === 'en' ? 'en' : 'es';
      orbLearning?.observe(String(payload.args?.surface || ''), Array.isArray(payload.args?.ready) ? payload.args.ready.filter((id): id is string => typeof id === 'string') : []);
      if (orbLearningActive() && orbLearningOrbs().some(orb => orb.maximumAutonomy === true && orb.allowComputer === true)) void (async () => {
        const elevated = await isAdministrator();
        const allowed = orbLearningOrbs().filter(orb => orb.maximumAutonomy === true && orb.allowComputer === true && (!orb.requiresAdministrator || elevated));
        if (allowed.length) orbLearning?.observeApplication(await foregroundApplication(), allowed.map(orb => orb.id));
      })().catch(() => undefined);
      void orbLearning?.tick().catch(() => undefined);
      return true;
    }
    if (payload.command === 'codeclub_orb_proactive_result') {
      const worker = taskWorkers.get(event.sender.id);
      if (!worker?.task.proactive || !worker.task.orbId) throw new Error('Unauthorized proactive result');
      // A slow provider must not announce a task that was paused, rescheduled, or already started.
      const anticipated = JSON.parse(worker.task.prompt).upcomingTasks;
      if (Array.isArray(anticipated) && anticipated.length && !anticipated.every(task => taskScheduler!.upcoming().some(current => current.name === task.name && current.projectPath === task.projectPath && current.scheduledAt === task.scheduledAt))) return false;
      return orbLearning?.result(worker.task.orbId, String(payload.args?.message || '').slice(0, 1500)) || false;
    }
    if (payload.command === 'codeclub_admin_status' || payload.command === 'codeclub_request_admin') {
      requireTaskUi(event);
      if (administratorRestartPending) throw new Error('ORB_ADMIN_BUSY');
      const elevated = await isAdministrator();
      if (payload.command === 'codeclub_admin_status' || elevated) return { elevated, computerName: process.env.COMPUTERNAME || '' };
      // Do not interrupt active agents or terminals for an elevation restart.
      if (taskWorkers.size || activeCommands.size || nativeTerminals.size || sessionHub.list().some(session => session.busy)) throw new Error('ORB_ADMIN_BUSY');
      if (administratorRestartPending) throw new Error('ORB_ADMIN_BUSY');
      administratorRestartPending = true;
      app.releaseSingleInstanceLock();
      try {
        await launchAdministrator(process.execPath, app.isPackaged ? undefined : app.getAppPath(), payload.args?.maximumAutonomy === true);
      } catch (error) {
        administratorRestartPending = false;
        app.requestSingleInstanceLock();
        throw error;
      }
      setTimeout(() => app.quit(), 250);
      return { elevated: false, restarting: true };
    }
    if (payload.command.startsWith('codeclub_scheduled_')) {
      requireTaskUi(event);
      const project = String(payload.args?.projectPath || '');
      const id = String(payload.args?.id || '');
      if (payload.command === 'codeclub_scheduled_list') return taskScheduler!.list(project);
      if (payload.command === 'codeclub_scheduled_save') {
        if (project && !(await fs.stat(path.resolve(project))).isDirectory()) throw new Error('TASK_INVALID_PROJECT');
        return taskScheduler!.save(project, payload.args?.task as ScheduledTask);
      }
      if (payload.command === 'codeclub_scheduled_remove') return taskScheduler!.remove(project, id);
      if (payload.command === 'codeclub_scheduled_run') return taskScheduler!.run(project, id);
      if (payload.command === 'codeclub_scheduled_status') {
        const task = taskScheduler!.list(project).find(task => task.id === id);
        if (!task) throw new Error('TASK_NOT_FOUND');
        return taskScheduler!.save(project, { ...task, status: payload.args?.paused ? 'paused' : 'active' });
      }
      throw new Error('TASK_UNKNOWN_ACTION');
    }
    const worker = taskWorkers.get(event.sender.id);
    if (worker) {
      if (worker.controller.signal.aborted && payload.command !== 'codeclub_http_abort') throw new Error('TASK_CANCELLED');
      if (payload.command.startsWith('codeclub_terminal_') && !['codeclub_terminal_create', 'codeclub_terminal_list'].includes(payload.command) && !worker.terminals.has(String(payload.args?.id))) throw new Error('TASK_TERMINAL_MISMATCH');
      const workspaceCommands = ['codeclub_git_read', 'codeclub_list_files', 'codeclub_read_file', 'codeclub_search_text', 'codeclub_write_file', 'codeclub_run_command'];
      const requestedProject = workspaceCommands.includes(payload.command) ? String(payload.args?.projectPath || '') : String((payload.args?.request as any)?.projectPath || payload.args?.projectPath || '');
      if (requestedProject || workspaceCommands.includes(payload.command)) {
        const expected = worker.task.projectPath || (process.platform === 'win32' ? `${process.env.SystemDrive || 'C:'}\\` : '/');
        if (!requestedProject || path.resolve(requestedProject).toLowerCase() !== path.resolve(expected).toLowerCase()) throw new Error('TASK_PROJECT_MISMATCH');
      }
    }
    if(payload.command==='codeclub_http_fetch'&&(payload.args?.request as any)?.credentialKey)requireAppSender(event);
    if (payload.command.startsWith('codeclub_external_browser_') || payload.command.startsWith('codeclub_browser_extension_')) requireAppSender(event);
    if (payload.command.startsWith('codeclub_android_')) {
      requireAppSender(event);
      if (worker?.task.allowComputer === false) throw new Error('TASK_COMPUTER_ACCESS_REQUIRED');
      if(payload.command==='codeclub_android_pairing_create') {
        if(worker)throw new Error('ANDROID_PAIRING_REQUIRES_DESKTOP');
        const offer=await androidCompanion.offer(event.sender.id);
        const owner=event.sender.id;
        if(!androidPairingOwners.has(owner)){androidPairingOwners.add(owner);event.sender.once('destroyed',()=>{androidPairingOwners.delete(owner);androidCompanion.cancelOffers(owner);});}
        const qr=(await import('qrcode')).default;
        return {...offer,qr:await qr.toDataURL(offer.code,{width:320,margin:2,errorCorrectionLevel:'M'})};
      }
      if(payload.command==='codeclub_android_pairing_status')return {devices:androidCompanion.status(),paired:androidCompanion.offerPaired(payload.args?.pairId,event.sender.id)};
      if(payload.command==='codeclub_android_pairing_cancel') {androidCompanion.cancelOffers(event.sender.id);return {ok:true};}
      if(payload.command==='codeclub_android_pairing_forget') {if(worker)throw new Error('ANDROID_PAIRING_REQUIRES_DESKTOP');androidCompanion.forget(String(payload.args?.deviceId));return {ok:true};}
      let control = androidControls.get(event.sender.id);
      if (!control) {
        control = createAndroidUse(path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'Codeclub'), (signal, key) => {
          const saved = credentialVault.androidPin(key);
          return saved ? Promise.resolve(saved) : requestAndroidPin(BrowserWindow.fromWebContents(event.sender), androidPinLabels.get(event.sender.id)!, signal);
        },androidCompanion);
        const senderId = event.sender.id;
        androidControls.set(senderId, control);
        event.sender.once('destroyed', () => { androidControls.get(senderId)?.stop(); androidControls.delete(senderId); androidPinLabels.delete(senderId); androidCompanion.cancelOffers(senderId); });
      }
      const request = (payload.args?.request as Record<string, any>) || {};
      if (payload.command === 'codeclub_android_pin_status') return { saved: credentialVault.present(control.pinKey(request.deviceId)) };
      if (payload.command === 'codeclub_android_pin_save') {
        if (worker) throw new Error('ANDROID_PIN_CONFIGURATION_REQUIRES_DESKTOP');
        if (typeof request.pin !== 'string') throw new Error('INVALID_ANDROID_PIN');
        credentialVault.set(control.pinKey(request.deviceId), request.pin);
        return { saved: Boolean(request.pin) };
      }
      if (payload.command === 'codeclub_android_unlock') {
        const labels = request.labels;
        if (!labels || !['title', 'hint', 'cancel', 'unlock'].every(key => typeof labels[key] === 'string' && labels[key].length < 400)) throw new Error('INVALID_ANDROID_PROMPT_LABELS');
        androidPinLabels.set(event.sender.id, labels);
      }
      return control.run(payload.command.slice('codeclub_android_'.length), request, worker?.controller.signal);
    }
    if(payload.command==='codeclub_http_abort'){
      requireAppSender(event);modelRequests.get(`${event.sender.id}:${String(payload.args?.requestId)}`)?.abort();return;
    }
    if(payload.command==='codeclub_http_fetch'){
      const request=payload.args?.request as any;
      if(request)request.requestId=`${event.sender.id}:${String(request.requestId||randomUUID())}`;
    }
    const result = await invokeNativeCommand(payload.command, payload.args, worker?.controller.signal);
    if (!worker?.task.proactive) {
      const outcome = payload.command === 'codeclub_write_file' ? 'edit' : payload.command === 'codeclub_run_command' ? 'command' : payload.command === 'codeclub_browser_action' ? 'browser' : undefined;
      if (outcome) orbLearning?.observeOutcome(outcome);
    }
    if (worker && payload.command === 'codeclub_terminal_create') worker.terminals.add(String(result.id));
    if (worker && payload.command === 'codeclub_terminal_list') return (result as any[]).filter(terminal => worker.terminals.has(String(terminal.id)));
    return result;
  });
  handleApp('projects:switch', async (_event, id: string) => { const project = projects.find((item) => item.id === id); if (!project) throw new Error('Proyecto no encontrado.'); if (!(await fs.stat(project.path).catch(() => null))?.isDirectory()) throw new Error('La carpeta del proyecto ya no está disponible.'); project.lastOpenedAt = new Date().toISOString(); await saveProjects(); return project; });
  handleApp('projects:rename', async (_event, id: string, name: string) => {
    const project = projects.find((item) => item.id === id);
    const nextName = name.trim();
    if (!project) throw new Error('Proyecto no encontrado.');
    if (!nextName) throw new Error('El nombre no puede estar vacío.');
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(nextName) || /[. ]$/.test(nextName)) throw new Error('El nombre contiene caracteres no válidos para Windows.');
    const nextPath = path.join(path.dirname(project.path), nextName);
    if (nextPath.toLowerCase() !== project.path.toLowerCase()) {
      try { await fs.rename(project.path, nextPath); } catch (error) { throw new Error(`No se pudo renombrar la carpeta: ${error instanceof Error ? error.message : 'error desconocido'}`); }
      project.path = nextPath;
    }
    project.name = nextName;
    await saveProjects();
    return project;
  });
  ipcMain.on('codeclub:orb-palette-change', (event, index: unknown) => {
    const sender = BrowserWindow.fromWebContents(event.sender);
    if (!sender || sender.isDestroyed() || typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 8) return;
    updateComputerOverlayPalette(index);
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.id !== sender.id && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('codeclub:orb-palette-change', index);
      }
    }
  });
  handleApp('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  handleApp('window:maximize', (event) => { const window = BrowserWindow.fromWebContents(event.sender); if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); });
  handleApp('window:is-full-screen', (event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false);
  handleApp('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  handleApp('app:reload', (event) => BrowserWindow.fromWebContents(event.sender)?.webContents.reload());
  handleApp('app:update-status', () => autoUpdateState);
  handleApp('app:check-for-updates', async () => {
    if (!app.isPackaged) return { state: 'not-available' } satisfies AutoUpdateState;
    if (['checking', 'downloading', 'downloaded'].includes(autoUpdateState.state)) return autoUpdateState;
    try { await autoUpdater.checkForUpdates(); return autoUpdateState; } catch (error) { const state = { state: 'error', error: error instanceof Error ? error.message : String(error) } satisfies AutoUpdateState; publishAutoUpdate(state); return state; }
  });
  handleApp('app:install-update', () => { if (autoUpdateState.state === 'downloaded') autoUpdater.quitAndInstall(); return autoUpdateState; });
  handleApp('computer:overlay', (_event, payload: { active?: boolean; language?: string; paletteIndex?: number }) => setComputerOverlay(Boolean(payload?.active), payload?.language === 'en' ? 'en' : 'es', payload?.paletteIndex));
  ipcMain.on('computer:menu-action', (_event, action: string) => handleComputerMenuAction(action));
  floatingChat = createFloatingChat(root, showMainWindow, updateTrayMenu);
  createWindow();
  createTray();
  taskScheduler.start();
  setupAutoUpdater();
  app.on('activate', showMainWindow);
});

app.on('before-quit', () => { isQuitting = true; for (const stop of activeCommands) stop(); for (const session of nativeMcpSessions.values()) session.close(); nativeMcpSessions.clear(); taskScheduler?.stop(); orbLearning?.stop(); for (const worker of taskWorkers.values()) worker.complete('TASK_INTERRUPTED'); floatingChat?.destroy(); desktopControl.stop(); destroyComputerOverlay(); tray?.destroy(); });
app.on('window-all-closed', () => { /* La app permanece disponible en la bandeja. */ });
app.on('before-quit', () => { for (const control of androidControls.values()) control.stop(); androidControls.clear(); androidCompanion?.close(); });
