/** Verify native accessibility debugging with an isolated profile and no provider requests. */
import assert from 'node:assert/strict';
import { _electron as electron, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-debug-'));
const server = createServer((_, response) => response.end('<html lang="en"><title>Debug fixture</title><button aria-label="Debug action">Debug action</button></html>'));
let instance;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app,BrowserWindow} from 'electron';app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});for(const method of ['show','showInactive','focus','maximize'])BrowserWindow.prototype[method]=function(){};await import(${JSON.stringify(new URL('../build/electron/main.js', import.meta.url).href)});`);
  const env = { ...process.env, CODECLUB_NEXT_DEV_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE;
  instance = await electron.launch({ args: [wrapper, '--codeclub-a11y-debug'], env });
  const page = await instance.firstWindow();
  await page.waitForFunction(() => window.codeclub?.invoke);
  await page.getByRole('button', { name: 'Debug action' }).waitFor();
  await assert.doesNotReject(page.evaluate(() => window.codeclub.invoke('codeclub_admin_status')));
  await expect.poll(() => instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some(window => window.webContents.isDevToolsOpened()))).toBe(true);
  const state = await instance.evaluate(({ app, BrowserWindow }) => ({
    accessibility: app.accessibilitySupportEnabled,
    forcedTree: app.commandLine.hasSwitch('force-renderer-accessibility'),
    devtools: BrowserWindow.getAllWindows().some(window => window.webContents.isDevToolsOpened()),
  }));
  assert.equal(state.accessibility, true);
  assert.equal(state.forcedTree, true);
  assert.equal(state.devtools, true);
  console.log(JSON.stringify({ passed: true, ...state, preload: true, nativeBridge: true, isolatedProfile: true }));
} finally {
  await instance?.close();
  await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('codeclub-debug-'));
  await rm(resolved, { recursive: true, force: true });
}
