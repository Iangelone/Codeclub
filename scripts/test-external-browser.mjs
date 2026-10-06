import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { createExternalBrowserControl } from '../electron-dist/external-browser.js';

const profile = await mkdtemp(path.join(tmpdir(), 'codeclub-cdp-test-'));
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end('<!doctype html><title>CDP smoke test</title><main>Initial state</main><button id="change" onclick="document.querySelector(\'main\').textContent=\'Verified state\'">Change</button><input id="entry" aria-label="Entry"><input type="password" value="never return">');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const pagePort = server.address().port;
const portServer = createServer();
await new Promise((resolve) => portServer.listen(0, '127.0.0.1', resolve));
const cdpPort = portServer.address().port;
await new Promise((resolve, reject) => portServer.close((error) => error ? reject(error) : resolve()));

const child = spawn(chromium.executablePath(), [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
  `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, `http://127.0.0.1:${pagePort}/`,
], { windowsHide: true, stdio: 'ignore' });
const childExit = new Promise((resolve) => child.once('exit', resolve));

try {
  let found;
  for (let attempt = 0; attempt < 40 && !found; attempt++) {
    try { found = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); }
    catch { await delay(250); }
  }
  assert.ok(Array.isArray(found), 'Chromium should expose the local target list');
  const control = createExternalBrowserControl();
  const listed = await control.list({ ports: [cdpPort] });
  assert.equal(listed.ok, true);
  const tab = listed.browsers.flatMap((browser) => browser.targets.map((target) => ({ ...target, port: browser.port }))).find((target) => target.url.startsWith('http://127.0.0.1:'));
  assert.ok(tab, 'The fixture tab should be discovered');

  const initial = await control.getState({ port: cdpPort, targetId: tab.targetId });
  assert.equal(initial.ok, true, initial.error);
  const navigated = await control.action({ port: cdpPort, targetId: tab.targetId, snapshotId: initial.snapshotId, action: 'navigate', text: `http://127.0.0.1:${pagePort}/` });
  assert.equal(navigated.ok, true, navigated.error);
  const before = navigated.state;
  assert.equal(before.ok, true, before.error);
  assert.equal(before.title, 'CDP smoke test');
  assert.ok(before.elements.some((element) => element.name === 'Change'));
  assert.ok(!JSON.stringify(before).includes('never return'), 'Password values must be omitted');

  const button = before.elements.find((element) => element.name === 'Change');
  const clicked = await control.action({ port: cdpPort, targetId: tab.targetId, snapshotId: before.snapshotId, action: 'click', selector: button.selector });
  assert.equal(clicked.ok, true, clicked.error);
  assert.equal(clicked.state.ok, true, clicked.state.error);
  assert.match(clicked.state.text, /Verified state/);
  const entry = clicked.state.elements.find((element) => element.name === 'Entry');
  assert.ok(entry, 'The accessible text field should be returned');
  const typed = await control.action({ port: cdpPort, targetId: tab.targetId, snapshotId: clicked.state.snapshotId, action: 'type', selector: entry.selector, text: 'Codeclub input verified' });
  assert.equal(typed.ok, true, typed.error);
  assert.equal(typed.state.ok, true, typed.state.error);
  assert.ok(typed.state.elements.some((element) => element.name === 'Entry' && element.value === 'Codeclub input verified'));
  console.log('External browser CDP discovery, DOM observation, password redaction, click and typing passed.');
} finally {
  child.kill();
  await Promise.race([childExit, delay(5000)]);
  await new Promise((resolve) => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
