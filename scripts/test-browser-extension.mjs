import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { BrowserExtensionBridge } from '../electron-dist/browser-extension-bridge.js';
import { ExternalBrowserControl } from '../electron-dist/external-browser.js';

const project = process.cwd();
const extension = path.join(project, 'browser-extension');
const profile = await mkdtemp(path.join(tmpdir(), 'codeclub-extension-test-'));
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>Companion extension test</title><main>Initial state</main><button id="change" onclick="document.querySelector(\'main\').textContent=\'Extension verified\'">Change</button><input id="entry" aria-label="Entry"><input type="password" value="secret never expose">');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const pagePort = server.address().port;
const bridge = new BrowserExtensionBridge();
assert.equal(await bridge.start(), true, 'The local browser extension bridge should start');
const chrome = spawn(chromium.executablePath(), [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  `--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
  `--user-data-dir=${profile}`, `http://127.0.0.1:${pagePort}/`,
], { windowsHide: true, stdio: 'ignore' });
const chromeExit = new Promise((resolve) => chrome.once('exit', resolve));

try {
  const control = new ExternalBrowserControl(bridge);
  let browser; let tab;
  for (let attempt = 0; attempt < 80 && !tab; attempt++) {
    const listed = await control.list({ ports: [] });
    browser = listed.browsers.find((item) => item.connection === 'extension');
    tab = browser?.targets.find((target) => target.url.startsWith('http://127.0.0.1:'));
    if (!tab) await delay(250);
  }
  assert.ok(browser && tab, 'The extension should connect and expose the fixture tab');
  const before = await control.getState({ browserId: browser.browserId, targetId: tab.targetId });
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
  console.log('Browser companion extension connected; tab discovery, password redaction, DOM, click and typing passed.');
} finally {
  chrome.kill();
  await Promise.race([chromeExit, delay(5000)]);
  bridge.stop();
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
