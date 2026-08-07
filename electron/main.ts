import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { promises as fs } from 'node:fs';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Project = { id: string; name: string; path: string; createdAt: string; lastOpenedAt?: string };

const root = path.dirname(fileURLToPath(import.meta.url));
let projects: Project[] = [];
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;
const execFile = promisify(execFileCallback);
type NativeMcpSession = { child: ReturnType<typeof spawn>; nextId: number; pending: Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }> };
const nativeMcpSessions = new Map<string, NativeMcpSession>();
type NativeTerminal = { child: ReturnType<typeof spawn>; info: any; buffer: string };
const nativeTerminals = new Map<string, NativeTerminal>();
let browserWindow: BrowserWindow | null = null;

const projectsFile = () => path.join(app.getPath('userData'), 'projects.json');
const projectChatFile = (projectPath: string, chatId: string) => path.join(app.getPath('userData'), 'chat-history', encodeURIComponent(projectPath), `${encodeURIComponent(chatId)}.jsonl`);
const projectId = (value: string) => value.toLowerCase().replace(/[\\/:*?"<>|\s]+/g, '-');

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

async function listProjectFiles(projectPath: string, maxFiles: number) {
  const result: Array<{ path: string; kind: string; size?: number }> = [];
  async function visit(folder: string, relative = ''): Promise<void> {
    if (result.length >= maxFiles) return;
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
      const entryRelative = relative ? path.join(relative, entry.name) : entry.name;
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        result.push({ path: entryRelative.replaceAll(path.sep, '/'), kind: 'directory' });
        await visit(entryPath, entryRelative);
      } else {
        const stat = await fs.stat(entryPath);
        result.push({ path: entryRelative.replaceAll(path.sep, '/'), kind: 'file', size: stat.size });
      }
      if (result.length >= maxFiles) return;
    }
  }
  await visit(path.resolve(projectPath));
  return result.slice(0, maxFiles);
}

async function searchProjectText(projectPath: string, query: string, maxMatches: number) {
  const files = await listProjectFiles(projectPath, 1200);
  const matches: Array<{ path: string; line: number; preview: string }> = [];
  for (const entry of files) {
    if (entry.kind !== 'file' || matches.length >= maxMatches) continue;
    try {
      const content = await fs.readFile(projectFile(projectPath, entry.path), 'utf8');
      content.split(/\r?\n/).forEach((line, index) => {
        if (matches.length < maxMatches && line.toLowerCase().includes(String(query).toLowerCase())) matches.push({ path: entry.path, line: index + 1, preview: line.trim().slice(0, 240) });
      });
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
  const initialize = await mcpRequest(session, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Codeclub', version: '0.1.0' } });
  void initialize;
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const tools = await mcpRequest(session, 'tools/list', {});
  const sessionId = `mcp-${String(request.name || 'server')}-${Date.now()}`;
  nativeMcpSessions.set(sessionId, session);
  return { sessionId, tools: tools?.tools || [] };
}

async function listAgentPlugins(projectPath: string) {
  const roots = [
    ...(String(projectPath || '').trim() ? [{ root: path.join(projectPath, '.codeclub', 'plugins'), source: 'project' }] : []),
    { root: path.join(app.getPath('userData'), 'plugins'), source: 'global' },
  ];
  const plugins: any[] = [];
  for (const entry of roots) {
    let children: any[] = [];
    try { children = await fs.readdir(entry.root, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory()) continue;
      const root = path.join(entry.root, child.name);
      try {
        const manifest = JSON.parse(await fs.readFile(path.join(root, 'plugin.json'), 'utf8'));
        const skills: any[] = [];
        const skillsRoot = path.join(root, 'skills');
        for (const skill of await fs.readdir(skillsRoot, { withFileTypes: true }).catch(() => [] as any[])) {
          if (!skill.isDirectory()) continue;
          const skillPath = path.join(skillsRoot, skill.name, 'SKILL.md');
          try {
            const content = await fs.readFile(skillPath, 'utf8');
            const name = content.match(/^name:\s*(.+)$/m)?.[1]?.trim();
            const description = content.match(/^description:\s*(.+)$/m)?.[1]?.trim();
            if (name && description) skills.push({ id: skill.name, name, description, content, pluginName: manifest.name || child.name });
          } catch { /* Skill incompleta: se omite. */ }
        }
        let mcpServers: Record<string, unknown> = {};
        try { const mcp = JSON.parse(await fs.readFile(path.join(root, 'mcp.json'), 'utf8')); mcpServers = mcp.mcpServers || {}; } catch { /* MCP opcional. */ }
        plugins.push({ id: manifest.name || child.name, name: manifest.name || child.name, version: manifest.version, description: manifest.description, root, source: entry.source, skills, mcpServers, warnings: [] });
      } catch { /* Manifest inválido: no se carga. */ }
    }
  }
  return plugins.sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

async function powershellJson(script: string) {
  if (process.platform !== 'win32') throw new Error('Computer Use solo está disponible en Windows.');
  const output = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(output.stdout.trim() || '{}');
}

async function computerListWindows() {
  return powershellJson(`Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { [pscustomobject]@{ title=$_.MainWindowTitle; className=''; handle=$_.MainWindowHandle.ToInt64(); bounds=@() } } | ConvertTo-Json -Compress`);
}

async function computerScreenshot() {
  return powershellJson(`Add-Type -AssemblyName System.Drawing; Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $i=New-Object Drawing.Bitmap $b.Width,$b.Height; $g=[Drawing.Graphics]::FromImage($i); $g.CopyFromScreen($b.Location,[Drawing.Point]::Empty,$b.Size); $p=Join-Path $env:TEMP ('codeclub-'+[guid]::NewGuid().ToString()+'.png'); $i.Save($p,[Drawing.Imaging.ImageFormat]::Png); $g.Dispose();$i.Dispose();$d=[Convert]::ToBase64String([IO.File]::ReadAllBytes($p));Remove-Item $p -Force; [pscustomobject]@{mimeType='image/png';data=$d;width=$b.Width;height=$b.Height}|ConvertTo-Json -Compress`);
}

async function computerAction(request: any) {
  const action = String(request.action || '');
  const text = String(request.text || request.key || '').replaceAll("'", "''");
  const x = Number(request.x || 0); const y = Number(request.y || 0);
  const mouse = ['move', 'click', 'doubleClick', 'rightClick'].includes(action) ? `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Cursor]::Position=New-Object Drawing.Point(${x},${y});` : '';
  const click = action === 'click' ? '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}");' : action === 'doubleClick' ? '[System.Windows.Forms.SendKeys]::SendWait("{ENTER}{ENTER}");' : '';
  const input = action === 'type' || action === 'key' ? `[System.Windows.Forms.SendKeys]::SendWait('${text}');` : '';
  return powershellJson(`Add-Type -AssemblyName System.Windows.Forms; ${mouse}${click}${input}[pscustomobject]@{ok=$true;action='${action}'}|ConvertTo-Json -Compress`);
}

function shellCommand(shell: string) {
  if (shell === 'cmd') return { command: 'cmd.exe', args: ['/K'], label: 'Command Prompt' };
  if (shell === 'git-bash') return { command: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'], label: 'Git Bash' };
  if (shell === 'wsl') return { command: 'wsl.exe', args: [], label: 'WSL2' };
  return { command: 'powershell.exe', args: ['-NoLogo'], label: 'PowerShell' };
}

function createNativeTerminal(request: any) {
  const shell = shellCommand(request.shell || 'powershell');
  const cwd = path.resolve(request.cwd || request.projectPath || process.cwd());
  const id = `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const child = spawn(shell.command, shell.args, { cwd, env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, shell: false });
  const info = { id, name: String(request.name || 'Terminal'), shell: shell.label, cwd, projectPath: request.projectPath, is_agent: Boolean(request.isAgent), created_at: String(Date.now()), status: 'running' };
  const session: NativeTerminal = { child, info, buffer: '' };
  const append = (data: Buffer | string) => { session.buffer = `${session.buffer}${data.toString()}`.slice(-240000); };
  child.stdout?.on('data', append); child.stderr?.on('data', append);
  child.on('exit', () => { session.info.status = 'exited'; });
  child.on('error', (error) => { append(`\r\n${error.message}\r\n`); session.info.status = 'error'; });
  nativeTerminals.set(id, session);
  return info;
}

async function createBrowserSurface(url: string, x: number, y: number, width: number, height: number) {
  if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close();
  const parentBounds = mainWindow?.getBounds() || { x: 0, y: 0 };
  browserWindow = new BrowserWindow({
    parent: mainWindow || undefined,
    frame: false,
    show: false,
    x: Math.round(parentBounds.x + x),
    y: Math.round(parentBounds.y + y),
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  browserWindow.on('closed', () => { browserWindow = null; });
  await browserWindow.loadURL(url);
  browserWindow.show();
}

async function invokeNativeCommand(command: string, args: any = {}) {
  switch (command) {
    case 'codeclub_list_files': return listProjectFiles(args.projectPath, Math.min(Number(args.maxFiles) || 400, 1200));
    case 'codeclub_read_file': return fs.readFile(projectFile(args.projectPath, args.path), 'utf8');
    case 'codeclub_search_text': return searchProjectText(args.projectPath, args.query, Math.min(Number(args.maxMatches) || 80, 200));
    case 'codeclub_write_file': {
      const target = projectFile(args.projectPath, args.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, String(args.content ?? ''), 'utf8');
      return { ok: true, path: args.path };
    }
    case 'codeclub_run_command': {
      const request = args.request || {};
      const cwd = request.cwd ? projectFile(args.projectPath, request.cwd) : path.resolve(args.projectPath);
      try {
        const output = await execFile(String(request.command), Array.isArray(request.args) ? request.args.map(String) : [], { cwd, windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
        return { stdout: output.stdout, stderr: output.stderr, code: 0 };
      } catch (error: any) {
        return { stdout: error.stdout || '', stderr: error.stderr || String(error.message || error), code: Number(error.code) || 1 };
      }
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
      const target = path.join(app.getPath('userData'), 'agent-plugins', String(args.pluginId));
      await fs.mkdir(target, { recursive: true });
      return target;
    }
    case 'codeclub_list_agent_plugins': return listAgentPlugins(String(args.projectPath || ''));
    case 'codeclub_terminal_list': return Array.from(nativeTerminals.values()).map((session) => session.info);
    case 'codeclub_terminal_create': return createNativeTerminal(args.request || {});
    case 'codeclub_terminal_snapshot': {
      const session = nativeTerminals.get(String(args.id));
      if (!session) throw new Error('Terminal no encontrada.');
      return { info: session.info, output: session.buffer };
    }
    case 'codeclub_terminal_write': {
      const session = nativeTerminals.get(String(args.id));
      if (!session || !session.child.stdin) throw new Error('Terminal no encontrada.');
      session.child.stdin.write(String(args.data || ''));
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
    case 'codeclub_browser_create': return createBrowserSurface(String(args.url), Number(args.x) || 0, Number(args.y) || 0, Number(args.width) || 800, Number(args.height) || 600);
    case 'codeclub_browser_set_bounds': {
      if (!browserWindow || browserWindow.isDestroyed()) return null;
      const parentBounds = mainWindow?.getBounds() || { x: 0, y: 0 };
      browserWindow.setBounds({ x: Math.round(parentBounds.x + Number(args.x || 0)), y: Math.round(parentBounds.y + Number(args.y || 0)), width: Math.max(1, Math.round(Number(args.width) || 800)), height: Math.max(1, Math.round(Number(args.height) || 600)) });
      return null;
    }
    case 'codeclub_browser_navigate': { if (browserWindow && !browserWindow.isDestroyed()) await browserWindow.loadURL(String(args.url)); return null; }
    case 'codeclub_browser_close': { if (browserWindow && !browserWindow.isDestroyed()) browserWindow.close(); browserWindow = null; return null; }
    case 'codeclub_browser_set_visible': { if (browserWindow && !browserWindow.isDestroyed()) args.visible ? browserWindow.show() : browserWindow.hide(); return null; }
    case 'codeclub_browser_eval': return browserWindow && !browserWindow.isDestroyed() ? browserWindow.webContents.executeJavaScript(String(args.script)) : null;
    case 'codeclub_browser_get_url': return browserWindow && !browserWindow.isDestroyed() ? browserWindow.webContents.getURL() : '';
    case 'codeclub_popup_window': return null;
    case 'codeclub_computer_list_windows': return computerListWindows();
    case 'codeclub_computer_screenshot': return computerScreenshot();
    case 'codeclub_computer_get_state': return { focused_window: null, focused_element: null, elements: [], note: 'UI Automation profundo no disponible; use computerScreenshot.' };
    case 'codeclub_computer_action': return computerAction(args.request || {});
    default: throw new Error(`El comando nativo ${command} todavía no está implementado en Electron.`);
  }
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  if (!mainWindow.isMaximized()) mainWindow.maximize();
}

function createTray() {
  const iconPath = path.join(root, '..', 'public', 'logo.png');
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Codeclub');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir', click: showMainWindow },
    { type: 'separator' },
    { label: 'Salir', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: {
      preload: path.join(root, '..', 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform === 'win32' && typeof mainWindow.setBackgroundMaterial === 'function') mainWindow.setBackgroundMaterial('acrylic');
  mainWindow.on('close', (event) => { if (!isQuitting) { event.preventDefault(); mainWindow?.hide(); } });
  mainWindow.once('ready-to-show', showMainWindow);
  const devUrl = process.env.CODECLUB_NEXT_DEV_URL;
  if (devUrl) void mainWindow.loadURL(devUrl); else void mainWindow.loadFile(path.join(root, '..', 'out', 'index.html'));
}

app.setAppUserModelId('com.codeclub.desktop');
app.whenReady().then(async () => {
  await loadProjects();
  ipcMain.handle('projects:list', () => projects);
  ipcMain.handle('projects:select-folder', async () => { const result = await dialog.showOpenDialog({ properties: ['openDirectory'] }); if (result.canceled || !result.filePaths[0]) return null; const project = registerProject(result.filePaths[0]); await saveProjects(); return project; });
  ipcMain.handle('files:select', async () => { const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }); return result.canceled ? [] : result.filePaths; });
  ipcMain.handle('files:read', async (_event, filePath: string) => Array.from(await fs.readFile(filePath)));
  ipcMain.handle('files:read-text', async (_event, filePath: string) => fs.readFile(filePath, 'utf8'));
  ipcMain.handle('native:invoke', async (_event, payload: { command: string; args?: Record<string, unknown> }) => invokeNativeCommand(payload.command, payload.args));
  ipcMain.handle('chats:read-project', async (_event, projectPath: string, chatId: string) => {
    try { return await fs.readFile(projectChatFile(projectPath, chatId), 'utf8'); } catch { return ''; }
  });
  ipcMain.handle('chats:write-project', async (_event, projectPath: string, chatId: string, content: string) => {
    const filePath = projectChatFile(projectPath, chatId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
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
  ipcMain.handle('window:minimize', (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.handle('window:maximize', (event) => { const window = BrowserWindow.fromWebContents(event.sender); if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); });
  ipcMain.handle('window:close', (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  createWindow();
  createTray();
  app.on('activate', showMainWindow);
});

app.on('before-quit', () => { isQuitting = true; tray?.destroy(); });
app.on('window-all-closed', () => { /* La app permanece disponible en la bandeja. */ });
