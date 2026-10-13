/** Real Electron/preload/ADB discovery; no model or credentials are involved. */
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-android-bridge-'));
const server = createServer((_, response) => response.end('<title>Android bridge QA</title>'));
let app;
let livePin = process.env.CODECLUB_ANDROID_TEST_PIN;
delete process.env.CODECLUB_ANDROID_TEST_PIN;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app,BrowserWindow} from 'electron';app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});for(const method of ['show','showInactive','focus','maximize'])BrowserWindow.prototype[method]=function(){};await import(${JSON.stringify(new URL('../build/electron/main.js', import.meta.url).href)});`);
  const env = { ...process.env, CODECLUB_NEXT_DEV_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [wrapper], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.codeclub?.invoke));
  const invoke = (operation, request = {}) => page.evaluate(({ operation, request }) => window.codeclub.invoke(`codeclub_android_${operation}`, { request }), { operation, request });
  const list = await invoke('list_devices');
  assert.equal(list.ok, true, list.error);
  assert.ok(list.devices.some(device => device.state === 'device'), 'authorized Android is visible through the real preload');
  const authorizedDeviceId = list.devices.find(device => device.state === 'device').deviceId;
  assert.equal((await invoke('pin_status', {deviceId:authorizedDeviceId})).saved, false);
  if (livePin) {
    await invoke('pin_save', {deviceId:authorizedDeviceId,pin:livePin});
    livePin = '';
    const locked = await invoke('lock', {deviceId:authorizedDeviceId});
    assert.equal(locked.locked, true, 'physical device locking is confirmed');
    const unlocked = await Promise.race([invoke('unlock', {deviceId:authorizedDeviceId, labels:{title:'Unlock Android',hint:'Private PIN',cancel:'Cancel',unlock:'Unlock'}}), new Promise((_, reject) => setTimeout(() => reject(new Error('Stored PIN unlock timeout')), 20000).unref())]);
    assert.equal(unlocked.unlocked, true, 'stored encrypted PIN unlocks through actual Electron IPC without a secret prompt');
    await invoke('pin_save', {deviceId:authorizedDeviceId,pin:''});
  }
  assert.deepEqual(await invoke('pin_save', {deviceId:authorizedDeviceId,pin:'1357'}), {saved:true});
  assert.deepEqual(await invoke('pin_status', {deviceId:authorizedDeviceId}), {saved:true}, 'status never returns the PIN');
  const encrypted = await (await import('node:fs/promises')).readFile(path.join(directory, 'profile', 'credentials.encrypted.json'), 'utf8');
  assert.equal(encrypted.includes('1357'), false, 'real Electron safeStorage encrypts the PIN');
  await invoke('pin_save', {deviceId:authorizedDeviceId,pin:''});
  assert.equal((await invoke('pin_status', {deviceId:authorizedDeviceId})).saved, false);
  assert.equal((await invoke('action', { deviceId: list.devices[0].deviceId, action: 'key', key: 'home', snapshotId: 'invalid' })).ok, false, 'invalid snapshot does not dispatch');
  assert.equal((await invoke('stop')).ok, true);
  const untrusted = await app.evaluate(async ({ BrowserWindow }, preload) => {
    const window = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false } });
    try {
      await window.loadURL('data:text/html,<title>Untrusted content</title>');
      return await window.webContents.executeJavaScript(`window.codeclub.invoke('codeclub_android_list_devices',{}).then(()=>false,error=>error.message.includes('Unauthorized renderer'))`);
    } finally { window.destroy(); }
  }, path.resolve('electron/preload.cjs'));
  assert.equal(untrusted, true, 'foreign renderers cannot access Android');
  console.log('Real Android bridge passed: main IPC, preload, authorized ADB device, snapshot rejection, stop, renderer isolation.');
} finally {
  livePin = '';
  await app?.close(); await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('codeclub-android-bridge-'));
  await rm(resolved, { recursive: true, force: true });
}
