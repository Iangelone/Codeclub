import { randomUUID } from 'node:crypto';
import type { BrowserExtensionBridge } from './browser-extension-bridge.js';

type CdpTarget = { id: string; type: string; title?: string; url?: string; webSocketDebuggerUrl?: string };
type BrowserEndpoint = { port: number; name: string; targets: CdpTarget[] };
type BrowserElement = { selector: string; tag: string; role: string; name: string; text: string; value?: string; type?: string; href?: string; disabled: boolean; bounds: { x: number; y: number; width: number; height: number } };
type BrowserSnapshot = { id: string; targetId: string; port: number; createdAt: number; elements: BrowserElement[] };

const DEFAULT_PORTS = Array.from({ length: 11 }, (_, index) => 9222 + index);
const MAX_SNAPSHOT_AGE_MS = 60_000;
const MAX_TEXT = 12_000;
const MAX_ELEMENTS = 100;
const localHost = (value: string) => value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';

function validPort(value: unknown): number | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

function websocketUrl(value: unknown, expectedPort: number): string {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'ws:' || !localHost(url.hostname) || Number(url.port) !== expectedPort) throw new Error('El navegador devolvió una conexión CDP fuera del endpoint local esperado.');
  return url.href;
}

async function fetchJson(url: string, timeoutMs = 1200): Promise<any> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
  if (!response.ok) throw new Error(`CDP respondió HTTP ${response.status}.`);
  return response.json();
}

class CdpConnection {
  private socket: WebSocket;
  private nextId = 0;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private events = new Map<string, Set<(params: any) => void>>();
  private opened: Promise<void>;

  constructor(url: string, port: number) {
    this.socket = new WebSocket(websocketUrl(url, port));
    this.opened = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout conectando con el navegador.')), 2500);
      this.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      this.socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('No se pudo conectar con el navegador.')); }, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      let message: any;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      if (typeof message.method === 'string') {
        for (const listener of this.events.get(message.method) || []) listener(message.params || {});
        return;
      }
      if (!Number.isInteger(message.id)) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(message.error.message || 'CDP command failed.')));
      else pending.resolve(message.result || {});
    });
    this.socket.addEventListener('close', () => this.failAll('El navegador cerró la conexión CDP.'));
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    await this.opened;
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('La conexión con el navegador está cerrada.');
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timeout en ${method}.`)); }, 5000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  waitForEvent(method: string, timeoutMs = 10000): Promise<any> {
    return new Promise((resolve, reject) => {
      const listeners = this.events.get(method) || new Set();
      const timer = setTimeout(() => { listeners.delete(listener); reject(new Error(`Timeout esperando ${method}.`)); }, timeoutMs);
      const listener = (params: any) => { clearTimeout(timer); listeners.delete(listener); resolve(params); };
      listeners.add(listener); this.events.set(method, listeners);
    });
  }

  close() { try { this.socket.close(); } catch { /* The browser may already have closed it. */ } }
  private failAll(reason: string) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error(reason)); }
    this.pending.clear();
  }
}

const stateExpression = `(() => {
  const clean = value => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, 500);
  const visible = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const selectorFor = el => {
    if (el.id && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = []; let node = el;
    while (node && node !== document.documentElement && parts.length < 8) {
      let part = node.localName;
      if (!part) break;
      if (node.parentElement) { const peers = Array.from(node.parentElement.children).filter(x => x.localName === node.localName); if (peers.length > 1) part += ':nth-of-type(' + (peers.indexOf(node) + 1) + ')'; }
      parts.unshift(part); node = node.parentElement;
    }
    return parts.join(' > ');
  };
  const controls = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]')).filter(visible).slice(0, 100).map(el => {
    const r = el.getBoundingClientRect();
    const label = el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || (el.type === 'password' ? '' : el.value) || '';
    return { selector: selectorFor(el), tag: el.localName, role: el.getAttribute('role') || '', name: clean(label), text: clean(el.innerText), value: el.type === 'password' ? undefined : (typeof el.value === 'string' ? clean(el.value) : undefined), type: el.type || undefined, href: el.href || undefined, disabled: Boolean(el.disabled), bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
  });
  return { url: location.href, title: document.title, text: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 12000), elements: controls };
})()`;

export class ExternalBrowserControl {
  private snapshots = new Map<string, BrowserSnapshot>();
  constructor(private readonly extensionBridge?: BrowserExtensionBridge) {}

  async list(request: { ports?: unknown } = {}): Promise<{ ok: boolean; browsers: Array<{ browserId: string; connection: string; port?: number; name: string; targets: Array<{ targetId: string; title: string; url: string; active?: boolean; windowId?: number }> }>; hint: string }> {
    const requested = Array.isArray(request.ports) ? request.ports.map(validPort).filter((port): port is number => Boolean(port)).slice(0, 20) : DEFAULT_PORTS;
    const ports = [...new Set(requested)];
    const results = await Promise.all(ports.map(async (port): Promise<BrowserEndpoint | undefined> => {
      try {
        const [version, rawTargets] = await Promise.all([
          fetchJson(`http://127.0.0.1:${port}/json/version`),
          fetchJson(`http://127.0.0.1:${port}/json/list`),
        ]);
        if (typeof version.Browser !== 'string' || !Array.isArray(rawTargets)) return undefined;
        const targets = rawTargets.filter((target: CdpTarget) => target?.type === 'page' && typeof target.id === 'string' && typeof target.webSocketDebuggerUrl === 'string');
        return { port, name: String(version.Browser).slice(0, 100), targets };
      } catch { return undefined; }
    }));
    const browsers: Array<{ browserId: string; connection: string; port?: number; name: string; targets: Array<{ targetId: string; title: string; url: string; active?: boolean; windowId?: number }> }> = results.filter((item): item is BrowserEndpoint => Boolean(item)).map(({ port, name, targets }) => ({ browserId: `cdp:${port}`, connection: 'cdp', port, name, targets: targets.map(target => ({ targetId: target.id, title: String(target.title || '').slice(0, 300), url: String(target.url || '').slice(0, 2000), active: false })) }));
    if (this.extensionBridge) {
      const extensions = await Promise.all(this.extensionBridge.list().map(async browser => {
        try { return { ...browser, targets: await this.extensionBridge!.tabs(browser.browserId) }; }
        catch { return browser; }
      }));
      browsers.push(...extensions);
    }
    return { ok: true, browsers, hint: browsers.length ? '' : 'No hay navegadores conectados. Activá la extensión Codeclub Browser Control o usá CDP en los puertos 9222–9232.' };
  }

  async getState(request: { port?: unknown; targetId?: unknown; browserId?: unknown }) {
    const browserId = String((request as any).browserId || '');
    if (browserId.startsWith('extension:')) {
      if (!this.extensionBridge) return { ok: false, error: 'El puente de extensión no está disponible.' };
      try { const state = await this.extensionBridge.state(browserId, String(request.targetId || '')); return { ...state, browserId, connection: 'extension', targetId: String(request.targetId || '') }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se pudo observar la pestaña.' }; }
    }
    const selectedPort = browserId.startsWith('cdp:') ? browserId.slice(4) : request.port;
    const port = validPort(selectedPort);
    const targetId = String(request.targetId || '');
    if (!port || !targetId || targetId.length > 200) return { ok: false, error: 'Indicá port y targetId obtenidos de externalBrowserList.' };
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const target = Array.isArray(targets) ? targets.find((item: CdpTarget) => item.id === targetId && item.type === 'page') : undefined;
      if (!target?.webSocketDebuggerUrl) return { ok: false, error: 'La pestaña ya no existe. Volvé a listar los navegadores.' };
      const cdp = new CdpConnection(target.webSocketDebuggerUrl, port);
      try {
        const result = await cdp.send('Runtime.evaluate', { expression: stateExpression, returnByValue: true, awaitPromise: true });
        if (result.exceptionDetails) throw new Error('No se pudo inspeccionar el DOM de la pestaña.');
        const value = result.result?.value;
        if (!value || typeof value.url !== 'string') throw new Error('El navegador devolvió un estado inválido.');
        const id = randomUUID();
        const snapshot: BrowserSnapshot = { id, port, targetId, createdAt: Date.now(), elements: Array.isArray(value.elements) ? value.elements.slice(0, MAX_ELEMENTS) : [] };
        this.pruneSnapshots(); this.snapshots.set(id, snapshot);
        return { ok: true, snapshotId: id, targetId, port, url: value.url.slice(0, 2000), title: String(value.title || '').slice(0, 300), text: String(value.text || '').slice(0, MAX_TEXT), elements: snapshot.elements };
      } finally { cdp.close(); }
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'No se pudo observar la pestaña.' }; }
  }

  async action(request: { port?: unknown; targetId?: unknown; browserId?: unknown; snapshotId?: unknown; selector?: unknown; action?: unknown; text?: unknown; key?: unknown; amount?: unknown }) {
    const browserId = String((request as any).browserId || '');
    if (browserId.startsWith('extension:')) {
      if (!this.extensionBridge) return { ok: false, error: 'El puente de extensión no está disponible.' };
      try { const result = await this.extensionBridge.action(browserId, request as any); return { ...result, browserId, connection: 'extension', targetId: String(request.targetId || ''), state: result?.state ? { ...result.state, browserId, connection: 'extension', targetId: String(request.targetId || '') } : result?.state }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Falló la acción del navegador.' }; }
    }
    const port = validPort(browserId.startsWith('cdp:') ? browserId.slice(4) : request.port); const targetId = String(request.targetId || '');
    const snapshotId = String(request.snapshotId || ''); const selector = String(request.selector || '');
    const action = String(request.action || ''); const text = String(request.text ?? ''); const key = String(request.key || '');
    const amount = Number(request.amount);
    const supported = ['click', 'type', 'key', 'scroll', 'navigate'];
    if (!port || !targetId || !snapshotId || !supported.includes(action)) return { ok: false, error: 'Acción incompleta; usá el snapshot reciente del navegador externo.' };
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.port !== port || snapshot.targetId !== targetId || Date.now() - snapshot.createdAt > MAX_SNAPSHOT_AGE_MS) return { ok: false, error: 'Snapshot vencido o de otra pestaña. Volvé a observarla.' };
    if (action !== 'scroll' && action !== 'navigate' && !snapshot.elements.some(element => element.selector === selector)) return { ok: false, error: 'El selector no pertenece al último estado observado.' };
    if (action === 'type' && text.length > 20_000) return { ok: false, error: 'El texto excede 20000 caracteres.' };
    if (action === 'key' && !['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Control+A', 'Meta+A'].includes(key)) return { ok: false, error: 'Tecla no permitida.' };
    if (action === 'scroll' && (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 2400)) return { ok: false, error: 'amount debe ser distinto de cero y estar entre -2400 y 2400.' };
    if (action === 'navigate') {
      try { const url = new URL(text); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
      catch { return { ok: false, error: 'La navegación requiere una URL http(s) válida.' }; }
    }
    this.snapshots.delete(snapshotId);
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const target = Array.isArray(targets) ? targets.find((item: CdpTarget) => item.id === targetId && item.type === 'page') : undefined;
      if (!target?.webSocketDebuggerUrl) return { ok: false, error: 'La pestaña ya no existe.' };
      const cdp = new CdpConnection(target.webSocketDebuggerUrl, port);
      try {
        if (action === 'navigate') {
          await cdp.send('Page.enable');
          const loaded = cdp.waitForEvent('Page.loadEventFired');
          await cdp.send('Page.navigate', { url: text });
          await loaded;
        }
        else if (action === 'scroll') {
          const viewport = await cdp.send('Runtime.evaluate', { expression: '({width:document.documentElement.clientWidth,height:document.documentElement.clientHeight})', returnByValue: true });
          const { width = 800, height = 600 } = viewport.result?.value || {};
          await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.max(1, Math.floor(width / 2)), y: Math.max(1, Math.floor(height / 2)), deltaY: Math.max(-2400, Math.min(2400, -amount)), deltaX: 0 });
        }
        else {
          const found = await cdp.send('Runtime.evaluate', { expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,tag:el.tagName,disabled:Boolean(el.disabled),readOnly:Boolean(el.readOnly),canType:el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'}; })()`, returnByValue: true });
          const element = found.result?.value;
          if (!element) return { ok: false, error: 'El elemento cambió desde la última observación.' };
          if (element.disabled || element.readOnly) return { ok: false, error: 'El elemento está deshabilitado o es de solo lectura.' };
          if (action === 'type' && !element.canType) return { ok: false, error: 'El elemento observado no admite escritura de texto.' };
          if (action === 'click') {
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: element.x, y: element.y, button: 'left', clickCount: 1 });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: element.x, y: element.y, button: 'left', clickCount: 1 });
          } else if (action === 'type') {
            await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: element.x, y: element.y, button: 'left', clickCount: 1 });
            await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: element.x, y: element.y, button: 'left', clickCount: 1 });
            await cdp.send('Input.insertText', { text });
          } else {
            const keyMap: Record<string, { key: string; code: string; modifiers?: number }> = { Enter: { key: 'Enter', code: 'Enter' }, Tab: { key: 'Tab', code: 'Tab' }, Escape: { key: 'Escape', code: 'Escape' }, Backspace: { key: 'Backspace', code: 'Backspace' }, Delete: { key: 'Delete', code: 'Delete' }, ArrowUp: { key: 'ArrowUp', code: 'ArrowUp' }, ArrowDown: { key: 'ArrowDown', code: 'ArrowDown' }, ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft' }, ArrowRight: { key: 'ArrowRight', code: 'ArrowRight' }, Home: { key: 'Home', code: 'Home' }, End: { key: 'End', code: 'End' }, 'Control+A': { key: 'a', code: 'KeyA', modifiers: 2 }, 'Meta+A': { key: 'a', code: 'KeyA', modifiers: 4 } };
            const mapped = keyMap[key];
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...mapped });
            await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...mapped });
          }
        }
      } finally { cdp.close(); }
      const state = await this.getState({ port, targetId });
      return { ok: state.ok, dispatched: true, state };
    } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Falló la acción del navegador.' }; }
  }

  private pruneSnapshots() { const now = Date.now(); for (const [id, snapshot] of this.snapshots) if (now - snapshot.createdAt > MAX_SNAPSHOT_AGE_MS) this.snapshots.delete(id); }
}

export const createExternalBrowserControl = (extensionBridge?: BrowserExtensionBridge) => new ExternalBrowserControl(extensionBridge);
