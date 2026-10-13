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
      builder.onLoad({ filter: /.*/, namespace: 'qa-child' }, args => ({ contents: args.path.includes('ChatPanel') ? `import React from 'react';import WorkspaceManager from ${JSON.stringify(path.join(repo, 'src/components/WorkspaceManager.tsx'))};export default function Child(){return <WorkspaceManager catalog={{}} defaultProvider="qa" defaultModel="qa"/>}` : `import React from 'react';export default function Child(){return <div data-qa-chat/>}`, loader: 'jsx', resolveDir: repo }));
      builder.onResolve({ filter: /ChatInterface\.tsx$/ }, args => ({ path: args.path, namespace: 'qa-chat' }));
      builder.onLoad({ filter: /.*/, namespace: 'qa-chat' }, () => ({ contents: `import React from 'react';export default function Chat(){return <div data-qa-chat/>}`, loader: 'jsx', resolveDir: repo }));
    },
  }] });
  const cssDirectory = path.join(repo, 'build/renderer/_next/static/chunks');
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
  page.on('pageerror', error => { errors.push(error.message); console.error('Layout:', error.message); });
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
      credentialPresent: async () => false, tasksList: async () => [],
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
  const projectRow = sidebar.getByRole('button', { name: 'Proyecto QA', exact: true });
  await projectRow.click({ button: 'right' });
  const projectMenu = page.getByRole('menu', { name: 'Menú del proyecto: Proyecto QA', exact: true });
  await expect(projectMenu).toBeVisible();
  await expect(projectMenu.getByRole('menuitem')).toHaveCount(3);
  for (const item of await projectMenu.getByRole('menuitem').all()) assert.ok(await item.evaluate(button => { const text = button.querySelector('span'); return button.scrollHeight <= button.clientHeight && text.getBoundingClientRect().height <= parseFloat(getComputedStyle(text).lineHeight) + 1; }), 'Project menu labels fit on one line');
  if (process.env.CODECLUB_QA_PROJECT_MENU_SCREENSHOT) await projectMenu.screenshot({ path: process.env.CODECLUB_QA_PROJECT_MENU_SCREENSHOT });
  await projectMenu.getByRole('menuitem', { name: 'Cambiar nombre', exact: true }).click();
  await expect(sidebar.getByRole('textbox', { name: 'Nombre del proyecto', exact: true })).toHaveValue('Proyecto QA');
  await sidebar.getByRole('textbox', { name: 'Nombre del proyecto', exact: true }).press('Escape');
  await projectRow.focus(); await projectRow.press('Shift+F10');
  await expect(projectMenu).toBeVisible(); await page.keyboard.press('Escape');
  await expect(projectMenu).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('codeclub:open-project-picker')));
  const quickProjects = page.getByRole('menu', { name: 'Proyectos', exact: true });
  await expect(quickProjects.getByRole('menuitemradio').first()).toBeFocused();
  await page.keyboard.press('Escape'); await expect(quickProjects).toHaveCount(0);
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
  await sidebar.getByTitle('Renombrado QA', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.qa.renames), 1, 'Enter commits exactly one rename');
  const emptyChats = await page.evaluate(() => window.qa.emptyChats);
  await sidebar.getByRole('button', { name: 'Ocultar sidebar izquierda', exact: true }).click();
  await page.getByRole('button', { name: 'Mostrar barra lateral izquierda', exact: true }).click();
  await rename.waitFor();
  await assertHit(rename);
  assert.equal(await page.evaluate(() => window.qa.emptyChats), emptyChats, 'Sidebar visibility preserves the current project/chat');

  assert.equal(await page.getByRole('button', { name: 'Mostrar barra superior', exact: true }).count(), 0, 'Removed toolbar has no toggle');
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
  const right = page.locator('#codeclub-right-sidebar');
  const emit = (name, detail) => page.evaluate(({ name, detail }) => window.dispatchEvent(new CustomEvent(name, { detail })), { name, detail });
  await page.getByRole('button', { name: 'Mostrar barra lateral derecha', exact: true }).click();
  await right.getByRole('button', { name: 'Archivos', exact: true }).click();
  await right.getByRole('tab', { name: 'Archivos', exact: true }).waitFor();
  const panelMenuTrigger = right.getByRole('button', { name: /Abrir paneles/ });
  await panelMenuTrigger.focus();
  await panelMenuTrigger.press('Enter');
  await expect(right.getByRole('menuitemradio').filter({ hasText: 'Navegador' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panelMenuTrigger).toBeFocused();
  await right.getByRole('button', { name: 'Cerrar Archivos', exact: true }).click();
  await expect(right).toHaveAttribute('aria-hidden', 'true');
  await expect(right.getByRole('tab', { name: 'Archivos', includeHidden: true })).toHaveCount(0);
  await emit('codeclub:open-chat', { chatId: 'chat-a', projectPath: 'C:/qa/project', projectName: 'Proyecto QA', projectId: 'fixture' });
  await emit('codeclub:open-right-panel', { chatId: 'chat-a', projectPath: 'C:/qa/project' });
  await expect(right).toHaveAttribute('aria-hidden', 'false');
  const browserTab = right.getByRole('tab', { name: 'Navegador', exact: true, includeHidden: true });
  await browserTab.waitFor();
  const browserMenuTrigger = right.getByRole('button', { name: 'Más opciones', exact: true });
  await browserMenuTrigger.click();
  await expect(right.getByRole('menuitem', { name: 'Recargar', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(browserMenuTrigger).toBeFocused();
  await emit('codeclub:open-right-panel', { chatId: 'background', projectPath: 'C:/qa/project' });
  await expect(right.getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'Ocultar barra lateral derecha', exact: true }).click();
  await emit('codeclub:open-chat', { chatId: 'background', projectPath: 'C:/qa/project', projectId: 'fixture' });
  await expect(right).toHaveAttribute('aria-hidden', 'false');
  await browserTab.waitFor();
  const backgroundPanel = await browserTab.getAttribute('aria-controls');
  await page.locator('header').getByRole('button', { name: 'Atrás', exact: true }).click();
  await expect.poll(() => browserTab.getAttribute('aria-controls')).not.toBe(backgroundPanel);
  await expect(right).toHaveAttribute('aria-hidden', 'true');
  await emit('codeclub:open-right-panel', { chatId: 'chat-a', projectPath: 'C:/qa/project' });
  await expect(right).toHaveAttribute('aria-hidden', 'false');
  const chatPanel = await browserTab.getAttribute('aria-controls');
  await sidebar.getByRole('button', { name: 'Extensiones', exact: true }).click();
  await expect(browserTab).toHaveAttribute('aria-controls', chatPanel);
  await expect(page.locator('header [data-slash-menu-toggle]')).toHaveCount(0);
  await page.locator('header').getByRole('button', { name: 'Atrás', exact: true }).click();
  await expect(page.locator('[data-main-panel]')).toHaveAttribute('data-main-panel', 'new-chat');
  await expect(browserTab).toHaveAttribute('aria-controls', chatPanel);
  const projectsCategory = sidebar.getByRole('button', { name: 'Proyectos', exact: true });
  await projectsCategory.click();
  await expect(projectsCategory).toHaveAttribute('aria-expanded', 'false');
  await page.reload();
  await rename.waitFor();
  await expect(projectsCategory).toHaveAttribute('aria-expanded', 'false');
  await page.evaluate(() => {
    const views = JSON.parse(localStorage.getItem('codeclub:right-chat-views') || '{}');
    views[JSON.stringify(['C:/qa/project', 'draft'])] = { panels: [{ instanceId: 'restored-file', tab: 'files', label: 'Files' }], active: 'deleted-tab', open: true, width: 300, tree: false, file: '' };
    localStorage.setItem('codeclub:right-chat-views', JSON.stringify(views));
  });
  await page.reload();
  await rename.waitFor();
  await expect(right.getByRole('tab', { name: 'Archivos', exact: true })).toHaveAttribute('aria-selected', 'true');
  await sidebar.getByRole('button', { name: 'Nuevo chat', exact: true }).click();
  await expect(right).toHaveAttribute('aria-hidden', 'true');
  await expect(right.getByRole('tab', { includeHidden: true })).toHaveCount(0);
  await page.reload();
  await expect(right).toHaveAttribute('aria-hidden', 'true');
  await expect(right.getByRole('tab', { includeHidden: true })).toHaveCount(0);
  await page.evaluate(() => {
    localStorage.setItem('codeclub-language', 'en');
    window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language: 'en' } }));
  });
  await assertHit(sidebar.getByRole('button', { name: 'Your orb', exact: true }));
  await page.getByRole('button', { name: 'Extensions', exact: true }).first().click();
  await assertHit(sidebar.getByRole('button', { name: 'Hide left sidebar', exact: true }));
  await page.getByRole('button', { name: 'Home', exact: true }).first().click();
  await sidebar.getByRole('button', { name: 'Your orb', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.locator('#codeclub-main-content')).toHaveAttribute('data-surface', 'orbs');
  await expect(right.getByRole('button', { name: 'Configure', exact: true })).toBeVisible();
  await assertHit(right.getByRole('button', { name: 'Configure', exact: true }));
  await expect.poll(async () => (await right.boundingBox()).width).toBeGreaterThanOrEqual(220);
  if (process.env.CODECLUB_QA_SCREENSHOT) await right.screenshot({ path: process.env.CODECLUB_QA_SCREENSHOT });
  await expect(page.getByRole('log')).toContainText('Hi, I’m your orb.');
  const orb = await page.evaluate(() => JSON.parse(localStorage.getItem('codeclub:settings')).codeclub_orbs[0]);
  await expect(sidebar.getByRole('button', { name: 'Your orb', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(sidebar.locator('[aria-current="page"]')).toHaveCount(1);
  assert.ok(await page.evaluate(chatId => !(JSON.parse(localStorage.getItem('codeclub:settings')).codeclub_global_chats || []).some(chat => chat.id === chatId), orb.chatId), 'Orb history does not enter the global chat index');
  await expect(page.getByRole('switch', { name: 'PC access', exact: true })).toHaveCount(0);
  await sidebar.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.locator('#codeclub-main-content')).toHaveAttribute('data-surface', 'new-chat');
  await page.evaluate(chatId => window.dispatchEvent(new CustomEvent('codeclub:open-chat', { detail: { chatId, projectPath: '' } })), orb.chatId);
  await expect(page.locator('#codeclub-main-content')).toHaveAttribute('data-surface', 'orbs');
  await expect(right.getByRole('button', { name: 'Configure', exact: true })).toBeVisible();
  assert.deepEqual(errors, [], 'Layout controls cause no runtime errors');
  console.log(JSON.stringify({ passed: true, renameAndCancel: true, sidebarVisibility: true, keyboardFocus: true, resizing: true, closeLastTab: true, backgroundPanels: true, navigationIsolation: true, customizePreservesScope: true, emptyHome: true, restoredActiveTab: true, categoryPersistence: true, languageSwitch: true, orbChatSidebar: true, recentOrbRouting: true }));
} finally {
  await browser?.close();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('codeclub-sidebar-layout-')) throw new Error('Unexpected test directory');
  await rm(resolved, { recursive: true, force: true });
}
