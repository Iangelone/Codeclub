import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { TaskScheduler } from '../electron-dist/task-scheduler.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-tasks-ui-'));
const files = new Map([['/qa/settings.json', JSON.stringify({ codeclub_last_provider_id: 'qa', codeclub_last_model_id: 'qa-model' })]]);
const requests = [], messages = [], errors = [], writes = [], scopes = [], vaultWrites = [];
let browser, server, scenario = 'read', finish, runner;
const catalog = `export const providers=[{id:'qa',label:'QA',api:location.origin+'/v1',requiresApiKey:true}];export const models=[{id:'qa-model',label:'QA model',providerId:'qa',contextWindow:32768,reasoning:true}];`;
const task = { id: 'test', name: 'QA task', prompt: 'Inspect sample.txt', projectPath: 'C:\\qa-project', provider: 'qa', model: 'qa-model', interval: 'Diario', every: '30 min', time: '08:00', timeZone: 'America/Argentina/Buenos_Aires', weekday: 1, status: 'active', notifications: 'Sin notificaciones', reasoning: 'Alto', runs: [] };
const assignment = { task, run: { id: 'qa-run', chatId: 'scheduled-qa', status: 'running', startedAt: new Date().toISOString() } };
try {
  await writeFile(path.join(directory, 'runner.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import Runner from ${JSON.stringify(path.join(repo, 'src/components/ScheduledTaskRunner.tsx'))};createRoot(document.getElementById('root')).render(<Runner/>);`);
  await writeFile(path.join(directory, 'ui.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import {ScheduledPanel} from ${JSON.stringify(path.join(repo, 'src/components/WorkspaceLayout.tsx'))};const root=createRoot(document.getElementById('root'));window.switchQAProject=path=>root.render(<ScheduledPanel projectPath={path}/>);window.switchQAProject('');`);
  for (const entry of ['runner', 'ui']) await build({ entryPoints: [path.join(directory, `${entry}.tsx`)], outfile: path.join(directory, `${entry}.js`), bundle: true, format: 'esm', platform: 'browser', target: 'es2022', nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent', plugins: [{ name: 'qa-catalog', setup(build) { build.onResolve({ filter: /ai-catalog$/ }, () => ({ path: 'qa-catalog', namespace: 'qa' })); build.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: catalog, loader: 'js' })); } }] });
  server = createServer(async (request, response) => {
    if (request.url.endsWith('.js')) { response.setHeader('content-type', 'text/javascript'); response.end(await readFile(path.join(directory, request.url.slice(1)))); return; }
    if (request.url === '/v1/chat/completions') {
      let body = ''; for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body); requests.push(payload);
      if (scenario === 'http-error') { response.statusCode = 401; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ error: { message: 'QA provider rejected request' } })); return; }
      if (scenario === 'cancel') { await new Promise(resolve => setTimeout(resolve, 500)); }
      response.setHeader('content-type', 'text/event-stream');
      const send = (delta, finishReason = null) => response.write(`data: ${JSON.stringify({ id: 'qa', object: 'chat.completion.chunk', created: 1, model: 'qa-model', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
      if (scenario === 'browser' && payload.messages.filter(message => message.role === 'tool').length < 2) {
        const input = payload.messages.some(message => message.role === 'tool') ? { name: 'getBrowserState', input: {} } : { name: 'openBrowser', input: { url: `http://127.0.0.1:${server.address().port}/browser-fixture` } };
        send({ role: 'assistant', tool_calls: [{ index: 0, id: `call-${payload.messages.length}`, type: 'function', function: { name: 'executeTool', arguments: JSON.stringify(input) } }] }); send({}, 'tool_calls');
      } else if (!payload.messages.some(message => message.role === 'tool') && ['read', 'deny', 'approve'].includes(scenario)) {
        const input = scenario === 'read' ? { name: 'readFile', input: { path: 'sample.txt' } } : { name: 'writeFile', input: { path: 'sample.txt', content: 'changed' } };
        send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'executeTool', arguments: JSON.stringify(input) } }] }); send({}, 'tool_calls');
      } else { send({ role: 'assistant', content: 'QA task completed.' }); send({}, 'stop'); }
      response.end('data: [DONE]\n\n'); return;
    }
    response.setHeader('content-type', 'text/html'); response.end(`<div id="root"></div><script type="module" src="/${request.url === '/ui' ? 'ui' : 'runner'}.js"></script>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const common = async (method, args) => {
    if (method === 'appConfigDir') return '/qa';
    if (method === 'joinPath') return args.join('/');
    if (method === 'makeDirectory') return true;
    if (method === 'fileExists') return files.has(args[0]);
    if (method === 'readTextFile') return files.get(args[0]) || '';
    if (method === 'writeTextFile') { files.set(args[0], args[1]); return true; }
    if (method === 'credentialPresent') return scenario !== 'missing-key';
    if (method === 'credentialSet') { vaultWrites.push(args); return true; }
    if (method === 'listProjects') return [];
    return null;
  };
  const bootstrap = () => {
    const api = {}; for (const method of ['taskAssignment', 'taskFinish', 'sessionClaim', 'sessionPublish', 'chatAppend', 'credentialPresent', 'credentialSet', 'appConfigDir', 'joinPath', 'makeDirectory', 'fileExists', 'readTextFile', 'writeTextFile', 'invoke', 'listProjects', 'tasksList', 'tasksSave', 'tasksRun', 'tasksDelete', 'tasksCancel', 'sessionOpen']) api[method] = (...args) => window.qaBridge(method, args);
    api.onSessionCommand = handler => { window.qaCommand = handler; return () => { window.qaCommand = null; }; };
    api.onTasksChanged = handler => { window.qaTasksChanged = handler; return () => { window.qaTasksChanged = null; }; };
    window.codeclub = api;
    Element.prototype.executeJavaScript = async function () { return { ok: true, url: this.getAttribute('src'), title: 'Fixture browser', text: 'Fixture content', elements: [] }; };
    Element.prototype.getURL = function () { return this.getAttribute('src'); };
    Element.prototype.getTitle = () => 'Fixture browser';
  };
  for (scenario of ['read', 'missing-key', 'deny', 'approve', 'browser', 'cancel', 'http-error']) {
    requests.length = 0; messages.length = 0; writes.length = 0;
    runner = await browser.newPage(); runner.on('pageerror', error => errors.push(error.message));
    const finished = new Promise(resolve => { finish = resolve; });
    await runner.exposeFunction('qaBridge', async (method, args) => {
      if (method === 'taskAssignment') return assignment;
      if (method === 'taskFinish') { finish(args[0]); return; }
      if (method === 'sessionClaim') return 'session-run';
      if (method === 'sessionPublish') {
        const approval = args[2].approvals?.[0];
        if (approval) void runner.evaluate(command => window.qaCommand?.(command), { runId: 'session-run', chat: { chatId: 'scheduled-qa' }, action: ['approve', 'browser'].includes(scenario) ? 'approve' : 'deny', approvalId: approval.id });
        if (scenario === 'cancel' && args[2].state === 'working') void runner.evaluate(() => window.qaCommand?.({ runId: 'session-run', chat: { chatId: 'scheduled-qa' }, action: 'cancel' }));
        return true;
      }
      if (method === 'chatAppend') { messages.push(args); return messages.length; }
      if (method === 'invoke') {
        const [command, data] = args;
        if (command === 'codeclub_http_fetch') {
          assert.equal(data.request.credentialKey, 'qa_api_key');
          assert.ok(data.request.url.startsWith(origin));
          const response = await fetch(data.request.url, { method: data.request.method, headers: Object.fromEntries(data.request.headers.map(item => [item.name, item.value])), body: data.request.body });
          return { body: await response.text(), status: response.status, status_text: response.statusText, headers: [...response.headers].map(([name, value]) => ({ name, value })) };
        }
        if (command === 'codeclub_read_file') { assert.equal(data.projectPath, task.projectPath); return data.path === 'AGENTS.md' ? 'Use this project only.' : 'QA file content'; }
        if (command === 'codeclub_write_file') { writes.push(data); return true; }
        if (command === 'codeclub_list_agent_plugins') return [];
        if (command === 'codeclub_http_abort') return;
        throw new Error(`Unexpected native command: ${command}`);
      }
      return common(method, args);
    });
    await runner.addInitScript(bootstrap); await runner.goto(origin);
    let deadline;
    const outcome = await Promise.race([finished, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error(`Runner timed out: ${scenario}`)), 15000); })]).finally(() => clearTimeout(deadline));
    if (['read', 'approve', 'browser'].includes(scenario)) {
      assert.equal(outcome, undefined);
      assert.equal(requests.length, scenario === 'browser' ? 3 : 2);
      assert.equal(requests[0].model, 'qa-model'); assert.equal(requests[0].reasoning_effort, 'high');
      assert.equal(messages.at(-1)[2].content, 'QA task completed.');
      assert.ok(requests[1].messages.some(message => message.role === 'tool'));
      assert.equal(writes.length, scenario === 'approve' ? 1 : 0);
      if (scenario === 'browser') assert.ok(JSON.stringify(requests.at(-1).messages).includes('Fixture browser'));
    } else { assert.equal(outcome, ({ 'missing-key': 'TASK_CREDENTIAL_MISSING', deny: 'TASK_APPROVAL_REQUIRED', cancel: 'TASK_CANCELLED', 'http-error': 'TASK_EXECUTION_FAILED' })[scenario]); assert.equal(writes.length, 0); }
    assert.ok(messages.every(args => args[0] === task.projectPath && args[1] === 'scheduled-qa'));
    await runner.close();
  }
  const ui = await browser.newPage(); ui.on('pageerror', error => errors.push(error.message));
  const scheduler = new TaskScheduler(path.join(directory, 'ui-tasks.json'), async () => {}, () => { void ui.evaluate(() => window.qaTasksChanged?.()); });
  files.set('/qa/projects/global/scheduled-tasks.json', JSON.stringify([{ ...task, id: 'legacy', name: 'Legacy task', projectPath: '', apiKey: 'legacy-fixture-secret' }]));
  await ui.exposeFunction('qaBridge', async (method, args) => {
    if (method === 'tasksList') { scopes.push(args[0]); return scheduler.list(args[0]); }
    if (method === 'tasksSave') return scheduler.save(...args);
    if (method === 'tasksDelete') return scheduler.remove(...args);
    if (method === 'tasksRun') return scheduler.run(...args);
    if (method === 'sessionOpen') return true;
    return common(method, args);
  });
  await ui.addInitScript(bootstrap); await ui.goto(`${origin}/ui`);
  await ui.getByText('Legacy task', { exact: true }).waitFor();
  assert.ok(vaultWrites.some(args => args[0] === 'qa_api_key' && args[1] === 'legacy-fixture-secret'));
  assert.equal(files.get('/qa/projects/global/scheduled-tasks.json').includes('legacy-fixture-secret'), false);
  assert.equal((await readFile(path.join(directory, 'ui-tasks.json'), 'utf8')).includes('legacy-fixture-secret'), false);
  scheduler.remove('', 'legacy');
  await ui.getByText('No hay tareas programadas.', { exact: true }).waitFor();
  await ui.getByLabel('Crear tarea personalizada').click();
  await ui.getByLabel('Nombre de la tarea').fill('UI task');
  await ui.getByLabel('Instrucción de la tarea').fill('Inspect the current project');
  await ui.getByLabel('Guardar tarea', { exact: true }).click();
  await ui.getByText('UI task', { exact: true }).waitFor();
  assert.equal(scheduler.list('')[0].provider, 'qa'); assert.equal(scheduler.list('')[0].model, 'qa-model');
  await ui.getByText('UI task', { exact: true }).click();
  await ui.getByLabel('Ejecutar ahora').click();
  await ui.getByText('Completada ·', { exact: false }).waitFor();
  await ui.getByLabel('Pausar').click();
  await ui.getByText('UI task', { exact: true }).waitFor(); assert.equal(scheduler.list('')[0].status, 'paused');
  await ui.evaluate(() => { localStorage.setItem('codeclub-language', 'en'); window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language: 'en' } })); });
  await ui.getByRole('heading', { name: 'Tasks', exact: true }).waitFor();
  await ui.evaluate(() => window.switchQAProject('C:\\other'));
  await ui.getByText('No scheduled tasks.', { exact: true }).waitFor(); assert.equal(scheduler.list('C:\\other').length, 0);
  await ui.evaluate(() => window.switchQAProject(''));
  await ui.getByText('UI task', { exact: true }).click();
  await ui.getByLabel('Delete', { exact: true }).click();
  await ui.getByText('No scheduled tasks.', { exact: true }).waitFor(); assert.equal(scheduler.list('').length, 0);
  scheduler.stop();
  assert.deepEqual(errors, []); assert.ok(scopes.includes('C:\\other'));
  console.log('Tasks: real SDK + mock provider, model/reasoning/credential routing, tools, approvals, cancellation, errors, result persistence, UI create/run/pause/delete, language and project switching passed.');
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
