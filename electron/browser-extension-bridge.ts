import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

const EXTENSION_ID = 'pomkkenhcjkfjdabdhogladflacafopd';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const BRIDGE_PORTS = Array.from({ length: 11 }, (_, index) => 47832 + index);
type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
type Client = { id: string; socket: WebSocket; browser: string; pending: Map<string, Pending> };

/** Loopback bridge accepting only the signed Codeclub browser companion extension. */
export class BrowserExtensionBridge {
  private server: WebSocketServer | null = null;
  private clients = new Map<string, Client>();
  private startPromise?: Promise<boolean>;

  start(): Promise<boolean> {
    if (this.server) return Promise.resolve(true);
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      for (const port of BRIDGE_PORTS) {
        const started = await new Promise<boolean>((resolve) => {
          const server = new WebSocketServer({
            host: '127.0.0.1', port, path: '/codeclub-browser', maxPayload: 1_100_000,
            perMessageDeflate: false,
            verifyClient: (info: { origin: string }) => info.origin === EXTENSION_ORIGIN,
          });
          server.once('listening', () => { this.server = server; resolve(true); });
          server.once('error', () => { server.close(); resolve(false); });
          server.on('connection', socket => this.accept(socket));
        });
        if (started) return true;
      }
      return false;
    })().finally(() => { this.startPromise = undefined; });
    return this.startPromise!;
  }

  stop() {
    for (const client of this.clients.values()) {
      for (const pending of client.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('Codeclub cerró el puente de navegador.')); }
      client.pending.clear(); client.socket.close();
    }
    this.clients.clear(); this.server?.close(); this.server = null;
  }

  list() {
    return [...this.clients.values()].filter(client => client.browser).map(client => ({ browserId: `extension:${client.id}`, connection: 'extension', name: client.browser, targets: [] as Array<{ targetId: string; title: string; url: string; active: boolean; windowId: number }> }));
  }

  async tabs(browserId: string) {
    const result = await this.call(browserId, 'listTabs');
    if (result?.ok !== true || !Array.isArray(result.tabs)) throw new Error(String(result?.error || 'No se pudieron listar las pestañas.'));
    return result.tabs.map((tab: any) => ({ targetId: String(tab.tabId), title: String(tab.title || '').slice(0, 300), url: String(tab.url || '').slice(0, 2000), active: Boolean(tab.active), windowId: Number(tab.windowId) }));
  }

  state(browserId: string, targetId: string) { return this.call(browserId, 'getState', { tabId: Number(targetId) }); }
  action(browserId: string, request: Record<string, unknown>) { return this.call(browserId, 'action', { ...request, tabId: Number(request.targetId) }); }

  private accept(socket: WebSocket) {
    const id = randomUUID();
    const client: Client = { id, socket, browser: '', pending: new Map() };
    this.clients.set(id, client);
    socket.on('message', (data: RawData) => {
      let message: any;
      try { message = JSON.parse(data.toString()); } catch { socket.close(1003, 'Invalid JSON'); return; }
      if (message?.type === 'hello') { client.browser = String(message.browser || 'Navegador Chromium').slice(0, 100); return; }
      if (message?.type === 'ping') { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'pong' })); return; }
      const pending = typeof message?.id === 'string' ? client.pending.get(message.id) : undefined;
      if (!pending) return;
      clearTimeout(pending.timer); client.pending.delete(message.id);
      if (message.error) pending.reject(new Error(String(message.error).slice(0, 1000)));
      else pending.resolve(message.result);
    });
    const remove = () => {
      this.clients.delete(id);
      for (const pending of client.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error('La extensión del navegador se desconectó.')); }
      client.pending.clear();
    };
    socket.once('close', remove); socket.once('error', remove);
  }

  private call(browserId: string, method: string, params: Record<string, unknown> = {}): Promise<any> {
    const clientId = browserId.startsWith('extension:') ? browserId.slice('extension:'.length) : '';
    const client = this.clients.get(clientId);
    if (!client || client.socket.readyState !== WebSocket.OPEN) throw new Error('La extensión de Codeclub no está conectada. Instalá/activá la extensión y actualizá externalBrowserList.');
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { client.pending.delete(id); reject(new Error('La extensión no respondió a tiempo.')); }, 15000);
      client.pending.set(id, { resolve, reject, timer });
      client.socket.send(JSON.stringify({ id, method, params }), error => {
        if (!error) return;
        clearTimeout(timer); client.pending.delete(id); reject(new Error('No se pudo enviar la orden a la extensión.'));
      });
    });
  }
}

export const createBrowserExtensionBridge = () => new BrowserExtensionBridge();
