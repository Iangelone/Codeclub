import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-sidebar-layout-'));
let browser, server;
try {
  const entry = path.join(directory, 'entry.tsx');
  const bundle = path.join(directory, 'app.js');
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import HomePage from ${JSON.stringify(path.join(repo, 'src/app/page.tsx'))};import OrbPaletteProvider from ${JSON.stringify(path.join(repo, 'src/components/OrbPaletteProvider.tsx'))};createRoot(document.getElementById('root')).render(<OrbPaletteProvider><HomePage /></OrbPaletteProvider>);`);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, jsx: 'automatic', format: 'esm', platform: 'browser', nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', plugins: [{
    name: 'isolate-chat-runtime',
    setup(builder) {
      // Keep the actual page, navigation bars, sidebar and persistence hooks.
      // Only the AI chat and background task execution are outside this regression.
      builder.onResolve({ filter: /(?:^|\/)(ChatPanel|FloatingChat|ScheduledTaskRunner)(?:\.tsx)?$/ }, args => ({ path: args.path, namespace: 'qa-child' }));
      builder.onLoad({ filter: /.*/, namespace: 'qa-child' }, () => ({ contents: `import React from 'react';export default function Child(){return <div data-qa-chat/>}`, loader: 'jsx', resolveDir: repo }));
    },
  }] });
  const cssDirectory = path.join(repo, 'out/_next/static/chunks');
  const styles = (await readdir(cssDirectory)).filter(file => file.endsWith('.css'));
  const stylesheet = (await Promise.all(styles.map(file => readFile(path.join(cssDirectory, file), 'utf8')))).join('\n');
  server = createServer(async (request, response) => {
    if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(await readFile(bundle)); return; }
    if (request.url === '/style.css') { response.setHeader('content-type', 'text/css'); response.end(stylesheet); return; }
    response.setHeader('content-type', 'text/html');
    response.end('<html><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const project = { id: 'fixture', name: 'Proyecto QA', path: 'C:/qa/project' };
    if (!localStorage.getItem('qa:initialized')) {
      localStorage.setItem('qa:initialized', 'true');
      localStorage.setItem('codeclub:active-project', JSON.stringify(project));
      localStorage.setItem('codeclub:layout-visibility', JSON.stringify({ leftOpen: true, rightOpen: true }));
    }
    window.qa = { reloads: 0, renames: 0, emptyChats: 0 };
    window.addEventListener('codeclub:open-empty-chat', () => { window.qa.emptyChats++; });
    const files = new Map();
    window.codeclub = {
      onMainShow: () => () => {}, onTasksChanged: () => () => {}, onFullscreenChange: () => () => {},
      windowIsFullScreen: async () => false, onSessions: () => () => {}, sessionList: async () => [],
      listProjects: async () => [project], switchProject: async () => project,
      onAutoUpdate: () => () => {}, getAutoUpdateStatus: async () => ({}),
      reloadApp: async () => { window.qa.reloads++; },
      renameProject: async (_id, name) => { window.qa.renames++; project.name = name; return { ...project }; },
      appConfigDir: async () => '/qa', appCacheDir: async () => '/qa/cache',
      joinPath: async (...parts) => parts.join('/'), makeDirectory: async () => {},
      fileExists: async filename => files.has(filename), readTextFile: async filename => files.get(filename) || '',
      writeTextFile: async (filename, contents) => { files.set(filename, contents); },
      invoke: async command => command === 'codeclub_get_username' ? 'QA' : [],
    };
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  const sidebar = page.locator('#codeclub-left-sidebar');
  const rename = sidebar.getByRole('button', { name: 'Cambiar nombre del proyecto', exact: true });
  await rename.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Recargar', exact: true, includeHidden: true }).count(), 0, 'Collapsed toolbar removes its reload button from the DOM');

  const assertHit = async locator => {
    await expect.poll(() => locator.evaluate(button => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), { message: 'The visible control receives clicks at its center' }).toBe(true);
  };
  await assertHit(rename);
  await assertHit(sidebar.getByRole('button', { name: 'Ocultar sidebar izquierda', exact: true }));
  await page.mouse.click(136, 56); // Former invisible Reload hitbox over the sidebar header.
  assert.equal(await page.evaluate(() => window.qa.reloads), 0, 'Clicking the sidebar header never reloads the app');
  await rename.click();
  const nameInput = sidebar.getByRole('textbox', { name: 'Nombre del proyecto', exact: true });
  await nameInput.waitFor();
  await nameInput.fill('Cancelado QA');
  await nameInput.press('Escape');
  assert.equal(await page.evaluate(() => window.qa.renames), 0, 'Escape cancels without a native rename');
  await rename.click();
  await nameInput.fill('Renombrado QA');
  await nameInput.press('Enter');
  await sidebar.getByText('Renombrado QA', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.qa.renames), 1, 'Enter commits exactly one rename');
  const emptyChats = await page.evaluate(() => window.qa.emptyChats);
  await sidebar.getByRole('button', { name: 'Ocultar sidebar izquierda', exact: true }).click();
  await page.getByRole('button', { name: 'Mostrar barra lateral izquierda', exact: true }).click();
  await rename.waitFor();
  await assertHit(rename);
  assert.equal(await page.evaluate(() => window.qa.emptyChats), emptyChats, 'Sidebar visibility preserves the current project/chat');

  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: 'Mostrar barra superior', exact: true }).click();
    const reload = page.getByRole('button', { name: 'Recargar', exact: true });
    await assertHit(reload);
    const geometry = await page.evaluate(() => ({
      toolbarBottom: document.querySelector('[role="toolbar"] button[title="Recargar"]').closest('[role="toolbar"]').getBoundingClientRect().bottom,
      workspaceTop: document.getElementById('codeclub-workspace').getBoundingClientRect().top,
    }));
    assert.ok(geometry.workspaceTop >= geometry.toolbarBottom, 'The expanded toolbar occupies its own grid row');
    const search = page.getByRole('textbox', { name: 'Buscar en Renombrado QA', exact: true });
    await search.focus();
    await page.getByRole('button', { name: 'Ocultar barra superior', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Recargar', exact: true, includeHidden: true }).count(), 0);
    await assertHit(rename);
  }
  await page.keyboard.press('Tab');
  for (let index = 0; index < 18; index++) {
    assert.notEqual(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Recargar', 'Hidden controls cannot receive keyboard focus');
    await page.keyboard.press('Tab');
  }
  const separator = page.getByRole('separator', { name: 'Redimensionar sidebar izquierda', exact: true });
  await separator.focus();
  await separator.press('End');
  await page.waitForFunction(() => Math.abs(document.getElementById('codeclub-left-sidebar').getBoundingClientRect().width - 420) < 1);
  await assertHit(rename);
  await separator.press('Home');
  await page.waitForFunction(() => Math.abs(document.getElementById('codeclub-left-sidebar').getBoundingClientRect().width - 220) < 1);
  await assertHit(rename);
  await page.getByRole('button', { name: 'Mostrar barra superior', exact: true }).click();
  await page.getByRole('button', { name: 'Recargar', exact: true }).click();
  assert.equal(await page.evaluate(() => window.qa.reloads), 1, 'Reload works only when the toolbar is visible and intentionally clicked');
  await page.getByRole('button', { name: 'Ocultar barra superior', exact: true }).click();
  await page.reload();
  await rename.waitFor();
  assert.equal(await page.getByRole('button', { name: 'Recargar', exact: true, includeHidden: true }).count(), 0, 'Collapsed visibility persists across reload');
  await page.evaluate(() => {
    localStorage.setItem('codeclub-language', 'en');
    window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language: 'en' } }));
  });
  await assertHit(sidebar.getByRole('button', { name: 'Rename project', exact: true }));
  await page.getByRole('button', { name: 'Show top bar', exact: true }).click();
  await assertHit(page.getByRole('button', { name: 'Reload', exact: true }));
  assert.deepEqual(errors, [], 'Layout controls cause no runtime errors');
  console.log(JSON.stringify({ passed: true, collapsedHitTesting: true, renameAndCancel: true, sidebarVisibility: true, repeatedToggles: true, keyboardFocus: true, resizing: true, intentionalReload: true, persistence: true, languageSwitch: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('codeclub-sidebar-layout-')) throw new Error('Unexpected test directory');
  await rm(resolved, { recursive: true, force: true });
}
