/** Owns the always-on-top floating renderer, persisted placement, and visibility/resize lifecycle. */
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function createFloatingChat(root: string, openMain: () => void, onVisibilityChange: () => void) {
  let window: BrowserWindow | null = null;
  let expanded = false;
  let retracted = false;
  let ready = false;
  let requested = false;
  let visibilityRevision = 0;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let resizeTimer: ReturnType<typeof setInterval> | undefined;
  let anchor: 'top' | 'bottom' = 'bottom';
  let position: { x: number; y: number } | null = null;
  let moveTimer: ReturnType<typeof setTimeout> | undefined;
  let saveQueue = Promise.resolve();
  let drag: { cursor: Electron.Point; bounds: Electron.Rectangle } | null = null;
  const positionFile = () => path.join(app.getPath('userData'), 'floating-position.json');

  function fit(snap = false, animate = false) {
    if (!window || window.isDestroyed()) return;
    clearInterval(resizeTimer); resizeTimer = undefined;
    const bounds = window.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    if (snap) anchor = bounds.y + bounds.height / 2 < area.y + area.height / 2 ? 'top' : 'bottom';
    const width = Math.min(460, area.width);
    const height = Math.min(retracted ? 52 : expanded ? 300 : 92, area.height);
    const x = Math.round(Math.max(area.x, Math.min(bounds.x, area.x + area.width - width)));
    const y = anchor === 'top' ? area.y : area.y + area.height - height;
    if (bounds.x !== x || bounds.y !== y || bounds.width !== width || bounds.height !== height) {
      if (animate && window.isVisible()) {
        const started = Date.now();
        resizeTimer = setInterval(() => {
          if (!window || window.isDestroyed()) { clearInterval(resizeTimer); resizeTimer = undefined; return; }
          const progress = Math.min(1, (Date.now() - started) / 160);
          const ease = 1 - Math.pow(1 - progress, 3);
          window.setBounds({ x, width, y: Math.round(bounds.y + (y - bounds.y) * ease), height: Math.round(bounds.height + (height - bounds.height) * ease) });
          if (progress === 1) { clearInterval(resizeTimer); resizeTimer = undefined; }
        }, 16);
      } else window.setBounds({ x, y, width, height });
    }
    position = { x, y };
    const saved = JSON.stringify({ ...position, anchor });
    saveQueue = saveQueue.then(() => fs.writeFile(positionFile(), saved)).catch(() => undefined);
  }

  async function show() {
    clearTimeout(hideTimer);
    visibilityRevision++;
    expanded = false; retracted = false;
    requested = true;
    onVisibilityChange();
    if (window && !window.isDestroyed()) {
      if (ready) { fit(); window.setIgnoreMouseEvents(false); window.showInactive(); window.webContents.send('codeclub:floating-show'); }
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
    const height = Math.min(92, area.height);
    window = new BrowserWindow({
      title: 'Codeclub · Orb', x: position?.x ?? Math.round(area.x + (area.width - width) / 2),
      y: position?.y ?? area.y + area.height - height, width, height,
      frame: false, transparent: true, backgroundColor: '#00000000', hasShadow: false,
      resizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true,
      alwaysOnTop: true, show: false,
      webPreferences: { preload: path.join(root, '..', 'electron', 'preload.cjs'), contextIsolation: true, nodeIntegration: false, webviewTag: false, backgroundThrottling: false },
    });
    fit();
    window.once('ready-to-show', () => {
      ready = true;
      if (requested) { window?.showInactive(); window?.webContents.send('codeclub:floating-show'); }
    });
    window.on('moved', () => { if (drag || resizeTimer) return; clearTimeout(moveTimer); moveTimer = setTimeout(() => fit(true), 180); });
    window.on('close', event => { event.preventDefault(); hide(); });
    window.on('closed', () => { window = null; ready = false; });
    const devUrl = process.env.CODECLUB_NEXT_DEV_URL;
    if (devUrl) await window.loadURL(`${devUrl}/?floating=1`);
    else await window.loadFile(path.join(root, '..', 'out', 'index.html'), { query: { floating: '1' } });
  }

  function finishHide(revision: number) {
    if (requested || revision !== visibilityRevision) return;
    clearTimeout(hideTimer);
    if (window && !window.isDestroyed()) window.hide();
  }
  function hide() {
    if (!requested) return;
    requested = false; drag = null;
    clearInterval(resizeTimer); resizeTimer = undefined;
    const revision = ++visibilityRevision;
    onVisibilityChange();
    if (ready && window && !window.isDestroyed()) {
      window.webContents.send('codeclub:floating-hide', revision);
      hideTimer = setTimeout(() => finishHide(revision), 250);
    } else finishHide(revision);
  }
  ipcMain.handle('codeclub:floating-close', event => { if (event.sender === window?.webContents) hide(); });
  ipcMain.handle('codeclub:floating-hidden', (event, revision: number) => { if (event.sender === window?.webContents) finishHide(revision); });
  ipcMain.handle('codeclub:floating-drag', (event, phase: string, point: Electron.Point) => {
    if (!window || event.sender !== window.webContents) return;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    if (phase === 'start') {
      clearTimeout(moveTimer);
      clearInterval(resizeTimer); resizeTimer = undefined;
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
  ipcMain.handle('codeclub:floating-resize', (event, value: boolean | string, animate = true) => {
    if (event.sender !== window?.webContents) return;
    const nextExpanded = value === true || value === 'expanded';
    const nextRetracted = value === 'retracted';
    if (expanded === nextExpanded && retracted === nextRetracted) return;
    expanded = value === true || value === 'expanded';
    retracted = value === 'retracted';
    fit(false, animate === true);
  });
  ipcMain.handle('codeclub:floating-pointer', (event, inside: boolean) => {
    if(event.sender!==window?.webContents || drag)return;
    window?.setIgnoreMouseEvents(!inside,{forward:true});
  });
  ipcMain.handle('codeclub:floating-open-main', event => { if (event.sender === window?.webContents) openMain(); });
  const displayChanged = () => fit();
  screen.on('display-metrics-changed', displayChanged);
  screen.on('display-removed', displayChanged);
  return { show, hide, owns: (sender: Electron.WebContents) => sender === window?.webContents, isActive: () => requested, destroy() {
    requested = false;
    clearTimeout(moveTimer);
    clearTimeout(hideTimer);
    clearInterval(resizeTimer);
    screen.removeListener('display-metrics-changed', displayChanged);
    screen.removeListener('display-removed', displayChanged);
    ipcMain.removeHandler('codeclub:floating-resize');
    ipcMain.removeHandler('codeclub:floating-open-main');
    ipcMain.removeHandler('codeclub:floating-drag');
    ipcMain.removeHandler('codeclub:floating-pointer');
    ipcMain.removeHandler('codeclub:floating-close');
    ipcMain.removeHandler('codeclub:floating-hidden');
    window?.destroy(); window = null;
  } };
}
