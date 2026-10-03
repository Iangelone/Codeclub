import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function createFloatingChat(root: string, openMain: () => void, onVisibilityChange: () => void) {
  let window: BrowserWindow | null = null;
  let expanded = false;
  let ready = false;
  let requested = false;
  let anchor: 'top' | 'bottom' = 'bottom';
  let position: { x: number; y: number } | null = null;
  let moveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueue = Promise.resolve();
  let drag: { cursor: Electron.Point; bounds: Electron.Rectangle } | null = null;
  const positionFile = () => path.join(app.getPath('userData'), 'floating-position.json');

  function fit(snap = false) {
    if (!window || window.isDestroyed()) return;
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    if (snap) anchor = bounds.y + bounds.height / 2 < area.y + area.height / 2 ? 'top' : 'bottom';
    const width = Math.min(460, area.width);
    const height = Math.min(expanded ? 300 : 84, area.height);
    const x = Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)));
    const y = anchor === 'top' ? area.y : area.y + area.height - height;
    if (bounds.x !== x || bounds.y !== y || bounds.width !== width || bounds.height !== height) window.setBounds({ x, y, width, height });
    position = { x, y };
    const saved = JSON.stringify({ ...position, anchor });
    saveQueue = saveQueue.then(() => fs.writeFile(positionFile(), saved)).catch(() => undefined);
  }

  async function show() {
    requested = true;
    onVisibilityChange();
    if (window && !window.isDestroyed()) {
      if (ready) { fit(); window.show(); window.webContents.send('codeclub:floating-show'); }
      return;
    }
    try {
      const saved = JSON.parse(await fs.readFile(positionFile(), 'utf8'));
      if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) position = { x: saved.x, y: saved.y };
      anchor = saved.anchor === 'top' ? 'top' : 'bottom';
    } catch { /* First use starts centered above the taskbar. */ }
    if (!requested || window) return;
    const area = position ? screen.getDisplayNearestPoint(position).workArea : screen.getPrimaryDisplay().workArea;
    const width = Math.min(460, area.width);
    const height = Math.min(84, area.height);
    window = new BrowserWindow({
      title: 'Codeclub · Orb', x: position?.x ?? Math.round(area.x + (area.width - width) / 2),
      y: position?.y ?? area.y + area.height - height, width, height,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      alwaysOnTop: true, show: false,
      webPreferences: { preload: path.join(root, '..', 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, webviewTag: false },
    });
    fit();
    window.once('ready-to-show', () => {
      ready = true;
      if (requested) { window?.show(); window?.webContents.send('codeclub:floating-show'); }
    });
    window.on('moved', () => { if (drag) return; clearTimeout(moveTimer); moveTimer = setTimeout(() => fit(true), 180); });
    window.on('close', event => { event.preventDefault(); hide(); });
    window.on('closed', () => { window = null; ready = false; });
    const devUrl = process.env.CODECLUB_NEXT_DEV_URL;
    if (devUrl) await window.loadURL(`${devUrl}/?floating=1`);
    else await window.loadFile(path.join(root, '..', 'out', 'index.html'), { query: { floating: '1' } });
  }

  function hide() { requested = false; drag = null; window?.hide(); onVisibilityChange(); }
  ipcMain.handle('codeclub:floating-drag', (event, phase: string, point: Electron.Point) => {
    if (!window || event.sender !== window.webContents) return;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    if (phase === 'start') {
      clearTimeout(moveTimer);
      drag = { cursor: point, bounds: window.getBounds() };
      return;
    }
    if (!drag) return;
    const cursor = point;
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const x = Math.max(area.x, Math.min(drag.bounds.x + cursor.x - drag.cursor.x, area.x + area.width - drag.bounds.width));
    const y = Math.max(area.y, Math.min(drag.bounds.y + cursor.y - drag.cursor.y, area.y + area.height - drag.bounds.height));
    window.setPosition(Math.round(x), Math.round(y));
    if (phase === 'end') { drag = null; fit(true); }
  });
  ipcMain.handle('codeclub:floating-resize', (event, value: boolean) => {
    if (event.sender !== window?.webContents) return;
    expanded = value === true;
    fit();
  });
  ipcMain.handle('codeclub:floating-open-main', event => { if (event.sender === window?.webContents) openMain(); });
  const displayChanged = () => fit();
  screen.on('display-metrics-changed', displayChanged);
  screen.on('display-removed', displayChanged);
  return { show, hide, isActive: () => requested, destroy() {
    requested = false;
    clearTimeout(moveTimer);
    screen.removeListener('display-metrics-changed', displayChanged);
    screen.removeListener('display-removed', displayChanged);
    ipcMain.removeHandler('codeclub:floating-resize');
    ipcMain.removeHandler('codeclub:floating-open-main');
    ipcMain.removeHandler('codeclub:floating-drag');
    window?.destroy(); window = null;
  } };
}
