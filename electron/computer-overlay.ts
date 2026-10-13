/** Computer-use overlay and mouse context menu lifecycle, independent of the app shell. */
import { BrowserWindow, globalShortcut, screen } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';

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

const computerContextMenuHtml = (language: string, paletteIndex: number) => {
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

export function createComputerOverlayController(root: string, onCancel: () => void, onContextAction: (payload: Record<string, unknown>) => void) {
  const computerOverlayWindows = new Set<BrowserWindow>();
  let computerOverlayActive = false;
  let computerOverlayPaletteIndex = 0;
  let computerOverlayLanguage = 'es';
  let computerMouseHook: ReturnType<typeof spawn> | null = null;
  let computerMenuWindow: BrowserWindow | null = null;
  let lastComputerContext: Record<string, unknown> | null = null;

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
      // Windows may report work-area dimensions as monitor bounds; `size` retains
      // the full display dimensions, including the taskbar area.
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
      onCancel();
    });
    return { ok: true, active: true, displays: screen.getAllDisplays().length };
  }


  function handleComputerMenuAction(action: string) {
    if (computerMenuWindow && !computerMenuWindow.isDestroyed()) computerMenuWindow.close();
    if (action === 'close') return;
    onContextAction({ action, ...(lastComputerContext || {}) });
  }

  function updateComputerOverlayPalette(index: number) {
    computerOverlayPaletteIndex = index;
    if (computerOverlayActive) {
      for (const overlay of computerOverlayWindows) overlay.destroy();
      computerOverlayWindows.clear();
      createComputerOverlay(computerOverlayLanguage, computerOverlayPaletteIndex);
    }
  }

  return { setComputerOverlay, destroyComputerOverlay, handleComputerMenuAction, updateComputerOverlayPalette };
}
