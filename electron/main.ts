import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, safeStorage, screen, shell, Tray } from 'electron';
import { runProjectCommand } from './run-command.js';
import { TaskScheduler, type ScheduledTask, type TaskRun } from './task-scheduler.js';
import { CredentialVault } from './credential-vault.js';
import { ActivityIntegrations } from './activity-integrations.js';
import { AgentRelay } from './agent-relay.js';
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { ChatStore } from './chat-store.js';
import { SessionHub, type SessionChat } from './session-hub.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { userInfo } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pty from 'node-pty';
import electronUpdater from 'electron-updater';
import { createComputerUse } from './computer-use.js';
import { createExternalBrowserControl } from './external-browser.js';
import { createBrowserExtensionBridge } from './browser-extension-bridge.js';
import { createFloatingChat } from './floating-chat.js';
const { autoUpdater } = electronUpdater;

type Project = { id: string; name: string; path: string; createdAt: string; lastOpenedAt?: string };

const root = path.dirname(fileURLToPath(import.meta.url));
const ownsAppInstance = app.requestSingleInstanceLock();
if (!ownsAppInstance) app.quit();
app.on('second-instance', () => showMainWindow());
const desktopControl = createComputerUse(app.getAppPath(), app.isPackaged ? process.resourcesPath : undefined);
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
function requireTaskUi(event: Electron.IpcMainInvokeEvent) {
  requireAppSender(event);
  if (taskWorkers.has(event.sender.id)) throw new Error('Unauthorized scheduler management');
}
function publishTaskChange() {
  if (isQuitting) return;
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed() && !win.webContents.isDestroyed() && !taskWorkers.has(win.webContents.id)) win.webContents.send('codeclub:scheduled-tasks-changed');
}
function executeScheduledTask(task: ScheduledTask, run: TaskRun): Promise<void> {
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
    const loading = devUrl ? worker.loadURL(`${devUrl.replace(/\/$/, '')}/?scheduledRunner=1`) : worker.loadFile(path.join(root, '..', 'out', 'index.html'), { query: { scheduledRunner: '1' } });
    void loading.catch(() => complete('TASK_RUNNER_UNAVAILABLE'));
  });
}
const computerOverlayWindows = new Set<BrowserWindow>();
let computerOverlayActive = false;
let computerOverlayPaletteIndex = 0;
let computerOverlayLanguage = 'es';
let computerMouseHook: ReturnType<typeof spawn> | null = null;
let computerMenuWindow: BrowserWindow | null = null;
let lastComputerContext: Record<string, unknown> | null = null;
type AutoUpdateState = { state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'; version?: string; percent?: number; error?: string };
let autoUpdateState: AutoUpdateState = { state: 'idle' };
const activeCommands = new Set<() => void>();
type NativeMcpSession = { child: ReturnType<typeof spawn>; nextId: number; pending: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> };
const nativeMcpSessions = new Map<string, NativeMcpSession>();
type NativeTerminal = { child: pty.IPty; info: any; buffer: string; bufferOffset: number };
const nativeTerminals = new Map<string, NativeTerminal>();

const COMPUTER_OVERLAY_PALETTES = [
  { orb: '#2D5FD6', accent: '#3D9BFF', bright: '#8BC7FF' },
  { orb: '#D63D52', accent: '#F04E65', bright: '#FFABB7' },
  { orb: '#D6A317', accent: '#E8B930', bright: '#FFE08A' },
  { orb: '#7543D6', accent: '#9C6AFF', bright: '#C1A5FF' },
  { orb: '#21845A', accent: '#39B77C', bright: '#8FE6B9' },
  { orb: '#D6752B', accent: '#F0893A', bright: '#FFC092' },
  { orb: '#D64A9E', accent: '#F15BB9', bright: '#FFABD8' },
  { orb: '#228FAD', accent: '#31B4D5', bright: '#92E5F2' },
  { orb: '#8CAB20', accent: '#B4D43A', bright: '#DBEF8D' },
] as const;

const computerOverlayHtml = (language: string, paletteIndex: number) => {
  const title = language === 'en' ? 'Codeclub is using your computer' : 'Codeclub está usando tu computadora';
  const cancel = language === 'en' ? 'Esc to cancel' : 'Esc para cancelar';
  const palette = COMPUTER_OVERLAY_PALETTES[paletteIndex] || COMPUTER_OVERLAY_PALETTES[0];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden;font-family:Segoe UI,Arial,sans-serif}
body{border:1px solid ${palette.accent};box-shadow:inset 0 0 0 1px ${palette.bright}6b,inset 0 0 28px ${palette.accent}1f,0 0 18px ${palette.accent}29}
.pill{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:center;gap:7px;padding:7px 16px;border:1px solid ${palette.bright}c7;border-radius:999px;background:linear-gradient(110deg,${palette.orb}f5,${palette.accent}eb);box-shadow:0 0 20px ${palette.accent}8c,0 5px 18px rgba(0,0,0,.26);color:#fff;font-size:12px;font-weight:600;white-space:nowrap;text-shadow:0 1px 2px rgba(0,0,0,.2)}
.dot{width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 7px #fff;flex:none}.sep{opacity:.7}.cancel{font-weight:500;opacity:.92}
</style></head><body><div class="pill"><span class="dot"></span><span>${title}</span><span class="sep">·</span><span class="cancel">${cancel}</span></div></body></html>`;
};

const computerContextMenuHtml = (language: string, paletteIndex = computerOverlayPaletteIndex) => {
  const items = language === 'en'
    ? [['select', '⌖', 'Select element'], ['coordinate', '⌁', 'Use coordinate'], ['screenshot', '▣', 'Capture screen']]
    : [['select', '⌖', 'Seleccionar elemento'], ['coordinate', '⌁', 'Usar coordenada'], ['screenshot', '▣', 'Capturar pantalla']];
  const rows = items.map(([action, icon, label]) => `<button data-action="${action}"><span class="icon">${icon}</span><span>${label}</span></button>`).join('');
  const palette = COMPUTER_OVERLAY_PALETTES[paletteIndex] || COMPUTER_OVERLAY_PALETTES[0];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;background:transparent;font-family:Segoe UI,Arial,sans-serif;overflow:hidden}main{width:286px;padding:7px;border:1px solid ${palette.bright}61;border-radius:15px;background:rgba(28,32,40,.97);box-shadow:0 16px 38px rgba(0,0,0,.46),0 0 20px ${palette.accent}29;backdrop-filter:blur(18px)}button{display:flex;align-items:center;gap:12px;width:100%;height:42px;padding:0 12px;border:0;border-radius:9px;background:transparent;color:#e7edf5;font:500 14px Segoe UI,Arial,sans-serif;text-align:left;cursor:pointer}button:hover{background:${palette.bright}2e;color:#fff}.icon{display:grid;place-items:center;width:20px;color:${palette.bright};font-size:20px;line-height:1}</style></head><body><main>${rows}</main><script>for(const button of document.querySelectorAll('button'))button.addEventListener('click',()=>window.codeclub.computerMenuAction(button.dataset.action));window.addEventListener('keydown',event=>{if(event.key==='Escape')window.codeclub.computerMenuAction('close')});</script></body></html>`;
};

const computerMouseHookScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Drawing;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class CodeclubMouseHook {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr extraInfo; }
  public delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
  static HookProc proc = Callback;
  static IntPtr hook;
  [DllImport("user32.dll")] static extern IntPtr SetWindowsHookEx(int id, HookProc callback, IntPtr module, uint threadId);
  [DllImport("user32.dll")] static extern bool UnhookWindowsHookEx(IntPtr hook);
  [DllImport("user32.dll")] static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  static string Escape(string value) { return (value ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "").Replace("\n", " "); }
  static IntPtr Callback(int code, IntPtr message, IntPtr data) {
    if (code >= 0 && message == (IntPtr)0x0205) {
      var info = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(data); var hwnd = WindowFromPoint(info.pt); uint processId; GetWindowThreadProcessId(hwnd, out processId); var title = new StringBuilder(512); GetWindowText(hwnd, title, title.Capacity);
      Console.WriteLine("{\"x\":" + info.pt.X + ",\"y\":" + info.pt.Y + ",\"handle\":" + hwnd.ToInt64() + ",\"processId\":" + processId + ",\"title\":\"" + Escape(title.ToString()) + "\"}"); Console.Out.Flush();
      return (IntPtr)1;
    }
    return CallNextHookEx(hook, code, message, data);
  }
  public static void Run() { hook=SetWindowsHookEx(14, proc, IntPtr.Zero, 0); if (hook==IntPtr.Zero) throw new Exception("No se pudo instalar el hook de mouse."); Application.Run(); UnhookWindowsHookEx(hook); }
}
'@
[CodeclubMouseHook]::Run()`;

function stopComputerMouseHook() {
  if (computerMouseHook) { computerMouseHook.kill(); computerMouseHook = null; }
}

function showComputerContextMenu(payload: any) {
  lastComputerContext = payload;
  if (computerMenuWindow && !computerMenuWindow.isDestroyed()) computerMenuWindow.destroy();
  const display = screen.getDisplayNearestPoint({ x: Number(payload.x || 0), y: Number(payload.y || 0) });
  const width = 300; const height = 150;
  const left = Math.min(Math.max(display.bounds.x, Number(payload.x || 0)), display.bounds.x + display.bounds.width - width);
  const top = Math.min(Math.max(display.bounds.y, Number(payload.y || 0)), display.bounds.y + display.bounds.height - height);
  computerMenuWindow = new BrowserWindow({ x: left, y: top, width, height, frame: false, transparent: true, resizable: false, movable: false, focusable: true, skipTaskbar: true, show: false, hasShadow: false, webPreferences: { preload: path.join(root, '..', 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false } });
  computerMenuWindow.setAlwaysOnTop(true, 'screen-saver');
  computerMenuWindow.on('blur', () => { if (computerMenuWindow && !computerMenuWindow.isDestroyed()) computerMenuWindow.close(); });
  computerMenuWindow.on('closed', () => { computerMenuWindow = null; });
  void computerMenuWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(computerContextMenuHtml('es', computerOverlayPaletteIndex))}`);
  computerMenuWindow.once('ready-to-show', () => computerMenuWindow?.showInactive());
  computerMenuWindow.webContents.once('did-finish-load', () => computerMenuWindow?.focus());
}

function startComputerMouseHook() {
  stopComputerMouseHook();
  computerMouseHook = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', computerMouseHookScript], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let buffer = '';
  computerMouseHook.stdout?.on('data', (chunk) => {
    buffer += String(chunk);
    const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
    for (const line of lines) { try { const payload = JSON.parse(line); if (computerOverlayActive) showComputerContextMenu(payload); } catch { /* Salida parcial del hook: se ignora. */ } }
  });
  computerMouseHook.once('exit', () => { computerMouseHook = null; });
}

function destroyComputerOverlay() {
  stopComputerMouseHook();
  if (computerMenuWindow && !computerMenuWindow.isDestroyed()) computerMenuWindow.destroy();
  computerMenuWindow = null;
  for (const overlay of computerOverlayWindows) overlay.destroy();
  computerOverlayWindows.clear();
  if (globalShortcut.isRegistered('Esc')) globalShortcut.unregister('Esc');
  computerOverlayActive = false;
}

function createComputerOverlay(language: string, paletteIndex = computerOverlayPaletteIndex) {
  for (const display of screen.getAllDisplays()) {
    // bounds puede coincidir con el área de trabajo en algunas configuraciones de Windows;
    // size conserva el tamaño completo del monitor, incluida la franja de la barra de tareas.
    const bounds = { ...display.bounds, width: display.size.width, height: display.size.height };
    const overlay = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      show: false,
      webPreferences: { sandbox: true },
    });
    overlay.setAlwaysOnTop(true, 'screen-saver');
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.on('closed', () => computerOverlayWindows.delete(overlay));
    computerOverlayWindows.add(overlay);
    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(computerOverlayHtml(language, paletteIndex))}`);
    overlay.once('ready-to-show', () => {
      if (overlay.isDestroyed() || !computerOverlayActive) return;
      overlay.showInactive();
      overlay.setAlwaysOnTop(true, 'screen-saver');
    });
  }
}

function setComputerOverlay(active: boolean, language = 'es', paletteIndex = computerOverlayPaletteIndex) {
  if (!active) { destroyComputerOverlay(); return { ok: true, active: false }; }
  destroyComputerOverlay();
  computerOverlayLanguage = language;
  computerOverlayPaletteIndex = Number.isInteger(paletteIndex) && paletteIndex >= 0 && paletteIndex < COMPUTER_OVERLAY_PALETTES.length ? paletteIndex : 0;
  computerOverlayActive = true;
  createComputerOverlay(computerOverlayLanguage, computerOverlayPaletteIndex);
  startComputerMouseHook();
  globalShortcut.register('Esc', () => {
    if (!computerOverlayActive) return;
    destroyComputerOverlay();
    desktopControl.stop();
    mainWindow?.webContents.send('computer:escape');
  });
  return { ok: true, active: true, displays: screen.getAllDisplays().length };
}

const projectsFile = () => path.join(app.getPath('userData'), 'projects.json');
const projectId = (value: string) => value.toLowerCase().replace(/[\\/:*?"<>|\s]+/g, '-');
const projectStorageKey = (value: string) => encodeURIComponent(path.resolve(value));

async function loadProjects() { try { projects = JSON.parse(await fs.readFile(projectsFile(), 'utf8')); } catch { projects = []; } }
async function saveProjects() { await fs.mkdir(path.dirname(projectsFile()), { recursive: true }); await fs.writeFile(projectsFile(), JSON.stringify(projects, null, 2) + '\n', 'utf8'); }
function registerProject(folder: string): Project { const existing = projects.find((item) => item.path.toLowerCase() === folder.toLowerCase()); if (existing) return existing; const project = { id: projectId(folder), name: path.basename(folder) || folder, path: folder, createdAt: new Date().toISOString() }; projects = [...projects, project]; return project; }

const ignoredDirectories = new Set(['.git', 'node_modules', '.next', 'out', 'electron-dist', 'target']);
const projectFile = (projectPath: string, relativePath: string) => {
  const rootPath = path.resolve(projectPath);
  const targetPath = path.resolve(rootPath, relativePath || '.');
  if (targetPath !== rootPath && !targetPath.startsWith(`${rootPath}${path.sep}`)) throw new Error('La ruta queda fuera del proyecto.');
  return targetPath;
};

const isInsidePath = (rootPath: string, targetPath: string) => {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};

async function resolveProjectFile(projectPath: string, relativePath: string, allowMissing = false) {
  const rootPath = await fs.realpath(path.resolve(projectPath));
  const targetPath = projectFile(rootPath, relativePath);
  try {
    const resolved = await fs.realpath(targetPath);
    if (!isInsidePath(rootPath, resolved)) throw new Error('La ruta queda fuera del proyecto.');
    return resolved;
  } catch (error: any) {
    if (!allowMissing || error?.code !== 'ENOENT') throw error;
    let ancestor = path.dirname(targetPath);
    const suffix = [path.basename(targetPath)];
    while (isInsidePath(rootPath, ancestor)) {
      try {
        const resolvedAncestor = await fs.realpath(ancestor);
        if (!isInsidePath(rootPath, resolvedAncestor)) throw new Error('La ruta queda fuera del proyecto.');
        return path.join(resolvedAncestor, ...suffix.reverse());
      } catch (ancestorError: any) {
        if (ancestorError?.code !== 'ENOENT') throw ancestorError;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        suffix.push(path.basename(ancestor));
        ancestor = parent;
      }
    }
    throw new Error('La ruta queda fuera del proyecto.');
  }
}

async function listProjectFiles(projectPath: string, maxFiles: number) {
  const limit = Number.isFinite(maxFiles) ? Math.min(1200, Math.max(1, Math.floor(maxFiles))) : 400;
  const rootPath = await fs.realpath(path.resolve(projectPath));
  const result: Array<{ path: string; kind: string; size?: number; modifiedAt?: number }> = [];
  const pending: Array<{ folder: string; relative: string }> = [{ folder: rootPath, relative: '' }];
  while (pending.length && result.length < limit) {
    const current = pending.pop()!;
    const directories: Array<{ folder: string; relative: string }> = [];
    try {
      const directory = await fs.opendir(current.folder);
      for await (const entry of directory) {
        if (entry.isSymbolicLink() || (entry.isDirectory() && ignoredDirectories.has(entry.name))) continue;
        const entryRelative = current.relative ? path.join(current.relative, entry.name) : entry.name;
        const entryPath = path.join(current.folder, entry.name);
        if (entry.isDirectory()) {
          result.push({ path: entryRelative.replaceAll(path.sep, '/'), kind: 'directory' });
          directories.push({ folder: entryPath, relative: entryRelative });
        } else if (entry.isFile()) {
          try {
            const stat = await fs.stat(entryPath);
            result.push({ path: entryRelative.replaceAll(path.sep, '/'), kind: 'file', size: stat.size, modifiedAt: stat.mtimeMs });
          } catch { /* Un archivo puede desaparecer mientras se indexa el proyecto. */ }
        }
        if (result.length >= limit) break;
      }
    } catch (error) {
      if (current.folder === rootPath) throw error;
      continue;
    }
    for (let index = directories.length - 1; index >= 0; index--) pending.push(directories[index]);
  }
  return result;
}

async function searchProjectText(projectPath: string, query: string, maxMatches: number) {
  const needle = String(query || '').toLocaleLowerCase();
  if (!needle) return [];
  const limit = Number.isFinite(maxMatches) ? Math.min(200, Math.max(1, Math.floor(maxMatches))) : 80;
  const files = await listProjectFiles(projectPath, 1200);
  const matches: Array<{ path: string; line: number; preview: string }> = [];
  let scannedBytes = 0;
  for (const entry of files) {
    if (entry.kind !== 'file' || matches.length >= limit || !entry.size || entry.size > 2 * 1024 * 1024) continue;
    if (scannedBytes + entry.size > 32 * 1024 * 1024) break;
    scannedBytes += entry.size;
    try {
      const content = await fs.readFile(await resolveProjectFile(projectPath, entry.path), 'utf8');
      if (content.includes('\0')) continue;
      const lines = content.split(/\r?\n/);
      for (let index = 0; index < lines.length && matches.length < limit; index++) {
        if (lines[index].toLocaleLowerCase().includes(needle)) matches.push({ path: entry.path, line: index + 1, preview: lines[index].trim().slice(0, 240) });
      }
    } catch { /* Binarios o archivos ilegibles: se omiten. */ }
  }
  return matches;
}

const replacePluginVariables = (value: string, root: string, data: string) => String(value || '').replaceAll('${PLUGIN_ROOT}', root).replaceAll('${PLUGIN_DATA}', data);
function mcpRequest(session: NativeMcpSession, method: string, params: Record<string, unknown>) {
  const id = session.nextId++;
  return new Promise<any>((resolve, reject) => {
    session.pending.set(id, { resolve, reject });
    if (!session.child.stdin || session.child.stdin.destroyed) { session.pending.delete(id); reject(new Error('MCP no tiene stdin disponible.')); return; }
    session.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function startMcpSession(request: any) {
  const root = path.resolve(String(request.pluginRoot));
  const data = path.resolve(String(request.pluginData));
  await fs.mkdir(data, { recursive: true });
  const command = String(request.command || '');
  const commandPath = command.startsWith('./') ? path.resolve(root, command.slice(2)) : command;
  if (command.startsWith('./') && !commandPath.startsWith(root)) throw new Error('command escapa del plugin.');
  const cwd = path.resolve(replacePluginVariables(request.cwd || root, root, data));
  if (!cwd.startsWith(root) && !cwd.startsWith(data)) throw new Error('cwd escapa del plugin o de PLUGIN_DATA.');
  const env = { ...process.env, ...(request.env || {}), PLUGIN_ROOT: root, PLUGIN_DATA: data } as NodeJS.ProcessEnv;
  const child = spawn(commandPath, (request.args || []).map((value: string) => replacePluginVariables(value, root, data)), { cwd, env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: process.platform === 'win32' && /\.(cmd|bat)$/i.test(commandPath) });
  const session: NativeMcpSession = { child, nextId: 1, pending: new Map() };
  const lines = createInterface({ input: child.stdout });
  lines.on('line', (line) => { try { const value = JSON.parse(line); const pending = value.id == null ? undefined : session.pending.get(Number(value.id)); if (!pending) return; session.pending.delete(Number(value.id)); if (value.error) pending.reject(new Error(JSON.stringify(value.error))); else pending.resolve(value.result ?? null); } catch { /* MCP puede emitir logs en stdout; se ignoran. */ } });
  child.on('error', (error) => { for (const pending of session.pending.values()) pending.reject(error); session.pending.clear(); });
  const initialize = await mcpRequest(session, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Codeclub', version: app.getVersion() } });
  void initialize;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const tools = await mcpRequest(session, 'tools/list', {});
  const sessionId = `mcp-${String(request.name || 'server')}-${Date.now()}`;
  nativeMcpSessions.set(sessionId, session);
  return { sessionId, tools: tools?.tools || [] };
}

type PluginScope = 'global' | 'project';
const validPluginId = (value: string) => /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/.test(value) && value.length <= 64 && !value.includes('..');
const normalizePluginScope = (value: unknown, projectPath: string): PluginScope => {
  const scope = String(value || '').trim().toLowerCase();
  if (scope === 'global') return 'global';
  if (scope === 'project' && String(projectPath || '').trim()) return 'project';
  if (scope === 'project') throw new Error('Se necesita un proyecto activo para usar el alcance del proyecto.');
  return String(projectPath || '').trim() ? 'project' : 'global';
};
const pluginRoot = (scope: PluginScope, projectPath: string) => scope === 'global'
  ? path.join(app.getPath('userData'), 'plugins')
  : path.join(app.getPath('userData'), 'projects', projectStorageKey(projectPath), 'plugins');
const pluginDirectory = (scope: PluginScope, projectPath: string, pluginId: string) => {
  if (!validPluginId(pluginId)) throw new Error('El identificador del plugin no es válido.');
  return path.join(pluginRoot(scope, projectPath), pluginId);
};
const pluginFile = (scope: PluginScope, projectPath: string, pluginId: string, relativePath: string) => {
  const root = pluginDirectory(scope, projectPath, pluginId);
  const target = path.resolve(root, relativePath || '.');
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new Error('La ruta queda fuera del plugin.');
  return target;
};

const bundledAgentSkillsRoot = () => path.join(
  app.isPackaged ? process.resourcesPath : app.getAppPath(),
  app.isPackaged ? 'agent-skills' : path.join('vendor', 'agent-skills'),
);

async function loadSkillInstructions(pluginRootPath: string, skillPath: string) {
  const original = await fs.readFile(skillPath, 'utf8');
  const resources = new Map<string, string>();
  const pending: Array<{ source: string; reference: string }> = [];
  const queueReferences = (source: string, content: string) => {
    const matches = content.match(/(?:(?:\.\.\/)+)?(?:references|scripts)\/[A-Za-z0-9_./-]+/g) || [];
    for (const reference of matches) pending.push({ source, reference: reference.replace(/[.,;:!?]+$/, '') });
  };
  queueReferences(skillPath, original);

  while (pending.length && resources.size < 16) {
    const { source, reference } = pending.shift()!;
    const target = path.resolve(path.dirname(source), reference);
    const relative = path.relative(pluginRootPath, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || resources.has(relative)) continue;
    try {
      const [realRoot, realTarget] = await Promise.all([fs.realpath(pluginRootPath), fs.realpath(target)]);
      const realRelative = path.relative(realRoot, realTarget);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) continue;
      const content = await fs.readFile(realTarget, 'utf8');
      if (content.length > 200_000) continue;
      resources.set(realRelative, content);
      queueReferences(realTarget, content);
    } catch {
      // Some upstream skills mention host-specific files that are not part of the skill bundle.
    }
  }

  if (!resources.size) return original;
  const appendix = Array.from(resources, ([relative, content]) => `### ${relative}\n\n${content}`).join('\n\n');
  return `${original}\n\n## Supporting files included with this skill\n\n${appendix}`;
}

async function listAgentPlugins(projectPath: string) {
  const roots = [
    ...(String(projectPath || '').trim() ? [{ root: pluginRoot('project', projectPath), scope: 'project' as PluginScope }] : []),
    { root: pluginRoot('global', projectPath), scope: 'global' as PluginScope },
    { root: bundledAgentSkillsRoot(), scope: 'global' as PluginScope, builtIn: true },
  ];
  const plugins: any[] = [];
  const seen = new Set<string>();
  for (const entry of roots) {
    let children: any[] = [];
    try { children = await fs.readdir(entry.root, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const root = path.join(entry.root, child.name);
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(root, 'plugin.json'), 'utf8'));
        const id = String(manifest.name || child.name);
        if (seen.has(id)) continue;
        seen.add(id);
        const skills: any[] = [];
        const skillsRoot = path.join(root, 'skills');
        for (const skill of await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => [] as any[])) {
          if (!skill.isDirectory()) continue;
          const skillPath = path.join(skillsRoot, skill.name, 'SKILL.md');
          try {
            const content = await loadSkillInstructions(root, skillPath);
            const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim();
            const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim();
            if (name && description) skills.push({ id: skill.name, name, description, content, pluginName: id, scope: entry.scope });
          } catch { /* Skill incompleta: se omite. */ }
        }
        let mcpServers: Record<string, unknown> = {};
        try { const mcp = JSON.parse(await fs.readFile(path.join(root, 'mcp.json'), 'utf8')); mcpServers = mcp.mcpServers || {}; } catch { /* MCP opcional. */ }
        plugins.push({ id, name: manifest.displayName || manifest.interface?.displayName || id, version: manifest.version, description: manifest.description, root, source: entry.scope, scope: entry.scope, projectPath: entry.scope === 'project' ? path.resolve(projectPath) : undefined, skills, mcpServers, warnings: [], builtIn: entry.builtIn === true });
      } catch { /* Manifest inválido: no se carga. */ }
    }
  }
  return plugins.sort((left, right) => String(left.name).localeCompare(String(right.name)));
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
      const browsers = await Promise.all((Object.keys(browserExtensionManagers) as BrowserExtensionManagerId[]).map(async id => ({
        id,
        name: browserExtensionManagers[id].name,
        installed: Boolean(await findBrowserExecutable(id)),
        connected: browserExtensionBridge.list().some(client => {
          const name = client.name.toLowerCase();
          return id === 'edge' ? name.includes('edge') : id === 'chrome' ? name.includes('chrome') : id === 'brave' ? name.includes('brave') : id === 'opera' ? name.includes('opera') : name.includes('vivaldi');
        }),
      })));
      return { browsers, extensionId: 'pomkkenhcjkfjdabdhogladflacafopd' };
    }
    case 'codeclub_browser_extension_manage': {
      if (process.platform !== 'win32') throw new Error('El instalador de extensiones está disponible en Windows.');
      const id = String(args.browser || '') as BrowserExtensionManagerId;
      if (!Object.hasOwn(browserExtensionManagers, id)) throw new Error('Navegador no compatible.');
      if (!['install', 'uninstall'].includes(String(args.action || ''))) throw new Error('Acción de extensión inválida.');
      const browser = browserExtensionManagers[id];
      const executable = await findBrowserExecutable(id);
      if (!executable) throw new Error(`${browser.name} no está instalado en este equipo.`);
      const extensionPath = args.action === 'install' ? await prepareBrowserExtension() : undefined;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, [browser.page], { detached: true, stdio: 'ignore', windowsHide: false });
        child.once('error', reject);
        child.once('spawn', () => { child.unref(); resolve(); });
      });
      if (extensionPath) {
        const error = await shell.openPath(extensionPath);
        if (error) throw new Error(`No se pudo abrir la carpeta de la extensión: ${error}`);
      }
      return { ok: true, browser: id, action: args.action === 'install' ? 'install' : 'uninstall', extensionPath };
    }
    case 'codeclub_list_files': return listProjectFiles(String(args.projectPath || ''), Number(args.maxFiles) || 400);
    case 'codeclub_path_kind': {
      const target = await resolveProjectFile(String(args.projectPath || ''), String(args.path || '.'));
      try {
        const stat = await fs.stat(target);
        return { kind: stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other' };
      } catch {
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
      return mcpRequest(session, 'tools/call', { name: request.name, arguments: request.arguments || {} });
    }
    case 'codeclub_mcp_stdio_close': {
      const session = nativeMcpSessions.get(String(args.sessionId));
      if (session) { session.child.kill(); nativeMcpSessions.delete(String(args.sessionId)); }
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
      const target = pluginFile(scope, projectPath, String(args.pluginId || '').trim().toLowerCase(), String(args.path || ''));
      return { content: await fs.readFile(target, 'utf8'), scope, pluginPath: pluginDirectory(scope, projectPath, String(args.pluginId || '').trim().toLowerCase()) };
    }
    case 'codeclub_agent_plugin_write_file': {
      const projectPath = String(args.projectPath || '');
      const scope = normalizePluginScope(args.scope, projectPath);
      const pluginId = String(args.pluginId || '').trim().toLowerCase();
      const target = pluginFile(scope, projectPath, pluginId, String(args.path || ''));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, String(args.content ?? ''), 'utf8');
      return { ok: true, path: String(args.path || ''), absolutePath: target, scope, pluginPath: pluginDirectory(scope, projectPath, pluginId) };
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
      if (Number.isFinite(Number(args.offset))) {
        const offset = Math.max(0, Math.floor(Number(args.offset)));
        const truncated = offset < session.bufferOffset;
        const start = truncated ? 0 : Math.min(session.buffer.length, offset - session.bufferOffset);
        return { info: session.info, output: session.buffer.slice(start), offset: nextOffset, truncated };
      }
      return { info: session.info, output: session.buffer, offset: nextOffset, truncated: false };
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
    { label: 'Abrir', click: showMainWindow },
    { label: 'Widget', click: () => {
      if (!floatingChat?.isActive()) { mainWindow?.hide(); void floatingChat?.show().catch(() => showMainWindow()); }
      else floatingChat?.hide();
    } },
    { type: 'separator' },
    { label: 'Salir', click: () => { isQuitting = true; app.quit(); } },
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
  if (devUrl) void mainWindow.loadURL(devUrl); else void mainWindow.loadFile(path.join(root, '..', 'out', 'index.html'));
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
// Expone el árbol de accesibilidad de Chromium a UI Automation/Computer Use.
app.commandLine.appendSwitch('force-renderer-accessibility');
const accessibilityDebugMode = !app.isPackaged && app.commandLine.hasSwitch('codeclub-a11y-debug');
app.whenReady().then(async () => {
  if (!ownsAppInstance) return;
  if (accessibilityDebugMode) app.setAccessibilitySupportEnabled(true);
  void browserExtensionBridge.start();
  app.once('will-quit', () => browserExtensionBridge.stop());
  credentialVault=new CredentialVault(app.getPath('userData'),safeStorage);
  credentialVault.migrate(path.join(app.getPath('userData'),'settings.json'));
  taskScheduler = new TaskScheduler(path.join(app.getPath('userData'), 'scheduled-tasks.json'), executeScheduledTask, publishTaskChange, (task, run) => {
    if (task.notifications === 'Sin notificaciones' || (task.notifications === 'Solo errores' && run.status === 'completed')) return;
    if (Notification.isSupported()) {
      const notice = new Notification({ title: task.name, body: task.language === 'en' ? (run.status === 'completed' ? 'Task completed' : 'Task needs attention') : (run.status === 'completed' ? 'Tarea completada' : 'La tarea requiere atención') });
      notice.on('click', () => { selectedSessionChat = { chatId: run.chatId, projectPath: task.projectPath, name: task.name }; showMainWindow(); }); notice.show();
    }
  });
  ipcMain.handle('codeclub:tasks-list', (event, projectPath: string) => { requireTaskUi(event); return taskScheduler!.list(String(projectPath || '')); });
  ipcMain.handle('codeclub:tasks-save', async (event, projectPath: string, task: ScheduledTask) => {
    requireTaskUi(event);
    if (projectPath && !(await fs.stat(path.resolve(projectPath))).isDirectory()) throw new Error('TASK_INVALID_PROJECT');
    return taskScheduler!.save(String(projectPath || ''), task);
  });
  ipcMain.handle('codeclub:tasks-delete', (event, projectPath: string, id: string) => { requireTaskUi(event); return taskScheduler!.remove(String(projectPath || ''), id); });
  ipcMain.handle('codeclub:tasks-run', (event, projectPath: string, id: string) => { requireTaskUi(event); return taskScheduler!.run(String(projectPath || ''), id); });
  ipcMain.handle('codeclub:tasks-cancel', (event, projectPath: string, id: string) => {
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
  ipcMain.handle('codeclub:task-assignment', event => { const worker = taskWorkers.get(event.sender.id); return worker ? { task: worker.task, run: worker.run } : null; });
  ipcMain.handle('codeclub:task-finish', (event, error?: string) => { const worker = taskWorkers.get(event.sender.id); if (!worker) throw new Error('Unauthorized task runner'); worker.complete(error); });
  const integrations=new ActivityIntegrations(path.join(app.getPath('userData'),'activity-integrations.json'),credentialVault,sessionHub);
  const relayHelper=app.isPackaged?path.join(process.resourcesPath,'agent-relay.ps1'):path.join(root,'..','electron','agent-relay.ps1');
  const relay=new AgentRelay(app.getPath('userData'),relayHelper,sessionHub);
  const updateRelay=()=>{if(integrations.getConfig().externalAgents&&!integrations.getConfig().paused)void relay.start().catch(()=>sessionHub.external('relay-status','External agents','error'));else relay.stop();};
  ipcMain.handle('codeclub:integration-config',event=>{requireAppSender(event);return integrations.getConfig();});
  ipcMain.handle('codeclub:integration-save',(event,config)=>{requireAppSender(event);const saved=integrations.save(config);updateRelay();return saved;});
  ipcMain.handle('codeclub:hooks-preview',async event=>{requireAppSender(event);const result=await dialog.showOpenDialog({properties:['openDirectory']});if(result.canceled||!result.filePaths[0])return null;return relay.preview(result.filePaths[0]);});
  ipcMain.handle('codeclub:hooks-install',(event,id:string)=>{requireAppSender(event);return relay.install(id);});
  updateRelay();app.once('will-quit',()=>relay.stop());
  integrations.start();
  app.once('will-quit',()=>integrations.stop());
  ipcMain.handle('codeclub:credential-present',(event,key:string)=>{requireAppSender(event);return credentialVault.present(key);});
  ipcMain.handle('codeclub:credential-set',(event,key:string,value:string,origin?:string)=>{requireAppSender(event);credentialVault.set(key,value,origin);});
  ipcMain.handle('codeclub:external-open',(event,url:string)=>{requireAppSender(event);const target=new URL(url);if(target.protocol!=='https:')throw new Error('Invalid external URL');return shell.openExternal(target.href);});
  ipcMain.handle('codeclub:sessions-list', event => { requireAppSender(event); return sessionHub.list().map(session=>({...session,localOwner:session.owner===event.sender.id})); });
  ipcMain.handle('codeclub:session-select', (event, chat: SessionChat) => { requireAppSender(event); if(chat?.chatId&&typeof chat.projectPath==='string')selectedSessionChat={chatId:chat.chatId,projectPath:chat.projectPath,name:chat.name,projectName:chat.projectName}; });
  ipcMain.handle('codeclub:session-selected', event => { requireAppSender(event);return selectedSessionChat; });
  ipcMain.handle('codeclub:session-claim', (event, chat: SessionChat) => { requireAppSender(event); return sessionHub.claim(event.sender.id,chat); });
  ipcMain.handle('codeclub:session-publish', (event, chat: SessionChat, runId: string, update: any) => { requireAppSender(event); return sessionHub.publish(event.sender.id,chat,runId,update); });
  ipcMain.handle('codeclub:session-command', (event, chat: SessionChat, action: string, approvalId?: string) => {
    requireAppSender(event);const command=sessionHub.command(chat,action,approvalId);if(!command)return false;
    const owner=BrowserWindow.getAllWindows().find(win=>!win.isDestroyed()&&!win.webContents.isDestroyed()&&win.webContents.id===command.owner);
    if(!owner){sessionHub.disconnect(command.owner);return false;}
    if (action === 'cancel') taskWorkers.get(command.owner)?.controller.abort();
    owner.webContents.send('codeclub:session-command',command);return true;
  });
  ipcMain.handle('codeclub:session-open', (event, chat: SessionChat) => { requireAppSender(event);if(!chat?.chatId||typeof chat.projectPath!=='string')return;selectedSessionChat={chatId:chat.chatId,projectPath:chat.projectPath,name:chat.name,projectName:chat.projectName};showMainWindow(); });
  const chatStore = new ChatStore(app.getPath('userData'));
  chatStore.migrateGlobalSettings();
  ipcMain.handle('chats:page', (_event, project: string, id: string, before?: number, limit?: number) => chatStore.page(project, id, before, limit));
  ipcMain.handle('chats:turn-page', (_event, project: string, id: string, before?: number, limit?: number, direction?: 'before'|'after') => chatStore.turnPage(project, id, before, limit, direction));
  ipcMain.handle('chats:context', (_event, project: string, id: string) => chatStore.context(project,id));
  ipcMain.handle('chats:tail', (_event, project: string, id: string, start: number, messages: any[], expectedTotal?:number) => chatStore.saveTail(project, id, start, messages,expectedTotal));
  ipcMain.handle('chats:append', (_event, project: string, id: string, message: any) => chatStore.append(project, id, message));
  ipcMain.handle('chats:all', (_event, project: string, id: string) => chatStore.all(project, id));
  ipcMain.handle('chats:search', (_event, project: string, id: string, query: string) => chatStore.search(project, id, query));
  ipcMain.handle('chats:copy', (_event, from: string, to: string, id: string) => chatStore.copy(from, to, id));
  ipcMain.handle('chats:delete', (_event, project: string, id: string) => chatStore.delete(project, id));
  ipcMain.handle('chats:transcript', (_event, project: string, id: string, markdown: string) => chatStore.transcript(project, id, markdown));
  app.once('will-quit', () => chatStore.close());
  await loadProjects();
  ipcMain.handle('projects:list', () => projects);
  ipcMain.handle('projects:select-folder', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); if (result.canceled || !result.filePaths[0]) return null; const project = registerProject(result.filePaths[0]); await saveProjects(); return project; });
  ipcMain.handle('files:select', async () => { const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('files:read', async (_event, filePath: string) => Array.from(await fs.readFile(filePath)));
  ipcMain.handle('files:read-text', async (_event, filePath: string) => fs.readFile(filePath, 'utf8'));
  ipcMain.handle('files:exists', async (_event, filePath: string) => { try { await fs.access(filePath); return true; } catch { return false; } });
  ipcMain.handle('files:mkdir', async (_event, directory: string) => { await fs.mkdir(directory, { recursive: true }); return true; });
  ipcMain.handle('files:write-text', async (_event, filePath: string, content: string) => { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, String(content ?? ''), 'utf8'); return true; });
  ipcMain.handle('files:remove', async (_event, filePath: string) => { await fs.rm(filePath, { recursive: true, force: true }); return true; });
  ipcMain.handle('path:join', (_event, parts: string[]) => path.join(...(Array.isArray(parts) ? parts : [])));
  ipcMain.handle('path:app-config', () => app.getPath('userData'));
  ipcMain.handle('path:app-cache', () => path.join(app.getPath('userData'), 'cache'));
  ipcMain.handle('native:invoke', async (event, payload: { command: string; args?: Record<string, unknown> }) => {
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
      const workspaceCommands = ['codeclub_list_files', 'codeclub_read_file', 'codeclub_search_text', 'codeclub_write_file', 'codeclub_run_command'];
      const requestedProject = workspaceCommands.includes(payload.command) ? String(payload.args?.projectPath || '') : String((payload.args?.request as any)?.projectPath || payload.args?.projectPath || '');
      if (requestedProject || workspaceCommands.includes(payload.command)) {
        const expected = worker.task.projectPath || (process.platform === 'win32' ? `${process.env.SystemDrive || 'C:'}\\` : '/');
        if (!requestedProject || path.resolve(requestedProject).toLowerCase() !== path.resolve(expected).toLowerCase()) throw new Error('TASK_PROJECT_MISMATCH');
      }
    }
    if(payload.command==='codeclub_http_fetch'&&(payload.args?.request as any)?.credentialKey)requireAppSender(event);
    if (payload.command.startsWith('codeclub_external_browser_') || payload.command.startsWith('codeclub_browser_extension_')) requireAppSender(event);
    if(payload.command==='codeclub_http_abort'){
      requireAppSender(event);modelRequests.get(`${event.sender.id}:${String(payload.args?.requestId)}`)?.abort();return;
    }
    if(payload.command==='codeclub_http_fetch'){
      const request=payload.args?.request as any;
      if(request)request.requestId=`${event.sender.id}:${String(request.requestId||randomUUID())}`;
    }
    const result = await invokeNativeCommand(payload.command, payload.args, worker?.controller.signal);
    if (worker && payload.command === 'codeclub_terminal_create') worker.terminals.add(String(result.id));
    if (worker && payload.command === 'codeclub_terminal_list') return (result as any[]).filter(terminal => worker.terminals.has(String(terminal.id)));
    return result;
  });
  ipcMain.handle('chats:read-project', async (_event, projectPath: string, chatId: string) => {
    return (await chatStore.all(projectPath, chatId)).map(message => JSON.stringify(message)).join('\n');
  });
  ipcMain.handle('chats:write-project', async (_event, projectPath: string, chatId: string, content: string) => {
    await chatStore.saveTail(projectPath, chatId, 0, content.split('\n').filter(line => line.trim()).map(line => JSON.parse(line)));
    return true;
  });
  ipcMain.handle('projects:switch', async (_event, id: string) => { const project = projects.find((item) => item.id === id); if (!project) throw new Error('Proyecto no encontrado.'); project.lastOpenedAt = new Date().toISOString(); await saveProjects(); return project; });
  ipcMain.handle('projects:rename', async (_event, id: string, name: string) => {
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
    computerOverlayPaletteIndex = index;
    if (computerOverlayActive) {
      for (const overlay of computerOverlayWindows) overlay.destroy();
      computerOverlayWindows.clear();
      createComputerOverlay(computerOverlayLanguage, computerOverlayPaletteIndex);
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.id !== sender.id && !window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send('codeclub:orb-palette-change', index);
      }
    }
  });
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window:maximize', (event) => { const window = BrowserWindow.fromWebContents(event.sender); if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); });
  ipcMain.handle('window:is-full-screen', (event) => BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false);
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.handle('app:reload', (event) => BrowserWindow.fromWebContents(event.sender)?.webContents.reload());
  ipcMain.handle('app:update-status', () => autoUpdateState);
  ipcMain.handle('app:check-for-updates', async () => {
    if (!app.isPackaged) return { state: 'not-available' } satisfies AutoUpdateState;
    if (['checking', 'downloading', 'downloaded'].includes(autoUpdateState.state)) return autoUpdateState;
    try { await autoUpdater.checkForUpdates(); return autoUpdateState; } catch (error) { const state = { state: 'error', error: error instanceof Error ? error.message : String(error) } satisfies AutoUpdateState; publishAutoUpdate(state); return state; }
  });
  ipcMain.handle('app:install-update', () => { if (autoUpdateState.state === 'downloaded') autoUpdater.quitAndInstall(); return autoUpdateState; });
  ipcMain.handle('computer:overlay', (_event, payload: { active?: boolean; language?: string; paletteIndex?: number }) => setComputerOverlay(Boolean(payload?.active), payload?.language === 'en' ? 'en' : 'es', payload?.paletteIndex));
  ipcMain.on('computer:menu-action', (_event, action: string) => {
    if (computerMenuWindow && !computerMenuWindow.isDestroyed()) computerMenuWindow.close();
    if (action === 'close') return;
    mainWindow?.webContents.send('computer:context-action', { action, ...(lastComputerContext || {}) });
  });
  floatingChat = createFloatingChat(root, showMainWindow, updateTrayMenu);
  createWindow();
  createTray();
  taskScheduler.start();
  setupAutoUpdater();
  app.on('activate', showMainWindow);
});

app.on('before-quit', () => { isQuitting = true; for (const stop of activeCommands) stop(); taskScheduler?.stop(); for (const worker of taskWorkers.values()) worker.complete('TASK_INTERRUPTED'); floatingChat?.destroy(); desktopControl.stop(); destroyComputerOverlay(); tray?.destroy(); });
app.on('window-all-closed', () => { /* La app permanece disponible en la bandeja. */ });
