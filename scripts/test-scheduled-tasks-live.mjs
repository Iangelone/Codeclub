import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';

// Supply a key on stdin or AI_GATEWAY_API_KEY. Never write it to a fixture or report.
let secret = process.env.AI_GATEWAY_API_KEY;
if (!secret) {
  process.stdout.write('Waiting for credential on stdin (not echoed).\n');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  const input = createInterface({ input: process.stdin, terminal: false });
  secret = await new Promise(resolve => input.once('line', value => { input.close(); resolve(value.trim()); }));
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}
assert.ok(secret, 'A Gateway credential is required.');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-live-task-'));
let app, server;
try {
  const response = await fetch('https://ai-gateway.vercel.sh/v1/models');
  assert.ok(response.ok, 'The live Gateway catalog must be available.');
  const catalog = await response.json();
  const candidates = catalog.data.filter(model => model.type === 'language' && model.tags?.includes('tool-use') && model.pricing?.input != null && model.pricing?.output != null && Number(model.pricing.input) === 0 && Number(model.pricing.output) === 0)
    .sort((a, b) => Number(b.created || 0) - Number(a.created || 0) || a.id.localeCompare(b.id));
  assert.ok(candidates.length, 'No free language model with tool support is available. Paid models are never used by this test.');
  const selected = candidates[0];
  console.log(JSON.stringify({ selectedFromLiveCatalog: selected.id, inputPrice: selected.pricing.input, outputPrice: selected.pricing.output }));
  const entry = path.join(directory, 'entry.tsx');
  const bundle = path.join(directory, 'app.js');
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import Runner from ${JSON.stringify(path.join(repo, 'src/components/ScheduledTaskRunner.tsx'))};import {providers,models} from ${JSON.stringify(path.join(repo, 'src/lib/ai-catalog.ts'))};import {credentialKeyFor} from ${JSON.stringify(path.join(repo, 'src/lib/ai-routing.ts'))};window.liveResolve=id=>{const provider=providers.find(item=>item.gateway===true);const model=models.find(item=>item.gatewayId===id);if(!provider||!model)throw new Error('Live model unavailable in application catalog');return {provider:provider.id,model:model.gatewayId,credentialKey:credentialKeyFor(provider,model)}};window.liveReady=true;if(new URLSearchParams(location.search).get('scheduledRunner')==='1')createRoot(document.getElementById('root')).render(<Runner/>);`);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, jsx: 'automatic', format: 'esm', platform: 'browser', target: 'es2022', nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  server = createServer(async (request, response) => {
    if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(await readFile(bundle)); return; }
    response.setHeader('content-type', 'text/html'); response.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(directory, 'profile');
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app,BrowserWindow} from 'electron';app.setName('Codeclub live QA');app.setPath('userData',${JSON.stringify(profile)});for(const method of ['show','showInactive','focus','maximize'])BrowserWindow.prototype[method]=function(){};await import(${JSON.stringify(new URL('../electron-dist/main.js', import.meta.url).href)});`);
  const env = { ...process.env, CODECLUB_NEXT_DEV_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE; delete env.AI_GATEWAY_API_KEY;
  app = await electron.launch({ args: [wrapper], env, timeout: 30000 });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.liveReady, { timeout: 30000 });
  const route = await page.evaluate(id => window.liveResolve(id), selected.id);
  await page.evaluate(async ({ credentialKey, secret }) => window.codeclub.credentialSet(credentialKey, secret, 'https://ai-gateway.vercel.sh'), { credentialKey: route.credentialKey, secret });
  const cipher = await readFile(path.join(profile, 'credentials.encrypted.json'), 'utf8');
  assert.equal(cipher.includes(secret), false, 'The key must be encrypted at rest.');
  secret = undefined;
  const marker = `CODECLUB_LIVE_${randomUUID()}`;
  await writeFile(path.join(directory, 'probe.txt'), marker);
  const task = await page.evaluate(async ({ projectPath, route }) => window.codeclub.tasksSave(projectPath, {
    id: 'live-automatic-probe', name: 'Verificación real de tarea automática',
    prompt: 'Usá las herramientas para leer probe.txt del proyecto. Descubrí readFile con searchTools y ejecutala con executeTool. Para comprobar compatibilidad, pasá input como un string JSON que codifica el objeto {"path":"probe.txt"}. En la respuesta final copiá exactamente el contenido que leíste. No inventes el contenido y no hagas cambios.',
    provider: route.provider, model: route.model, interval: 'Una vez', runAt: new Date(Date.now() + 2000).toISOString(),
    status: 'active', notifications: 'Sin notificaciones', reasoning: 'Bajo', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }), { projectPath: directory, route });
  console.log('Native task saved. Waiting for the automatic Electron clock; no manual run is triggered.');
  const deadline = Date.now() + 120000;
  let result;
  while (Date.now() < deadline) {
    result = (await page.evaluate(project => window.codeclub.tasksList(project), directory)).find(item => item.id === task.id);
    if (result.runs.some(run => !['queued', 'running'].includes(run.status))) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const run = result.runs.at(-1);
  assert.ok(run, 'The automatic clock did not start the task.');
  const history = await page.evaluate(({ project, id }) => window.codeclub.chatAll(project, id), { project: directory, id: run.chatId });
  if (run.status !== 'completed') {
    console.log(JSON.stringify({ passed: false, model: selected.id, status: run.status, error: run.error, result: String(history.at(-1)?.content || '').slice(0, 400) }));
    process.exitCode = 1;
  } else {
    assert.equal(result.runs.length, 1, 'A one-shot task must run exactly once.');
    assert.equal(result.status, 'paused');
    assert.ok(history.some(message => message.role === 'assistant' && message.content.includes(marker)), 'The real model must return the value read from the fixture.');
    assert.ok(history.some(message => message.tools?.some(event => event.name === 'readFile' && JSON.stringify(event.output).includes(marker))), 'The file-reading tool must actually execute.');
    const names = await readdir(path.join(profile, 'projects', encodeURIComponent(directory)));
    const usage = await readFile(path.join(profile, 'projects', encodeURIComponent(directory), 'usage.jsonl'), 'utf8');
    const record = JSON.parse(usage.trim().split('\n').at(-1));
    console.log(JSON.stringify({ passed: true, model: selected.id, providerFromCatalog: route.provider, automaticRun: true, toolReadVerified: true, resultPersisted: true, singleExecution: true, inputTokens: record.inputTokens, outputTokens: record.outputTokens, encryptedCredential: true, artifacts: names.filter(name => name === 'usage.jsonl' || name === 'chats') }));
  }
} catch (error) {
  // SDK/network errors can carry request headers. Print only controlled, key-free diagnostics.
  console.error(error instanceof assert.AssertionError ? error.message : `Live verification failed (${error?.name || 'Error'}).`);
  process.exitCode = 1;
} finally {
  await app?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`) && path.basename(resolved).startsWith('codeclub-live-task-'));
  await rm(resolved, { recursive: true, force: true });
}
