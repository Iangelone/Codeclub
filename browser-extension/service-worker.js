const BRIDGE_PORTS = Array.from({ length: 11 }, (_, index) => 47832 + index);
const MAX_SNAPSHOT_AGE = 60_000;
const snapshots = new Map();
let socket;
let reconnectDelay = 500;
let reconnectTimer;
let pingTimer;
let portIndex = 0;
const attachedTabs = new Set();
let detachTimer;

async function browserName() {
  const agent = navigator.userAgent;
  if (/Edg\//.test(agent)) return 'Microsoft Edge';
  if (/Vivaldi/.test(agent)) return 'Vivaldi';
  if (/OPR\//.test(agent) || /Opera/.test(agent)) return 'Opera';
  if (/Brave/.test(agent)) return 'Brave';
  if (navigator.brave?.isBrave) { try { if (await navigator.brave.isBrave()) return 'Brave'; } catch { /* Use the Chromium fallback when Brave's signal is unavailable. */ } }
  if (/Chrome\//.test(agent)) return 'Google Chrome';
  return 'Chromium';
}

function connect() {
  clearTimeout(reconnectTimer);
  try { socket = new WebSocket(`ws://127.0.0.1:${BRIDGE_PORTS[portIndex]}/codeclub-browser`); }
  catch { scheduleReconnect(); return; }
  socket.addEventListener('open', async () => {
    reconnectDelay = 500;
    socket.send(JSON.stringify({ type: 'hello', browser: await browserName() }));
    pingTimer = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })); }, 20_000);
  });
  socket.addEventListener('message', event => { void handleMessage(event.data); });
  socket.addEventListener('close', () => {
    clearInterval(pingTimer);
    clearTimeout(detachTimer);
    for (const tabId of attachedTabs) detach(tabId);
    scheduleReconnect();
  });
  socket.addEventListener('error', () => socket?.close());
}

function scheduleReconnect() {
  portIndex = (portIndex + 1) % BRIDGE_PORTS.length;
  reconnectDelay = portIndex === 0 ? Math.min(reconnectDelay * 2, 15000) : 250;
  reconnectTimer = setTimeout(connect, reconnectDelay);
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function chromeCall(method, ...args) {
  return new Promise((resolve, reject) => {
    chrome[method.split('.')[0]][method.split('.')[1]](...args, result => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(result);
    });
  });
}

async function attach(tabId) {
  if (!attachedTabs.has(tabId)) { await chromeCall('debugger.attach', { tabId }, '1.3'); attachedTabs.add(tabId); }
  clearTimeout(detachTimer);
  detachTimer = setTimeout(() => { for (const activeTab of attachedTabs) void detach(activeTab); }, 60_000);
}

async function detach(tabId) {
  attachedTabs.delete(tabId);
  try { await chromeCall('debugger.detach', { tabId }); } catch { /* It may already be detached. */ }
}

async function command(tabId, method, params = {}) {
  return chromeCall('debugger.sendCommand', { tabId }, method, params);
}

function observeExpression() {
  return `(() => {
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
    const elements = Array.from(document.querySelectorAll('a[href],button,input,textarea,select,[role="button"],[role="link"],[role="textbox"],[contenteditable="true"]')).filter(visible).slice(0, 100).map(el => {
      const r = el.getBoundingClientRect();
      const name = el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || (el.type === 'password' ? '' : el.value) || '';
      return { selector: selectorFor(el), tag: el.localName, role: el.getAttribute('role') || '', name: clean(name), text: clean(el.innerText), value: el.type === 'password' ? undefined : (typeof el.value === 'string' ? clean(el.value) : undefined), type: el.type || undefined, href: el.href || undefined, disabled: Boolean(el.disabled), bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
    });
    return { url: location.href, title: document.title, text: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 12000), elements };
  })()`;
}

async function state(tabId) {
  await attach(tabId);
  const result = await command(tabId, 'Runtime.evaluate', { expression: observeExpression(), returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('No se pudo inspeccionar el DOM de esta pestaña.');
  const value = result.result?.value;
  if (!value || typeof value.url !== 'string') throw new Error('El navegador devolvió un estado inválido.');
  const snapshotId = crypto.randomUUID();
  snapshots.set(snapshotId, { tabId, createdAt: Date.now(), elements: value.elements || [] });
  for (const [id, snapshot] of snapshots) if (Date.now() - snapshot.createdAt > MAX_SNAPSHOT_AGE) snapshots.delete(id);
  return { ok: true, snapshotId, tabId, url: value.url.slice(0, 2000), title: String(value.title || '').slice(0, 300), text: value.text, elements: value.elements };
}

async function act(params) {
  const tabId = Number(params.tabId); const action = String(params.action || '');
  const selector = String(params.selector || ''); const text = String(params.text ?? ''); const key = String(params.key || ''); const amount = Number(params.amount);
  const snapshot = snapshots.get(String(params.snapshotId || ''));
  if (!Number.isInteger(tabId) || !snapshot || snapshot.tabId !== tabId || Date.now() - snapshot.createdAt > MAX_SNAPSHOT_AGE) throw new Error('Snapshot vencido o de otra pestaña; volvé a observarla.');
  if (!['click', 'type', 'key', 'scroll', 'navigate'].includes(action)) throw new Error('Acción no admitida.');
  if (action !== 'scroll' && action !== 'navigate' && !snapshot.elements.some(element => element.selector === selector)) throw new Error('El selector no pertenece a la última observación.');
  if (action === 'type' && text.length > 20_000) throw new Error('El texto excede 20000 caracteres.');
  if (action === 'navigate' && !['http:', 'https:'].includes(new URL(text).protocol)) throw new Error('Solo se permite navegar a URLs HTTP/HTTPS.');
  if (action === 'key' && !['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Control+A', 'Meta+A'].includes(key)) throw new Error('Tecla no permitida.');
  if (action === 'scroll' && (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 2400)) throw new Error('Desplazamiento inválido.');
  snapshots.delete(String(params.snapshotId));
  await attach(tabId);
  if (action === 'navigate') {
      await command(tabId, 'Page.enable');
      await command(tabId, 'Page.navigate', { url: text });
      await new Promise(resolve => setTimeout(resolve, 600));
    } else if (action === 'scroll') {
      const viewport = await command(tabId, 'Runtime.evaluate', { expression: '({width:document.documentElement.clientWidth,height:document.documentElement.clientHeight})', returnByValue: true });
      const { width = 800, height = 600 } = viewport.result?.value || {};
      await command(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.max(1, Math.floor(width / 2)), y: Math.max(1, Math.floor(height / 2)), deltaY: Math.max(-2400, Math.min(2400, -amount)), deltaX: 0 });
    } else {
      const found = await command(tabId, 'Runtime.evaluate', { expression: `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r=el.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2,disabled:Boolean(el.disabled),readOnly:Boolean(el.readOnly),canType:el.isContentEditable||el.tagName==='INPUT'||el.tagName==='TEXTAREA'}; })()`, returnByValue: true });
      const element = found.result?.value;
      if (!element) throw new Error('El elemento cambió desde la última observación.');
      if (element.disabled || element.readOnly || (action === 'type' && !element.canType)) throw new Error('El elemento no admite esta acción.');
      if (action === 'click' || action === 'type') {
        await command(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: element.x, y: element.y, button: 'left', clickCount: 1 });
        await command(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: element.x, y: element.y, button: 'left', clickCount: 1 });
        if (action === 'type') await command(tabId, 'Input.insertText', { text });
      } else {
        const keyMap = { Enter: ['Enter', 'Enter', 0], Tab: ['Tab', 'Tab', 0], Escape: ['Escape', 'Escape', 0], Backspace: ['Backspace', 'Backspace', 0], Delete: ['Delete', 'Delete', 0], ArrowUp: ['ArrowUp', 'ArrowUp', 0], ArrowDown: ['ArrowDown', 'ArrowDown', 0], ArrowLeft: ['ArrowLeft', 'ArrowLeft', 0], ArrowRight: ['ArrowRight', 'ArrowRight', 0], Home: ['Home', 'Home', 0], End: ['End', 'End', 0], 'Control+A': ['a', 'KeyA', 2], 'Meta+A': ['a', 'KeyA', 4] }[key];
        await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: keyMap[0], code: keyMap[1], modifiers: keyMap[2] });
        await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: keyMap[0], code: keyMap[1], modifiers: keyMap[2] });
      }
    }
  return { ok: true, state: await state(tabId) };
}

async function handleMessage(raw) {
  let message;
  try { message = JSON.parse(String(raw)); } catch { return; }
  if (!message || typeof message.id !== 'string' || !['listTabs', 'getState', 'action'].includes(message.method)) return;
  try {
    let result;
    if (message.method === 'listTabs') {
      const tabs = await chromeCall('tabs.query', {});
      result = { ok: true, browser: browserName(), tabs: tabs.filter(tab => Number.isInteger(tab.id) && /^https?:|^file:/i.test(tab.url || '')).map(tab => ({ tabId: tab.id, title: String(tab.title || '').slice(0, 300), url: String(tab.url || '').slice(0, 2000), active: Boolean(tab.active), windowId: tab.windowId })) };
    } else if (message.method === 'getState') result = await state(Number(message.params?.tabId));
    else result = await act(message.params || {});
    send({ id: message.id, result });
  } catch (error) { send({ id: message.id, error: error instanceof Error ? error.message : 'Falló la operación del navegador.' }); }
}

chrome.debugger.onDetach.addListener((source, reason) => {
  attachedTabs.delete(source.tabId);
  if (reason === 'canceled_by_user' || reason === 'target_closed') for (const [id, snapshot] of snapshots) if (snapshot.tabId === source.tabId) snapshots.delete(id);
});
connect();
