/** Exercise the actual orb-scoped tools and Electron WebView without a model or mocked browser. */
import assert from 'node:assert/strict';
import { _electron as electron, expect } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-orb-browser-'));
const id = randomUUID(), chatId = `orb-chat-${id}`, message = randomUUID();
let instance, submitted;
const server = createServer(async (request, response) => {
  if (request.url === '/result') {
    let body = ''; for await (const chunk of request) body += chunk;
    submitted = body; response.end('ok'); return;
  }
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(request.url === '/second'
    ? '<title>Second page</title><h1>Second page verified</h1><a href="/">Back</a>'
    : '<title>Orb browser fixture</title><label>Verification message<input></label><button>Apply message</button><p role="status">Waiting</p><a href="/second">Second page</a><script>document.querySelector("button").onclick=()=>{const value=document.querySelector("input").value;document.querySelector("p").textContent="Applied: "+value;fetch("/result",{method:"POST",body:value})}</script>');
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app} from 'electron';app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});await import(${JSON.stringify(new URL('../electron-dist/main.js', import.meta.url).href)});`);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE; delete env.CODECLUB_NEXT_DEV_URL;
  instance = await electron.launch({ args: [wrapper], env });
  const page = await instance.firstWindow();
  await page.waitForFunction(() => window.codeclub?.settingsSet);
  await page.evaluate(async ({ id, chatId }) => {
    await window.codeclub.settingsSet('codeclub_orbs', [{ id, chatId, name: 'Browser verification orb', purpose: '', color: 'blue', providerId: '', modelId: '', allowComputer: true, maximumAutonomy: true }]);
    window.dispatchEvent(new Event('codeclub:orbs-changed'));
  }, { id, chatId });
  await page.getByRole('button', { name: /^(Your orb|Tu orbe)$/ }).click();
  await page.getByRole('region', { name: /^(Orb panel|Panel del orbe)$/ }).waitFor();
  const bundle = await build({ entryPoints: ['src/lib/engine/tools.ts'], bundle: true, platform: 'browser', format: 'iife', globalName: 'OrbBrowserTools', write: false, define: { 'process.env.NODE_ENV': '"production"' } });
  const installTools = async () => {
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(chatId => { window.qaBrowserTools = OrbBrowserTools.createTools({ projectPath: '', chatId, recordToolEvent: () => {}, setAgentState: () => {}, requestToolApproval: async () => true }); }, chatId);
  };
  await installTools();
  const call = (name, input = {}) => page.evaluate(({ name, input }) => window.qaBrowserTools[name].execute(input), { name, input });
  assert.equal((await call('openBrowser', { url: `http://127.0.0.1:${server.address().port}/` })).ok, true);
  let observed;
  await expect.poll(async () => { observed = await call('getBrowserState'); return observed.state?.title; }, { timeout: 20000 }).toBe('Orb browser fixture');
  const act = async (type, predicate, extra = {}) => {
    const element = observed.state.elements.find(predicate);
    assert.ok(element, JSON.stringify(observed));
    const result = await call('browserAction', { type, selector: element.selector, ...extra });
    assert.equal(result.ok, true, JSON.stringify(result));
    observed = { state: result.state }; return result.state;
  };
  await act('type', element => element.tag === 'input', { text: message });
  const applied = await act('click', element => element.text === 'Apply message');
  assert.ok(applied.text.includes(`Applied: ${message}`));
  await expect.poll(() => submitted).toBe(message);
  await act('click', element => element.text === 'Second page');
  await expect.poll(async () => { observed = await call('getBrowserState'); return observed.state?.title; }).toBe('Second page');
  await act('click', element => element.text === 'Back');
  await expect.poll(async () => { observed = await call('getBrowserState'); return observed.state?.title; }).toBe('Orb browser fixture');
  assert.equal((await call('openBrowser', { url: `http://127.0.0.1:${server.address().port}/second` })).ok, true);
  await expect.poll(async () => { observed = await call('getBrowserState'); return observed.state?.title; }).toBe('Second page');
  await act('click', element => element.text === 'Back');
  await expect.poll(async () => { observed = await call('getBrowserState'); return observed.state?.title; }).toBe('Orb browser fixture');
  assert.equal((await call('openBrowser', { url: `http://127.0.0.1:${server.address().port}/second` })).ok, true);
  await expect.poll(async () => { observed = await call('getBrowserState'); return observed.state?.title; }).toBe('Second page');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('codeclub:right-chat-views'))).toContain(chatId);
  await page.reload();
  await page.getByRole('button', { name: /^(Your orb|Tu orbe)$/ }).click();
  await installTools();
  await expect.poll(async () => { observed = await call('getBrowserState'); return observed.state?.title; }).toBe('Second page');
  console.log('PASS: real orb-scoped tools, Electron WebView, observed selectors, typing, server-confirmed click, navigation and back. No model requests or browser mocks.');
} finally {
  await instance?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.ok(path.basename(directory).startsWith('codeclub-orb-browser-'));
  await rm(directory, { recursive: true, force: true });
}
