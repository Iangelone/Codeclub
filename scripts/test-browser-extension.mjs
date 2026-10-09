import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, cp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { BrowserExtensionBridge } from '../electron-dist/browser-extension-bridge.js';
import { ExternalBrowserControl } from '../electron-dist/external-browser.js';

const project = process.cwd();
const sourceExtension = path.join(project, 'browser-extension');
const profile = await mkdtemp(path.join(tmpdir(), 'codeclub-extension-test-'));
const extension = path.join(profile, 'extension');
await cp(sourceExtension, extension, {recursive: true});
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Companion extension test</title><main>Initial state</main><button id="change" onclick="document.querySelector(\'main\').textContent=\'Extension verified\'">Change</button><input id="entry" aria-label="Entry"><input type="password" value="secret never expose"><textarea id="multiline"></textarea><input id="readonly" readonly value="read only">');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const pagePort = server.address().port;
const bridge = new BrowserExtensionBridge();
assert.equal(await bridge.start(), true, 'The local browser extension bridge should start');
// Keep the test companion connected to this bridge when a desktop app is already running.
const fixturePort = bridge.server.address().port;
const workerPath = path.join(extension, 'service-worker.js');
let fixtureWorker = (await readFile(workerPath, 'utf8')).replace('const BRIDGE_PORTS = Array.from({ length: 11 }, (_, index) => 47832 + index);', `const BRIDGE_PORTS = [${fixturePort}];`);
if (process.env.CODECLUB_TEST_FROZEN === '1') {
  fixtureWorker = fixtureWorker.replace(/async function state\(tabId\) \{\r?\n  await attach\(tabId\);/,
    "async function state(tabId) {\n  await attach(tabId);\n  await command(tabId, 'Page.setWebLifecycleState', { state: 'frozen' });");
  assert(fixtureWorker.includes("state: 'frozen'"), 'Frozen page fixture must be installed');
}
if (process.env.CODECLUB_TEST_MINIMIZED === '1') {
  fixtureWorker = fixtureWorker.replace(/async function state\(tabId\) \{\r?\n  await attach\(tabId\);/,
    "async function state(tabId) {\n  await attach(tabId);\n  const fixtureTab = await chromeCall('tabs.get', tabId);\n  await chromeCall('windows.update', fixtureTab.windowId, { state: 'minimized' });");
  assert(fixtureWorker.includes('const fixtureTab ='), 'Minimized window fixture must be installed');
}
if (process.env.CODECLUB_TEST_IGNORE_INPUT === '1') {
  // Only the temporary test copy simulates a debugger leaving page input disabled.
  fixtureWorker = fixtureWorker.replace(/async function state\(tabId\) \{\r?\n  await attach\(tabId\);/,
    "async function state(tabId) {\n  await attach(tabId);\n  await command(tabId, 'Input.setIgnoreInputEvents', { ignore: true });");
  assert(fixtureWorker.includes('{ ignore: true }'), 'Input suppression fixture must be installed');
}
await writeFile(workerPath, fixtureWorker);
const executable = process.env.CODECLUB_BROWSER_EXECUTABLE || chromium.executablePath();
const protectedSource = process.env.CODECLUB_PROTECTED_TEST_URL || 'https://chromewebstore.google.com/';
const chrome = spawn(executable, [
  ...(process.env.CODECLUB_BROWSER_HEADED === '1' ? [] : ['--headless=new']), '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
  `--user-data-dir=${profile}`, protectedSource,
], { windowsHide: true, stdio: 'ignore' });
const chromeExit = new Promise((resolve) => chrome.once('exit', resolve));

try {
  const control = new ExternalBrowserControl(bridge);
  let browser; let tab;
  for (let attempt = 0; attempt < 80 && !tab; attempt++) {
    const listed = await control.list({ ports: [] });
    browser = listed.browsers.find((item) => item.connection === 'extension');
    tab = browser?.targets.find((target) => target.url.startsWith(protectedSource));
    if (!tab) await delay(250);
  }
  assert.ok(browser && tab, 'The extension should connect and expose the fixture tab');

  const blocked = await control.getState({ browserId: browser.browserId, targetId: tab.targetId });
  assert.equal(blocked.ok, false, 'Protected source must reject scripting');
  const missingSnapshot = await control.action({ browserId: browser.browserId, targetId: tab.targetId, action: 'click', selector: '#change' });
  assert.equal(missingSnapshot.ok, false, 'DOM actions still require snapshots');
  const invalidUrl = await control.action({ browserId: browser.browserId, targetId: tab.targetId, action: 'navigate', text: 'javascript:void(0)' });
  assert.equal(invalidUrl.ok, false, 'Only HTTP/HTTPS navigation is allowed');
  const navigated = await control.action({ browserId: browser.browserId, targetId: tab.targetId, action: 'navigate', text: `http://127.0.0.1:${pagePort}/` });
  assert.equal(navigated.ok, true, navigated.error);
  assert.equal(navigated.dispatched, true);
  const before = navigated.state;
  assert.equal(before.ok, true, before.error);
  assert.equal(before.title, 'Companion extension test');
  assert.ok(!JSON.stringify(before).includes('secret never expose'), 'Password values must not leave the browser');
  const button = before.elements.find((element) => element.name === 'Change');
  assert.ok(button);
  const clicked = await control.action({ browserId: browser.browserId, targetId: tab.targetId, snapshotId: before.snapshotId, action: 'click', selector: button.selector });
  assert.equal(clicked.ok, true, clicked.error);
  assert.match(clicked.state.text, /Extension verified/);
  const entry = clicked.state.elements.find((element) => element.name === 'Entry');
  assert.ok(entry, 'The accessible text field should be listed');
  const typed = await control.action({ browserId: browser.browserId, targetId: tab.targetId, snapshotId: clicked.state.snapshotId, action: 'type', selector: entry.selector, text: 'typed from Codeclub' });
  assert.equal(typed.ok, true, typed.error);
  assert.ok(typed.state.elements.some((element) => element.name === 'Entry' && element.value === 'typed from Codeclub'));
  const selectedAll = await control.action({ browserId: browser.browserId, targetId: tab.targetId, snapshotId: typed.state.snapshotId, action: 'key', selector: entry.selector, key: 'Control+A' });
  assert(selectedAll.ok, selectedAll.error);
  const replaced = await control.action({ browserId: browser.browserId, targetId: tab.targetId, snapshotId: selectedAll.state.snapshotId, action: 'type', selector: entry.selector, text: 'replacement' });
  assert.equal(replaced.state.elements.find(element => element.selector === entry.selector).value, 'replacement');
  const multiline = await control.action({ browserId: browser.browserId, targetId: tab.targetId, snapshotId: replaced.state.snapshotId, action: 'type', selector: '#multiline', text: 'first  line\nsecond line' });
  assert(multiline.ok, multiline.error);
  assert.equal(multiline.state.elements.find(element => element.selector === '#multiline').value, 'first  line\nsecond line');
  const readonly = await control.action({ browserId: browser.browserId, targetId: tab.targetId, snapshotId: multiline.state.snapshotId, action: 'click', selector: '#readonly' });
  assert(readonly.ok, readonly.error);
  const navigatedAgain = await control.action({ browserId: browser.browserId, targetId: tab.targetId, action: 'navigate', text: `http://127.0.0.1:${pagePort}/` });
  assert.equal(navigatedAgain.ok, true, navigatedAgain.error);
  const stale = await control.action({ browserId: browser.browserId, targetId: tab.targetId, snapshotId: typed.state.snapshotId, action: 'click', selector: entry.selector });
  assert.equal(stale.ok, false, 'Navigation invalidates earlier snapshots for the tab');
  const manage = async input => {
    const result = await control.manageTabs({ browserId: browser.browserId, ...input });
    assert.equal(result.ok, true, result.error);
    return result;
  };
  const one = await manage({ action: 'create', url: `http://127.0.0.1:${pagePort}/?one`, active: false });
  const two = await manage({ action: 'create', url: `http://127.0.0.1:${pagePort}/?two`, active: false });
  const ids = [one.result.targetId, two.result.targetId];
  const activated = await manage({ action: 'activate', targetId: ids[0] });
  assert(activated.tabs.find(tab => tab.targetId === ids[0]).active);
  const pinned = await manage({ action: 'update', targetId: ids[0], pinned: true, muted: true });
  assert(pinned.tabs.find(tab => tab.targetId === ids[0]).pinned);
  assert(pinned.tabs.find(tab => tab.targetId === ids[0]).muted);
  await manage({ action: 'update', targetId: ids[0], pinned: false, muted: false });
  await manage({ action: 'move', targetId: ids[1], index: -1 });
  const grouped = await manage({ action: 'group', targetIds: ids });
  const groupId = grouped.result.groupId;
  assert(ids.every(id => grouped.tabs.find(tab => tab.targetId === id).groupId === groupId));
  await manage({ action: 'activate', targetId: tab.targetId });
  await manage({ action: 'updateGroup', groupId, title: 'Codeclub debug', color: 'blue', collapsed: true });
  const groups = await manage({ action: 'listGroups' });
  assert(groups.result.some(group => group.id === groupId && group.title === 'Codeclub debug' && group.collapsed));
  await manage({ action: 'updateGroup', groupId, collapsed: false });
  await manage({ action: 'reload', targetId: ids[0] });
  const ungrouped = await manage({ action: 'ungroup', targetIds: ids });
  assert(ids.every(id => ungrouped.tabs.find(tab => tab.targetId === id).groupId === -1));
  const closed = await manage({ action: 'close', targetIds: ids });
  assert(ids.every(id => !closed.tabs.some(tab => tab.targetId === id)));
  console.log('Tab creation, activation, pin/mute, movement, groups, rename/color, collapse/expand, reload, ungroup and cleanup passed.');
  console.log('Browser companion navigated out of protected page without snapshot; tab discovery, password redaction, DOM, click and typing passed.');
} finally {
  chrome.kill();
  await Promise.race([chromeExit, delay(5000)]);
  bridge.stop();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
