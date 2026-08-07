import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Tray } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Project = { id: string; name: string; path: string; createdAt: string; lastOpenedAt?: string };

const root = path.dirname(fileURLToPath(import.meta.url));
let projects: Project[] = [];
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const projectsFile = () => path.join(app.getPath('userData'), 'projects.json');
const projectChatFile = (projectPath: string, chatId: string) => path.join(app.getPath('userData'), 'chat-history', encodeURIComponent(projectPath), `${encodeURIComponent(chatId)}.jsonl`);
const projectId = (value: string) => value.toLowerCase().replace(/[\\/:*?"<>|\s]+/g, '-');

async function loadProjects() { try { projects = JSON.parse(await fs.readFile(projectsFile(), 'utf8')); } catch { projects = []; } }
async function saveProjects() { await fs.mkdir(path.dirname(projectsFile()), { recursive: true }); await fs.writeFile(projectsFile(), JSON.stringify(projects, null, 2) + '\n', 'utf8'); }
function registerProject(folder: string): Project { const existing = projects.find((item) => item.path.toLowerCase() === folder.toLowerCase()); if (existing) return existing; const project = { id: projectId(folder), name: path.basename(folder) || folder, path: folder, createdAt: new Date().toISOString() }; projects = [...projects, project]; return project; }

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
