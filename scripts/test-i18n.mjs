import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { nativeText, setNativeLanguage } from '../build/electron/i18n/index.js';

setNativeLanguage('en');
assert.equal(nativeText('tray.open'), 'Open');
assert.equal(nativeText('computerMenu.select', 'es'), 'Seleccionar elemento');
setNativeLanguage('es');
assert.equal(nativeText('tray.quit'), 'Salir');

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-i18n-'));
let browser, server;
try {
  const entry = path.join(directory, 'entry.tsx');
  const bundle = path.join(directory, 'app.js');
  await writeFile(entry, `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {useAppLanguage,setAppLanguage,translate} from ${JSON.stringify(path.join(repo, 'src/lib/i18n.ts'))};
    import TaskEditorModal from ${JSON.stringify(path.join(repo, 'src/components/TaskEditorModal.tsx'))};
    import ExtensionsPanel from ${JSON.stringify(path.join(repo, 'src/components/ExtensionsPanel.tsx'))};
    window.qaSetLanguage=setAppLanguage;window.qaTranslate=translate;
    function Language(){const language=useAppLanguage();return <output data-language>{language}</output>}
    function Fixture(){const [open,setOpen]=useState(false);return <><Language/><Language/>
      <button onClick={()=>setOpen(true)}>Open fixture</button><ExtensionsPanel/>
      {open&&<TaskEditorModal onClose={()=>setOpen(false)}/>}</>}
    createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>);`);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, format: 'esm', platform: 'browser', nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  server = createServer(async (request, response) => {
    response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/app.js' ? await readFile(bundle) : '<html><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext();
  const errors = [];
  await context.addInitScript(() => {
    const listeners = new Set();
    window.qaNativeWrites = [];
    window.qaNativeLanguage = undefined;
    window.qaNativeChange = language => { window.qaNativeLanguage = language; listeners.forEach(listener => listener({ key: 'codeclub-language' })); };
    window.codeclub = {
      settingsGet: async key => {
        const value = key === 'codeclub-language' ? window.qaNativeLanguage : undefined;
        if (window.qaNativeReadDelay) await new Promise(resolve => setTimeout(resolve, window.qaNativeReadDelay));
        return value;
      },
      settingsSet: async (key, value) => { if (key === 'codeclub-language') { window.qaNativeLanguage = value; window.qaNativeWrites.push(value); } },
      onSettingsChanged: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      invoke: async command => command === 'codeclub_list_agent_plugins' ? [] : command === 'codeclub_browser_extension_info' ? { browsers: [] } : null,
    };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const url = `http://127.0.0.1:${server.address().port}`;
  await page.goto(url);
  await expect(page.locator('[data-language]')).toHaveText(['es', 'es']);
  await page.evaluate(() => window.qaSetLanguage('en'));
  await expect(page.locator('[data-language]')).toHaveText(['en', 'en']);
  await expect(page.getByRole('heading', { name: 'Extensions', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open fixture' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Task name', exact: true }).fill('Keep my draft');
  await page.evaluate(() => window.qaSetLanguage('es'));
  await expect(dialog.getByRole('textbox', { name: 'Nombre de la tarea', exact: true })).toHaveValue('Keep my draft');
  await expect(dialog.getByRole('heading')).toHaveText('Nueva tarea');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'Extensiones', exact: true })).toBeVisible();
  const other = await context.newPage();
  await other.goto(url);
  await other.evaluate(() => window.qaSetLanguage('en'));
  await expect(page.locator('[data-language]')).toHaveText(['en', 'en']);
  await page.reload();
  await expect(page.locator('[data-language]')).toHaveText(['en', 'en']);
  await page.evaluate(() => window.qaNativeChange('es'));
  await expect(page.locator('[data-language]')).toHaveText(['es', 'es']);
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'es');
  // A native read started before a newer choice in another window must not undo it.
  await page.evaluate(() => { window.qaNativeReadDelay = 80; window.qaNativeChange('es'); });
  await other.evaluate(() => window.qaSetLanguage('en'));
  await page.waitForTimeout(120);
  await expect(page.locator('[data-language]')).toHaveText(['en', 'en']);
  assert.equal(await page.evaluate(() => window.qaTranslate('orbUpcomingTask.scheduled', 'en', { name: 'QA task', time: '12:30' })).then(text => text.includes('QA task') && text.includes('12:30') && !text.includes('{{')), true);
  assert.ok((await page.evaluate(() => window.qaNativeWrites)).includes('en'));
  assert.deepEqual(errors, []);
  console.log('i18n: shared hooks, native preference/tray, cross-window sync, reload persistence, modal draft, extension metadata and interpolation passed.');
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
