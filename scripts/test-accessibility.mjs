/** Keyboard and semantic regressions using real controls with an isolated native bridge. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-accessibility-'));
let browser, server;
try {
  const entry = path.join(directory, 'entry.tsx');
  const bundle = path.join(directory, 'app.js');
  const component = name => JSON.stringify(path.join(repo, `src/components/${name}.tsx`));
  await writeFile(entry, `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import TaskEditorModal from ${component('TaskEditorModal')};
    import OrbsPanel from ${component('OrbsPanel')};
    import ExtensionsPanel from ${component('ExtensionsPanel')};
    import {ProjectPanelView} from ${component('ProjectPanelView')};
    import OrbPaletteProvider from ${component('OrbPaletteProvider')};
    function Fixture(){const [task,setTask]=useState(false),[files,setFiles]=useState(false);
      return <OrbPaletteProvider><main><button onClick={()=>setTask(true)}>Open task</button><button onClick={()=>setFiles(true)}>Open files</button>
      <div style={{height:500,width:600}}><ProjectPanelView projectPath="C:/qa" showFileTree={files} onToggleFileTree={()=>setFiles(false)}/></div>
      <div style={{height:500,width:300}}><ExtensionsPanel layout="sidebar"/></div>
      <OrbsPanel/>{task&&<TaskEditorModal onClose={()=>setTask(false)}/>}</main></OrbPaletteProvider>;
    }createRoot(document.getElementById('root')).render(<Fixture/>);
  `);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, jsx: 'automatic', format: 'esm', platform: 'browser', nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const cssRoot = path.join(repo, 'build/renderer/_next/static/chunks');
  const css = (await Promise.all((await readdir(cssRoot)).filter(file => file.endsWith('.css')).map(file => readFile(path.join(cssRoot, file), 'utf8')))).join('\n');
  server = createServer(async (request, response) => {
    response.setHeader('content-type', request.url === '/app.js' ? 'text/javascript' : request.url === '/style.css' ? 'text/css' : 'text/html');
    response.end(request.url === '/app.js' ? await readFile(bundle) : request.url === '/style.css' ? css : '<html lang="en"><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#111"><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('codeclub-language', 'en');
    window.qaFileWrites = [];
    window.codeclub = {
      settingsGet: async (_key, fallback) => fallback, settingsSet: async () => {}, onSettingsChanged: () => () => {},
      tasksList: async () => [], onTasksChanged: () => () => {},
      appConfigDir: async () => '/qa', joinPath: async (...parts) => parts.join('/'), fileExists: async () => false,
      invoke: async (command, args) => {
        if (command === 'codeclub_list_files') return [{ path: 'src', kind: 'directory' }, { path: 'src/index.ts', kind: 'file' }, { path: 'readme.md', kind: 'file' }];
        if (command === 'codeclub_read_file') return args.path === 'readme.md' ? '# Project preview\n\n```ts\nexport const preview = true;\n```' : 'export const message = "QA";';
        if (command === 'codeclub_write_file') { window.qaFileWrites.push(args); return { ok: true }; }
        if (command === 'codeclub_list_agent_plugins') return [];
        if (command === 'codeclub_browser_extension_info') return { browsers: [] };
        return null;
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await expect.poll(() => page.locator('html').getAttribute('lang')).toBe('en');
  const openTask = page.getByRole('button', { name: 'Open task', exact: true });
  await openTask.click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  assert.equal(await page.locator('#root').evaluate(node => node.inert), true);
  const field = dialog.getByRole('textbox').first();
  await expect(field).toBeFocused();
  // Selector keys operate on buttons; text fields retain native typing behavior.
  const repeat = dialog.getByRole('button', { name: /^Repeat:/ });
  await repeat.focus();
  await repeat.press('Enter');
  const selected = dialog.getByRole('option', { selected: true });
  await expect(selected).toBeFocused();
  await selected.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(dialog.getByRole('listbox')).toHaveCount(0);
  await expect(repeat).toBeFocused();
  await repeat.press('Enter');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(repeat).toBeFocused();
  const taskButtons = dialog.locator('button:visible:not(:disabled)');
  await taskButtons.last().focus();
  await page.keyboard.press('Tab');
  await expect(taskButtons.first()).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(taskButtons.last()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(openTask).toBeFocused();
  assert.equal(await page.locator('#root').evaluate(node => node.inert), false);

  const openFiles = page.getByRole('button', { name: 'Open files', exact: true });
  await openFiles.click();
  dialog = page.getByRole('dialog', { name: 'Project files' });
  await expect(dialog).toBeFocused();
  const tree = dialog.getByRole('tree');
  const folder = tree.getByRole('treeitem', { name: 'src', exact: true });
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await folder.focus();
  await folder.press('ArrowLeft');
  await expect(folder).toHaveAttribute('aria-expanded', 'false');
  await folder.press('ArrowRight');
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await folder.press('ArrowRight');
  await expect(tree.getByRole('treeitem', { name: 'index.ts', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(folder).toBeFocused();
  assert.equal(await tree.locator('[role="treeitem"][tabindex="0"]').count(), 1);
  await dialog.evaluate(node => { const skipped = document.createElement('button'); skipped.tabIndex = -1; skipped.textContent = 'Not a tab stop'; skipped.dataset.qaNegativeTabStop = 'true'; node.append(skipped); });
  const lastTabbable = await dialog.evaluate(node => Array.from(node.querySelectorAll('button')).filter(button => button.tabIndex >= 0 && button.getClientRects().length).at(-1)?.outerHTML);
  assert.ok(lastTabbable);
  await dialog.evaluate(node => Array.from(node.querySelectorAll('button')).filter(button => button.tabIndex >= 0 && button.getClientRects().length).at(-1)?.focus());
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close project files' })).toBeFocused();
  await dialog.evaluate(node => node.querySelector('[data-qa-negative-tab-stop]')?.remove());
  await dialog.getByRole('button', { name: 'Close project files' }).click();
  await expect(openFiles).toBeFocused();

  await openFiles.click();
  dialog = page.getByRole('dialog', { name: 'Project files' });
  await dialog.getByRole('treeitem', { name: 'index.ts', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close project files' }).click();
  const editor = page.locator('.codeclub-project-files .cm-content');
  await expect(editor).toContainText('export const message = "QA";');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nexport const saved = true;');
  await expect.poll(() => page.evaluate(() => window.qaFileWrites.at(-1)?.content)).toContain('export const saved = true;');
  assert.equal(await page.evaluate(() => window.qaFileWrites.at(-1).projectPath), 'C:/qa');
  assert.equal(await page.evaluate(() => window.qaFileWrites.at(-1).path), 'src/index.ts');
  await openFiles.click();
  dialog = page.getByRole('dialog', { name: 'Project files' });
  await dialog.getByRole('treeitem', { name: 'readme.md', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close project files' }).click();
  const filePane = page.locator('.codeclub-project-files');
  await expect(filePane.getByRole('heading', { name: 'Project preview' })).toBeVisible();
  await expect(filePane.locator('.chat-code-card')).toContainText('export const preview = true;');
  await filePane.getByRole('button', { name: 'Edit: readme.md', exact: true }).click();
  await expect(editor).toContainText('# Project preview');
  await filePane.getByRole('button', { name: 'Preview: readme.md', exact: true }).click();
  await expect(filePane.getByRole('heading', { name: 'Project preview' })).toBeVisible();

  const tabs = page.locator('#codeclub-extensions-sidebar').getByRole('tab');
  await tabs.first().focus();
  await tabs.first().press('ArrowDown');
  await expect(tabs.nth(1)).toBeFocused();
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await tabs.nth(1).press('End');
  await expect(tabs.last()).toBeFocused();
  const controls = await tabs.last().getAttribute('aria-controls');
  await expect(page.locator(`#${controls}`)).toHaveAttribute('role', 'tabpanel');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect.poll(() => tabs.last().evaluate(node => getComputedStyle(node).outlineStyle)).toBe('solid');
  await page.emulateMedia({ forcedColors: 'none' });

  const createOrb = page.getByRole('button', { name: 'Design an orb', exact: true }).first();
  await createOrb.click();
  dialog = page.getByRole('dialog');
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBe(true);
  await dialog.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(createOrb).toBeFocused();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, modalIsolation: true, focusRestore: true, selectorKeyboard: true, nestedEscape: true, tabTrap: true, treeKeyboard: true, editorAutosave: true, markdownPreview: true, previewToggle: true, verticalTabs: true, highContrastFocus: true, orbDialog: true, language: true }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.ok(path.dirname(resolved) === path.resolve(tmpdir()) && path.basename(resolved).startsWith('codeclub-accessibility-'));
  await rm(resolved, { recursive: true, force: true });
}
