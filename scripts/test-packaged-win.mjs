import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executablePath = path.resolve(process.argv[2] || path.join(repo, 'release/win-unpacked/Codeclub.exe'));
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-packaged-'));
const profile = path.join(directory, 'profile');
const project = path.join(directory, 'project');
await mkdir(project);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.CODECLUB_NEXT_DEV_URL;
let app;
const errors = [];
const server = createServer((_, response) => response.end('<title>Packaged browser QA</title><button id="target">Packaged selection</button>'));
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], env, timeout: 60000 });
  const runtime = await app.evaluate(({ app }) => ({ packaged: app.isPackaged, profile: app.getPath('userData'), resources: process.resourcesPath }));
  assert.equal(runtime.packaged, true);
  assert.equal(path.resolve(runtime.profile).toLowerCase(), profile.toLowerCase(), 'Use an isolated profile');
  for (const resource of ['agent-relay.ps1', 'computer-use.ps1', 'tesseract']) await stat(path.join(runtime.resources, resource));
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => Boolean(window.codeclub?.invoke && document.querySelector('main')));
  assert.ok(page.url().startsWith('file:'), 'Load the exported renderer without a dev server');
  await page.getByRole('separator').first().waitFor();
  console.log('Packaged startup, preload, local renderer and resources passed.');
  const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.codeclub.invoke(command, args), { command, args });
  const terminal = await invoke('codeclub_terminal_create', { request: { cwd: project, shell: 'powershell' } });
  await invoke('codeclub_terminal_write', { id: terminal.id, data: "Write-Output ('PACKAGED_' + 'PTY_OK')\r" });
  await page.waitForFunction(async id => (await window.codeclub.invoke('codeclub_terminal_snapshot', { id })).output.includes('PACKAGED_PTY_OK'), terminal.id, { timeout: 20000 });
  await invoke('codeclub_terminal_resize', { id: terminal.id, cols: 90, rows: 28 });
  await invoke('codeclub_terminal_delete', { id: terminal.id });
  const result = await invoke('codeclub_run_command', { projectPath: project, request: { command: 'powershell.exe', args: ['-NoProfile', '-Command', "Write-Output 'PACKAGED_TOOL_OK'"] } });
  assert.equal(result.ok, true);
  assert.equal(result.stdout.trim(), 'PACKAGED_TOOL_OK');
  console.log('Packaged PowerShell PTY, resize, cleanup and native command passed.');
  await app.evaluate(({ dialog }, project) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] }); }, project);
  const registered = await page.evaluate(() => window.codeclub.selectProjectFolder());
  assert.equal(path.resolve(registered.path), project);
  await page.evaluate(async registered => {
    await window.codeclub.switchProject(registered.id);
    window.dispatchEvent(new CustomEvent('codeclub:project-switch', { detail: registered }));
  }, registered);
  await page.waitForFunction(project => JSON.parse(localStorage.getItem('codeclub:active-project') || 'null')?.path === project, project);
  for (const language of ['en', 'es']) {
    await page.evaluate(language => {
      localStorage.setItem('codeclub-language', language);
      window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language } }));
    }, language);
    await page.waitForFunction(language => document.documentElement.lang === language, language);
  }
  const separator = page.getByRole('separator').first();
  const before = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus();
  await separator.press('ArrowRight');
  await page.waitForFunction(before => Number(document.querySelector('[role="separator"]').getAttribute('aria-valuenow')) > before, before);
  assert.equal(await separator.evaluate(element => element === document.activeElement), true);
  await page.reload();
  await page.getByRole('separator').first().waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem('codeclub-language')), 'es');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('codeclub:active-project')).path), project);
  assert.equal((await page.evaluate(() => window.codeclub.listProjects())).some(item => item.id === registered.id), true);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('codeclub:open-right-sidebar'));
    window.dispatchEvent(new CustomEvent('codeclub:open-right-panel'));
  });
  await page.locator('webview').waitFor({ state: 'attached' });
  await page.evaluate(url => window.dispatchEvent(new CustomEvent('codeclub:browser-navigate', { detail: { url } })), `http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => document.querySelector('webview')?.getURL?.().startsWith('http://127.0.0.1:'));
  await page.waitForFunction(async () => (await document.querySelector('webview').executeJavaScript('document.title')) === 'Packaged browser QA');
  await page.getByRole('button', { name: 'Seleccionar elemento', exact: true }).click();
  await page.waitForFunction(async () => await document.querySelector('webview').executeJavaScript('Boolean(window.__codeclubStopPicker)'));
  await page.evaluate(() => document.querySelector('webview').executeJavaScript("document.querySelector('#target').dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 25, clientY: 25 }))"));
  await page.getByRole('textbox', { name: 'Agregar un comentario al elemento seleccionado' }).waitFor();
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(repo, 'release/packaged-smoke.png') });
  console.log('Language switching, project persistence, sidebar resizing, focus and browser selection passed.');
} finally {
  await app?.close();
  await new Promise(resolve => server.close(resolve));
  console.log(`Isolated test data: ${directory}`);
}
