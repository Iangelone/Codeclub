import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { BrowserExtensionBridge } from '../electron-dist/browser-extension-bridge.js';
import { ExternalBrowserControl } from '../electron-dist/external-browser.js';

// Explicit manual debugging: controls a connected Edge profile, owns only the tabs it creates.
const bridge = new BrowserExtensionBridge();
const control = new ExternalBrowserControl(bridge);
const owned = [];
let browser;
let original;
const server = createServer((_, response) => {
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end('<title>Codeclub live debug</title><main>Ready</main><input id="entry" aria-label="Debug input"><button id="verify" onclick="document.querySelector(\'main\').textContent=\'CLICK_OK\'">Verify</button><div style="height:2000px">Scroll fixture</div>');
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  assert(await bridge.start(), 'Bridge unavailable');
  console.log('Waiting for Edge companion...');
  const until = Date.now() + 75000;
  while (Date.now() < until) {
    const listed = await control.list({ ports: [] });
    browser = listed.browsers.find(item => item.name === 'Microsoft Edge' && item.connection === 'extension');
    if (browser?.targets.length) break;
    await delay(1000);
  }
  assert(browser?.targets.length, 'No connected Edge companion');
  original = browser.targets.find(tab => tab.active) || browser.targets[0];
  const manage = async input => {
    const result = await control.manageTabs({ browserId: browser.browserId, ...input });
    assert.equal(result.ok, true, result.error);
    console.log(JSON.stringify({ operation: input.action, ok: result.ok }));
    return result;
  };
  await manage({ action: 'listGroups' });
  const url = `http://127.0.0.1:${server.address().port}/`;
  for (let index = 0; index < 3; index++) {
    const created = await manage({ action: 'create', windowId: original.windowId, url: `${url}?tab=${index}`, active: false });
    owned.push(created.result.targetId);
  }
  for (const targetId of owned) {
    const result = await manage({ action: 'activate', targetId });
    assert(result.tabs.find(tab => tab.targetId === targetId)?.active);
  }
  await manage({ action: 'update', targetId: owned[0], pinned: true, muted: true });
  await manage({ action: 'update', targetId: owned[0], pinned: false, muted: false });
  await manage({ action: 'move', targetId: owned[2], index: -1 });
  const grouped = await manage({ action: 'group', targetIds: owned });
  const groupId = grouped.result.groupId;
  assert(owned.every(id => grouped.tabs.find(tab => tab.targetId === id)?.groupId === groupId));
  await manage({ action: 'updateGroup', groupId, title: 'Codeclub · prueba directa', color: 'blue' });
  await manage({ action: 'activate', targetId: original.targetId });
  await manage({ action: 'updateGroup', groupId, collapsed: true });
  const groups = await manage({ action: 'listGroups' });
  assert(groups.result.some(group => group.id === groupId && group.collapsed && group.color === 'blue'));
  await manage({ action: 'updateGroup', groupId, collapsed: false, color: 'green' });
  await manage({ action: 'activate', targetId: owned[0] });
  let observed = await control.getState({ browserId: browser.browserId, targetId: owned[0] });
  assert(observed.ok, observed.error);
  const act = async (action, extra = {}) => {
    const result = await control.action({ browserId: browser.browserId, targetId: owned[0], snapshotId: observed.snapshotId, action, ...extra });
    assert(result.ok, result.error); observed = result.state;
    console.log(JSON.stringify({ operation: `DOM:${action}`, ok: result.ok }));
  };
  const entry = observed.elements.find(element => element.selector === '#entry');
  assert(entry, 'Input missing');
  await act('type', { selector: entry.selector, text: 'Prueba Unicode: diseño ✓' });
  console.log(JSON.stringify({ unicodeInput: observed.elements.find(element => element.selector === '#entry')?.value, expected: 'Prueba Unicode: diseño ✓' }));
  assert(observed.elements.some(element => element.value === 'Prueba Unicode: diseño ✓'));
  await act('key', { selector: '#entry', key: 'Control+A' });
  await act('click', { selector: '#verify' });
  assert(observed.text.includes('CLICK_OK'));
  await act('scroll', { amount: -400 });
  await act('navigate', { text: `${url}?navigated` });
  assert(observed.url.includes('?navigated'));
  await manage({ action: 'reload', targetId: owned[0] });
  const ungrouped = await manage({ action: 'ungroup', targetIds: owned });
  assert(owned.every(id => ungrouped.tabs.find(tab => tab.targetId === id)?.groupId === -1));
  console.log('Live Edge: tab/group operations and DOM verification passed. No model calls.');
} finally {
  if (browser) {
    if (owned.length) {
      const closed = await control.manageTabs({ browserId: browser.browserId, action: 'close', targetIds: owned });
      console.log(JSON.stringify({ cleanup: closed.ok, onlyOwnedTabs: owned.length, error: closed.error }));
    }
    if (original) await control.manageTabs({ browserId: browser.browserId, action: 'activate', targetId: original.targetId });
  }
  bridge.stop();
  await new Promise(resolve => server.close(resolve));
}
