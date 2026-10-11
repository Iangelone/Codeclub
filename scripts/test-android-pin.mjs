/** Isolated Electron prompt checks; fixture PINs never leave this temporary process. */
import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-android-pin-'));
let app;
try {
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import { app, BrowserWindow } from 'electron'; app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))}); globalThis.requestPin = (await import(${JSON.stringify(new URL('../electron-dist/android-pin.js', import.meta.url).href)})).requestAndroidPin; app.whenReady().then(async () => { globalThis.parent = new BrowserWindow({show:false}); await globalThis.parent.loadURL('data:text/html,<title>PIN QA</title>'); });`);
  const env = {...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({args:[wrapper],env});
  await app.firstWindow();
  for (const labels of [{title:'Unlock Android',hint:'Private PIN',cancel:'Cancel',unlock:'Unlock'}, {title:'Desbloquear Android',hint:'PIN privado',cancel:'Cancelar',unlock:'Desbloquear'}]) {
    const opened = app.waitForEvent('window');
    await app.evaluate((_, labels) => { globalThis.pinResult = globalThis.requestPin(globalThis.parent, labels); }, labels);
    const prompt = await opened;
    await prompt.locator('input').fill('1357');
    await prompt.getByRole('button', {name:labels.unlock,exact:true}).click().catch(error => { if (!/closed/i.test(error.message)) throw error; });
    assert.equal(await app.evaluate(async () => await globalThis.pinResult), '1357');
  }
  const opened = app.waitForEvent('window');
  await app.evaluate(() => { globalThis.cancelController = new AbortController(); globalThis.pinResult = globalThis.requestPin(globalThis.parent, {title:'Unlock Android',hint:'Private PIN',cancel:'Cancel',unlock:'Unlock'}, globalThis.cancelController.signal); });
  const prompt = await opened;
  await prompt.locator('input').waitFor();
  assert.equal(await prompt.evaluate(() => typeof window.codeclub), 'undefined', 'secret prompt has no application bridge');
  await app.evaluate(() => globalThis.cancelController.abort());
  assert.equal(await app.evaluate(async () => await globalThis.pinResult), null);
  console.log('Android PIN prompt passed: English, Spanish, masked input, isolated renderer, cancellation.');
} finally {
  await app?.close();
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith('codeclub-android-pin-'));
  await rm(resolved, {recursive:true,force:true});
}
