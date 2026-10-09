// Companion for installed Chromium browsers: reconnect to Electron over loopback and scope CDP access to requested tabs.
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
  if (socket && [WebSocket.OPEN, WebSocket.CONNECTING].includes(socket.readyState)) return;
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
  if (portIndex === 0) reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  reconnectTimer = setTimeout(connect, portIndex === 0 ? reconnectDelay : 250);
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

async function prepareInput(tabId) {
  const tab = await chromeCall('tabs.update', tabId, { active: true });
  const window = await chromeCall('windows.get', tab.windowId);
  await chromeCall('windows.update', tab.windowId, {
    ...(window.state === 'minimized' ? { state: 'normal' } : {}), focused: true,
  });
  await command(tabId, 'Page.bringToFront');
  for (let attempt = 0; attempt < 20; attempt++) {
    const result = await command(tabId, 'Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true });
    if (result.result?.value === 'visible') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('La pestaña sigue oculta; no se envió la entrada. Mostrá su ventana y volvé a observarla.');
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
      return { selector: selectorFor(el), tag: el.localName, role: el.getAttribute('role') || '', name: clean(name), text: clean(el.innerText), value: el.type === 'password' ? undefined : (typeof el.value === 'string' ? el.value : undefined), type: el.type || undefined, href: el.href || undefined, disabled: Boolean(el.disabled), bounds: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } };
    });
    return { url: location.href, title: document.title, text: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 12000), elements, media: Array.from(document.querySelectorAll('video,audio')).map(media => ({ paused: media.paused, muted: media.muted, volume: media.volume, currentTime: media.currentTime, ended: media.ended, readyState: media.readyState })) };
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
  return { ok: true, snapshotId, tabId, url: value.url.slice(0, 2000), title: String(value.title || '').slice(0, 300), text: value.text, elements: value.elements, media: value.media };
}

async function act(params) {
  const tabId = Number(params.tabId); const action = String(params.action || '');
  const selector = String(params.selector || ''); const text = String(params.text ?? ''); const key = String(params.key || ''); const amount = Number(params.amount);
  if (!Number.isInteger(tabId) || tabId <= 0) throw new Error('Invalid tabId. Use an observed targetId.');
  if (action === 'navigate') {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Navigation requires HTTP/HTTPS.');
    await chromeCall('tabs.get', tabId);
    for (const [id, previous] of snapshots) if (previous.tabId === tabId) snapshots.delete(id);
    await chromeCall('tabs.update', tabId, { url: url.href });
    // Navigation does not require scripting the source page.
    for (let attempt = 0; attempt < 40; attempt++) {
      const tab = await chromeCall('tabs.get', tabId);
      if (tab.status === 'complete' && tab.url !== 'about:blank' && attempt > 0) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    try { const observed = await state(tabId); return { ok: observed.ok, dispatched: true, state: observed }; }
    catch (error) { return { ok: false, dispatched: true, error: String(error.message || error) }; }
  }
  const snapshot = snapshots.get(String(params.snapshotId || ''));
  if (!Number.isInteger(tabId) || !snapshot || snapshot.tabId !== tabId || Date.now() - snapshot.createdAt > MAX_SNAPSHOT_AGE) throw new Error('Snapshot vencido o de otra pestaña; volvé a observarla.');
  if (!['click', 'type', 'key', 'scroll'].includes(action)) throw new Error('Acción no admitida.');
  if (action !== 'scroll' && !snapshot.elements.some(element => element.selector === selector)) throw new Error('El selector no pertenece a la última observación.');
  if (action === 'type' && text.length > 20_000) throw new Error('El texto excede 20000 caracteres.');
  if (action === 'key' && !['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Control+A', 'Meta+A'].includes(key)) throw new Error('Tecla no permitida.');
  if (action === 'scroll' && (!Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 2400)) throw new Error('Desplazamiento inválido.');
  snapshots.delete(String(params.snapshotId));
  await attach(tabId);
  await prepareInput(tabId);
  await command(tabId, 'Input.setIgnoreInputEvents', { ignore: false });
  if (action === 'scroll') {
      const viewport = await command(tabId, 'Runtime.evaluate', { expression: '({width:document.documentElement.clientWidth,height:document.documentElement.clientHeight})', returnByValue: true });
      const { width = 800, height = 600 } = viewport.result?.value || {};
      await command(tabId, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: Math.max(1, Math.floor(width / 2)), y: Math.max(1, Math.floor(height / 2)), deltaY: Math.max(-2400, Math.min(2400, -amount)), deltaX: 0 });
    } else {
      const found = await command(tabId, 'Runtime.evaluate', { expression: `(async () => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({block:'center',inline:'center',behavior:'instant'}); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); const r=Array.from(el.getClientRects()).find(r => r.width>0 && r.height>0 && r.right>0 && r.bottom>0 && r.left<innerWidth && r.top<innerHeight); if(!r)return null; const x=(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2,y=(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2; const hit=document.elementFromPoint(x,y); return {x,y,blocked:!hit||!(hit===el||el.contains(hit)),disabled:Boolean(el.disabled),readOnly:Boolean(el.readOnly),canType:el.isContentEditable||el.tagName==='INPUT'||el.tagName==='TEXTAREA'}; })()`, returnByValue: true, awaitPromise: true });
      const element = found.result?.value;
      if (!element) throw new Error('El elemento cambió desde la última observación.');
      if (element.disabled || (action === 'type' && (element.readOnly || !element.canType))) throw new Error('El elemento no admite esta acción.');
      if (action === 'type' || action === 'key') await command(tabId, 'Runtime.evaluate', { expression: `document.querySelector(${JSON.stringify(selector)})?.focus()`, returnByValue: true });
      if (action === 'click') {
        if (element.blocked) throw new Error('El elemento está cubierto por otro control; volvé a observar la página.');
        await command(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: element.x, y: element.y, button: 'left', clickCount: 1 });
        await command(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: element.x, y: element.y, button: 'left', clickCount: 1 });
      } else if (action === 'type') {
        await command(tabId, 'Input.insertText', { text });
      } else {
        const keyMap = { Enter: ['Enter', 'Enter', 0], Tab: ['Tab', 'Tab', 0], Escape: ['Escape', 'Escape', 0], Backspace: ['Backspace', 'Backspace', 0], Delete: ['Delete', 'Delete', 0], ArrowUp: ['ArrowUp', 'ArrowUp', 0], ArrowDown: ['ArrowDown', 'ArrowDown', 0], ArrowLeft: ['ArrowLeft', 'ArrowLeft', 0], ArrowRight: ['ArrowRight', 'ArrowRight', 0], Home: ['Home', 'Home', 0], End: ['End', 'End', 0], 'Control+A': ['a', 'KeyA', 2], 'Meta+A': ['a', 'KeyA', 4] }[key];
        const virtualKeyCode = ({Enter:13,Tab:9,Escape:27,Backspace:8,Delete:46,ArrowUp:38,ArrowDown:40,ArrowLeft:37,ArrowRight:39,Home:36,End:35,'Control+A':65,'Meta+A':65})[key];
        await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyDown', key: keyMap[0], code: keyMap[1], modifiers: keyMap[2], windowsVirtualKeyCode: virtualKeyCode });
        await command(tabId, 'Input.dispatchKeyEvent', { type: 'keyUp', key: keyMap[0], code: keyMap[1], modifiers: keyMap[2], windowsVirtualKeyCode: virtualKeyCode });
      }
    }
  return { ok: true, state: await state(tabId) };
}

// Tab management uses browser identities, never DOM selectors or page-provided code.
async function manageTabs(params) {
  const action = String(params.action || '');
  const ids = params.targetIds?.map(Number) || (params.targetId === undefined ? [] : [Number(params.targetId)]);
  const idActions = ['activate', 'move', 'group', 'ungroup', 'close', 'reload', 'update'];
  if (idActions.includes(action)) {
    if (!ids.length || ids.some(id => !Number.isInteger(id) || id <= 0)) throw new Error('Observed targetIds are required.');
    for (const id of ids) await chromeCall('tabs.get', id);
  }
  const optionalWindow = params.windowId === undefined ? {} : { windowId: params.windowId };
  if (params.windowId !== undefined && (!Number.isInteger(params.windowId) || params.windowId < 0)) throw new Error('Invalid windowId.');
  if (params.groupId !== undefined && (!Number.isInteger(params.groupId) || params.groupId < 0)) throw new Error('Invalid groupId.');
  if (params.index !== undefined && (!Number.isInteger(params.index) || params.index < -1)) throw new Error('index must be -1 or a nonnegative integer.');
  let result;
  if (action === 'create') {
    const url = new URL(String(params.url || ''));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Create requires an HTTP/HTTPS URL.');
    result = await chromeCall('tabs.create', { ...optionalWindow, url: url.href, active: params.active ?? false });
    result = { targetId: String(result.id), windowId: result.windowId };
  } else if (action === 'activate') {
    if (ids.length !== 1) throw new Error('activate requires exactly one targetId.');
    await chromeCall('tabs.update', ids[0], { active: true });
  } else if (action === 'move') {
    if (params.index === undefined) throw new Error('move requires index.');
    await chromeCall('tabs.move', ids, { ...optionalWindow, index: params.index });
  } else if (action === 'group') {
    const groupId = await chromeCall('tabs.group', { tabIds: ids, ...(params.groupId === undefined ? { createProperties: optionalWindow } : { groupId: params.groupId }) });
    result = { groupId };
  } else if (action === 'ungroup') await chromeCall('tabs.ungroup', ids);
  else if (action === 'updateGroup') {
    if (params.groupId === undefined) throw new Error('updateGroup requires groupId.');
    const properties = {};
    for (const key of ['title', 'color', 'collapsed']) if (params[key] !== undefined) properties[key] = params[key];
    if (!Object.keys(properties).length) throw new Error('Supply title, color or collapsed.');
    result = await chromeCall('tabGroups.update', params.groupId, properties);
  } else if (action === 'listGroups') result = await chromeCall('tabGroups.query', optionalWindow);
  else if (action === 'update') {
    const properties = {};
    for (const key of ['pinned', 'muted']) if (params[key] !== undefined) properties[key] = params[key];
    if (!Object.keys(properties).length) throw new Error('Supply pinned or muted.');
    for (const id of ids) await chromeCall('tabs.update', id, properties);
  } else if (action === 'reload' || action === 'close') {
    for (const [id, snapshot] of snapshots) if (ids.includes(snapshot.tabId)) snapshots.delete(id);
    if (action === 'close') await chromeCall('tabs.remove', ids);
    else for (const id of ids) await chromeCall('tabs.reload', id);
  } else throw new Error('Unsupported tab operation.');
  const tabs = await chromeCall('tabs.query', {});
  return { ok: true, action, result, tabs: tabs.map(tab => ({ targetId: String(tab.id), windowId: tab.windowId, index: tab.index, groupId: tab.groupId, active: tab.active, pinned: tab.pinned, muted: tab.mutedInfo?.muted, url: tab.url || tab.pendingUrl || '' })) };
}

async function handleMessage(raw) {
  let message;
  try { message = JSON.parse(String(raw)); } catch { return; }
  if (!message || typeof message.id !== 'string' || !['listTabs', 'getState', 'action', 'manageTabs'].includes(message.method)) return;
  try {
    let result;
    if (message.method === 'listTabs') {
      const tabs = await chromeCall('tabs.query', {});
      result = { ok: true, browser: browserName(), tabs: tabs.filter(tab => Number.isInteger(tab.id)).map(tab => ({ tabId: tab.id, title: String(tab.title || '').slice(0, 300), url: String(tab.url || tab.pendingUrl || '').slice(0, 2000), active: Boolean(tab.active), windowId: tab.windowId })) };
    } else if (message.method === 'getState') result = await state(Number(message.params?.tabId));
    else if (message.method === 'manageTabs') result = await manageTabs(message.params || {});
    else result = await act(message.params || {});
    send({ id: message.id, result });
  } catch (error) { send({ id: message.id, error: error instanceof Error ? error.message : 'Falló la operación del navegador.' }); }
}

chrome.debugger.onDetach.addListener((source, reason) => {
  attachedTabs.delete(source.tabId);
  if (reason === 'canceled_by_user' || reason === 'target_closed') for (const [id, snapshot] of snapshots) if (snapshot.tabId === source.tabId) snapshots.delete(id);
});
// MV3 may suspend timers while Codeclub is closed; alarms wake the worker again.
const RECONNECT_ALARM = 'codeclub-browser-reconnect';
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === RECONNECT_ALARM) connect(); });
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
chrome.action.onClicked.addListener(connect);
chrome.alarms.create(RECONNECT_ALARM, { periodInMinutes: 1 });
connect();
