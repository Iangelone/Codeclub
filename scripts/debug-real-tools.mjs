import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Actual renderer definitions and Electron IPC, without a provider or mocked native results.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-tool-debug-'));
const project = path.join(directory, 'project');
let application;
let terminalId;
let page;
let server;
const results = [];
try {
  await mkdir(path.join(project, 'diseño'), { recursive: true });
  await writeFile(path.join(project, 'diseño', 'archivo.txt'), 'Codeclub Unicode fixture\n');
  const bundle = await build({
    stdin: { contents: `import {createTools,createDynamicToolAccess} from './src/lib/engine/tools';
      import {adaptLangChainTools} from './src/lib/engine/run';
      window.setupTools=async projectPath=>{
        const base=createTools({projectPath,projectScoped:true,chatId:'debug-tools',recordToolEvent:()=>{},setAgentState:()=>{},requestToolApproval:async()=>false});
        window.debugTools=await adaptLangChainTools(createDynamicToolAccess(base));
      };`, resolveDir: root, loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'iife', logLevel: 'silent',
  });
  const source = bundle.outputFiles[0].text;
  server = createServer((request, response) => {
    response.setHeader('content-type', request.url === '/tools.js' ? 'text/javascript' : 'text/html');
    response.end(request.url === '/tools.js' ? source : '<title>Codeclub tool debug</title><script src="/tools.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app,BrowserWindow} from 'electron';
    app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});
    for(const method of ['show','showInactive','focus','maximize'])BrowserWindow.prototype[method]=function(){};
    await import(${JSON.stringify(new URL('../electron-dist/main.js', import.meta.url).href)});`);
  const env = { ...process.env, CODECLUB_NEXT_DEV_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE;
  application = await electron.launch({ args: [wrapper], env, timeout: 30000 });
  page = await application.firstWindow();
  await page.waitForFunction(() => window.codeclub?.invoke && window.setupTools);
  await page.evaluate(projectPath => window.setupTools(projectPath), project);
  const execute = (name, input = {}) => page.evaluate(async ({ name, input }) => {
    return window.debugTools.executeTool.execute({ name, input }, { toolCallId: crypto.randomUUID(), messages: [] });
  }, { name, input });
  const record = (name, detail) => { results.push({ name, ...detail }); console.log(JSON.stringify(results.at(-1))); };
  const discovered = await page.evaluate(() => window.debugTools.searchTools.execute({ query: 'terminal browser readFile', pageSize: 20 }, {}));
  record('searchTools', { count: discovered.tools.length, schemas: discovered.tools.every(tool => tool.schema?.type === 'object') });
  const read = await execute('readFile', { path: 'diseño/archivo.txt' });
  assert.equal(read.ok, true); assert.match(JSON.stringify(read.result), /Unicode fixture/);
  record('readFile', { ok: read.ok, unicodePath: true });
  const missing = await execute('readFile', { path: 'missing.txt' });
  assert.equal(missing.ok, false); assert.match(missing.result.error, /ENOENT/);
  record('readFile missing', { ok: missing.ok, errorPreserved: true });
  const finite = await execute('runCommand', { command: process.execPath, args: ['-e', 'console.log("FINITE_OK")'] });
  assert.equal(finite.ok, true); assert.match(finite.result.stdout, /FINITE_OK/);
  record('runCommand', { ok: finite.ok, code: finite.result.code });
  const browsers = await execute('externalBrowserList');
  record('externalBrowserList', { ok: browsers.ok, browsers: browsers.result.browsers.length, isolatedInstance: true });
  const terminal = await execute('terminal', { action: 'create', shell: 'powershell', command: 'Write-Output "TERMINAL_INITIAL"', name: 'Tool debug' });
  assert.equal(terminal.ok, true); terminalId = terminal.result.id;
  const readUntil = async marker => {
    let text = '';
    for (let attempt = 0; attempt < 40; attempt++) {
      const result = await execute('terminal', { action: 'snapshot', id: terminalId });
      assert.equal(result.ok, true); text += result.result.output;
      if (text.includes(marker)) return text;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`Terminal output did not contain ${marker}`);
  };
  await readUntil('TERMINAL_INITIAL');
  await execute('terminal', { action: 'write', id: terminalId, command: 'Write-Output ("EXECUTED_" + (6 * 7))' });
  await readUntil('EXECUTED_42');
  const incremental = await execute('terminal', { action: 'snapshot', id: terminalId });
  assert(!incremental.result.output.includes('TERMINAL_INITIAL'));
  const full = await execute('terminal', { action: 'snapshot', id: terminalId, full: true });
  assert.match(full.result.output, /TERMINAL_INITIAL/);
  assert(!full.result.output.includes('\x1b['));
  record('terminal', { commandSubmitted: true, incremental: true, fullReread: true, vtStripped: true, fullBytes: Buffer.byteLength(full.result.output) });
  console.log('Real renderer → preload → Electron debugging passed. No provider calls.');
} finally {
  if (page && terminalId) await page.evaluate(id => window.codeclub.invoke('codeclub_terminal_delete', { id }), terminalId).catch(() => {});
  await application?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert(path.basename(resolved).startsWith('codeclub-tool-debug-'));
  await rm(resolved, { recursive: true, force: true });
}
