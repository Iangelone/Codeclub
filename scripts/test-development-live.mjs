import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

// Explicit user workspace only; credentials never enter prompts or artifacts.
const project = path.resolve(process.argv[2]);
assert.ok(process.argv[2] && path.isAbsolute(process.argv[2]), 'An absolute test workspace is required');
await readdir(project);
let secret = process.env.AI_GATEWAY_API_KEY;
if (!secret) {
  process.stdout.write('Waiting for credential on stdin (not echoed).\n');
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  const input = createInterface({ input: process.stdin, terminal: false });
  secret = await new Promise(resolve => input.once('line', value => { input.close(); resolve(value.trim()); }));
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}
assert.ok(secret, 'A Gateway credential is required');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-live-development-'));
let app, server;
let history = [], route, selected, cycleComplete = false;
const report = path.join(project, '.codeclub-qa');
try {
  const response = await fetch('https://ai-gateway.vercel.sh/v1/models');
  assert.ok(response.ok);
  const catalog = await response.json();
  const candidates = catalog.data.filter(item => item.type === 'language' && item.tags?.includes('tool-use') && item.pricing?.input != null && item.pricing?.output != null && Number(item.pricing.input) === 0 && Number(item.pricing.output) === 0)
    .sort((a, b) => Number(/coding|software|programming/i.test(b.description || '')) - Number(/coding|software|programming/i.test(a.description || '')) || Number(b.context_window || 0) - Number(a.context_window || 0) || Number(b.created || 0) - Number(a.created || 0) || a.id.localeCompare(b.id));
  selected = candidates[Number(process.env.CODECLUB_FREE_MODEL_INDEX || 0)];
  assert.ok(selected, 'No free model with tools available');
  console.log(JSON.stringify({ modelFromCatalog: selected.id, inputPrice: selected.pricing.input, outputPrice: selected.pricing.output }));
  const entry = path.join(directory, 'entry.tsx'), bundle = path.join(directory, 'app.js');
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import Chat from ${JSON.stringify(path.join(repo, 'src/components/ChatInterface.tsx'))};import {BrowserPanel} from ${JSON.stringify(path.join(repo, 'src/components/WorkspaceLayout.tsx'))};import {providers,models} from ${JSON.stringify(path.join(repo, 'src/lib/ai-catalog.ts'))};import {credentialKeyFor} from ${JSON.stringify(path.join(repo, 'src/lib/ai-routing.ts'))};const root=createRoot(document.getElementById('root')!);window.liveResolve=id=>{const provider=providers.find(p=>p.gateway===true),model=models.find(m=>m.gatewayId===id);if(!provider||!model)throw new Error('Model unavailable');return {provider:provider.id,model:model.gatewayId,credentialKey:credentialKeyFor(provider,model)}};window.liveStart=async(id,project)=>{const {setSetting}=await import(${JSON.stringify(path.join(repo, 'src/lib/persistence.ts'))});const provider={...providers.find(p=>p.gateway===true),type:'provider'},model={...models.find(m=>m.gatewayId===id),type:'model'};await setSetting('codeclub_last_provider_id',provider.id);await setSetting('codeclub_last_model_id',model.gatewayId);root.render(<div style={{height:'100vh',display:'grid',gridTemplateColumns:'680px 1fr',background:'#111'}}><Chat catalog={[...providers.map(p=>({...p,type:'provider'})),...models.map(m=>({...m,type:'model'}))]} defaultProvider={provider} defaultModel={model} selectedProject={{projectPath:project,projectName:'Salieri'}}/><BrowserPanel isolated/></div>)};window.liveReady=true;`);
  await build({ entryPoints: [entry], outfile: bundle, bundle: true, jsx: 'automatic', format: 'esm', platform: 'browser', target: 'es2022', nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' });
  const cssDirectory = path.join(repo, 'out/_next/static/chunks');
  const css = (await Promise.all((await readdir(cssDirectory)).filter(item => item.endsWith('.css')).map(item => readFile(path.join(cssDirectory, item), 'utf8')))).join('\n');
  server = createServer(async (request, response) => {
    if (request.url === '/app.js') { response.setHeader('content-type', 'text/javascript'); response.end(await readFile(bundle)); return; }
    if (request.url === '/style.css') { response.setHeader('content-type', 'text/css'); response.end(css); return; }
    response.setHeader('content-type', 'text/html'); response.end('<link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const profile = path.join(directory, 'profile'), wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app,BrowserWindow} from 'electron';app.setName('Codeclub development QA');app.setPath('userData',${JSON.stringify(profile)});for(const method of ['show','showInactive','focus','maximize'])BrowserWindow.prototype[method]=function(){};await import(${JSON.stringify(new URL('../electron-dist/main.js', import.meta.url).href)});`);
  const env = { ...process.env, CODECLUB_NEXT_DEV_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE; delete env.AI_GATEWAY_API_KEY;
  app = await electron.launch({ args: [wrapper], env, timeout: 30000 });
  const page = await app.firstWindow();
  const errors = []; page.on('pageerror', error => errors.push(error.name));
  page.on('console', message => { if (message.type() === 'error') { const value = message.text(); const category = /CHAT_MESSAGE_TOO_LARGE|CHAT_HISTORY_CONFLICT|context.{0,30}(?:limit|length)|rate.{0,20}limit|429|insufficient.{0,20}(?:credit|quota)|invalid.{0,20}(?:tool|message)|abort|timeout/i.exec(value)?.[0] || value.split('\n')[0].replace(/vck_[A-Za-z0-9]+|Bearer\s+\S+/gi, '[redacted]').slice(0, 180); console.log(JSON.stringify({ rendererErrorCategory: category })); } });
  await page.waitForFunction(() => window.liveReady, { timeout: 30000 });
  route = await page.evaluate(id => window.liveResolve(id), selected.id);
  await page.evaluate(async ({ route, secret }) => window.codeclub.credentialSet(route.credentialKey, secret, 'https://ai-gateway.vercel.sh'), { route, secret });
  assert.equal((await readFile(path.join(profile, 'credentials.encrypted.json'), 'utf8')).includes(secret), false);
  secret = undefined;
  await page.evaluate(({ id, project }) => window.liveStart(id, project), { id: selected.id, project });
  const prompt = process.env.CODECLUB_DEVELOPMENT_PROMPT || `Trabajá de verdad en el proyecto activo Salieri (${project}), una carpeta autorizada para esta prueba. Primero inspeccioná lo existente y preservalo. No leas .codeclub-qa: contiene reportes del evaluador, no código de la web. Si ya existe la web, revisala y corregila: el formulario local no debe prometer una respuesta humana ni envío externo. Creá una web completa y funcional en español para Salieri, un estudio de producción musical: inicio, servicios, proyectos con filtro por categoría y formulario de contacto con validación y confirmación LOCAL (sin enviar datos a terceros). Usá HTML/CSS/JS y Node sin dependencias externas para que sea reproducible. Necesito package.json con scripts test, build y dev, pruebas reales con node:test, servidor local con Node y README con instrucciones. Primero creá un plan persistente; implementá TODOS los archivos con herramientas. Ejecutá npm test y npm run build mediante runCommand en Windows (usá npm.cmd como ejecutable). Arrancá npm run dev en una terminal persistente con la tool terminal y observá snapshot hasta confirmar que está escuchando. Usá openBrowser en la URL localhost del servidor real, getBrowserState y browserAction para probar el filtro y completar/enviar el formulario local; volvé a observar y verificá el cambio de DOM y el mensaje de confirmación. Corregí cualquier fallo y repetí los checks. No inventes éxitos, no contestes solo con código, no pidas permisos para acciones reversibles ya autorizadas dentro de esta carpeta, no toques archivos de Codeclub ni fuera del proyecto, no uses capturas/visión si no hace falta. Marcá el plan completado cuando tests/build y navegador realmente funcionen. La web debe ser responsive, accesible, sin links rotos ni errores de JavaScript. En el resumen final indicá URL y evidencias concretas. Descubrí schemas con searchTools; executeTool requiere argumentos exactos. Para enviar Enter a una terminal usá command al crear, o data con un salto de línea real al escribir.`;
  const input = page.locator('textarea').first(); await input.fill(prompt); await input.press('Enter');
  let lastProgress = '', session, completedTurns = 0;
  const deadline = Date.now() + 25 * 60000;
  while (Date.now() < deadline) {
    session = (await page.evaluate(() => window.codeclub.sessionList())).find(item => item.projectPath === project);
    if (session) {
      for (const approval of session.approvals || []) {
        // Authorization is limited to the explicitly requested software cycle.
        assert.ok(['writeFile', 'runCommand', 'terminal', 'createPlan', 'updatePlan', 'todo', 'openBrowser', 'browserAction'].includes(approval.toolName), `Unexpected effect approval: ${approval.toolName}`);
        await page.evaluate(({ chat, id }) => window.codeclub.sessionCommand(chat, 'approve', id), { chat: { chatId: session.chatId, projectPath: project }, id: approval.id });
      }
      const events = session.messages.flatMap(message => message.tools || []);
      const progress = `${session.state}|${events.length}|${events.at(-1)?.name || ''}`;
      if (progress !== lastProgress) { lastProgress = progress; console.log(JSON.stringify({ state: session.state, toolEvents: events.length, lastTool: events.at(-1)?.name || '' })); }
      if (!session.busy && session.messages.some(message => message.role === 'assistant')) {
        history = await page.evaluate(({ project, id }) => window.codeclub.chatAll(project, id), { project, id: session.chatId });
        const actual = history.flatMap(message => message.tools || []);
        const names = new Set(actual.filter(event => event.output?.ok !== false).map(event => event.name));
        const requirements = ['writeFile', 'runCommand', 'terminal', 'openBrowser', 'getBrowserState', 'browserAction'];
        const missing = requirements.filter(name => !names.has(name));
        const browserActions = actual.filter(event => event.name === 'browserAction' && event.output?.ok === true);
        const successfulChecks = actual.filter(event => event.name === 'runCommand' && event.output?.ok !== false && (event.output?.exit_code === 0 || event.output?.code === 0 || event.output?.success === true));
        const checkedCommands = successfulChecks.map(event => [event.input?.command, ...(event.input?.args || [])].join(' '));
        const testsPassed = checkedCommands.some(command => /\b(?:npm(?:\.cmd)?\s+(?:run\s+)?test|node\s+--test)\b/i.test(command));
        const buildPassed = checkedCommands.some(command => /\b(?:npm(?:\.cmd)?\s+run\s+build|node\s+build\.[cm]?js)\b/i.test(command));
        const contactConfirmed = actual.some(event => ['getBrowserState', 'browserAction'].includes(event.name) && event.output?.ok === true && event.output?.state?.ok === true && event.output?.state?.elements?.some(element => element.tag === 'button' && /enviar otro mensaje/i.test(element.text || '')));
        const planCompleted = actual.some(event => event.name === 'updatePlan' && event.output?.status === 'completed');
        await mkdir(report, { recursive: true });
        await writeFile(path.join(report, 'chat.json'), JSON.stringify(history, null, 2));
        const auditPath = path.join(profile, 'projects', encodeURIComponent(project), 'execution.jsonl');
        const audit = await readFile(auditPath, 'utf8').catch(() => '');
        await writeFile(path.join(report, 'execution.jsonl'), audit);
        console.log(JSON.stringify({ turn: completedTurns, final: String(history.at(-1)?.content || '').slice(-700), missing, browserActions: browserActions.length, successfulChecks: successfulChecks.length }));
        if (!missing.length && browserActions.length >= 3 && testsPassed && buildPassed && contactConfirmed && planCompleted) { cycleComplete = true; break; }
        completedTurns++;
        if (completedTurns >= 6) throw new Error('Development requirements incomplete');
        if (session.state === 'error') { console.log(JSON.stringify({ waitingForGatewayRecovery: true })); await new Promise(resolve => setTimeout(resolve, 60000)); }
        await input.fill(`Continuá el mismo proyecto hasta terminar el ciclo solicitado. Requisitos aún sin evidencia: ${missing.join(', ') || 'confirmación del formulario enviado y plan completado'}. Hay ${browserActions.length} acciones del navegador y ${successfulChecks.length} checks exitosos. Tests: ${testsPassed}; build: ${buildPassed}; envío confirmado: ${contactConfirmed}; plan terminado: ${planCompleted}. No alcanza con completar campos: enviá el formulario y verificá que aparezca la confirmación y el botón para enviar otro mensaje. Inspeccioná el estado fresco antes de actuar, usá valores reales de options en select, corregí fallos y completá el plan al final. No repitas a ciegas efectos ya ejecutados.`); await input.press('Enter');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(cycleComplete && session && !session.busy, 'The development cycle timed out or has incomplete evidence');
  const events = history.flatMap(message => message.tools || []);
  assert.deepEqual(errors, [], 'Renderer errors occurred');
  await writeFile(path.join(report, 'result.json'), JSON.stringify({ agentCycleComplete: true, model: selected.id, prices: selected.pricing, provider: route.provider, project, tools: [...new Set(events.map(event => event.name))], pageErrors: errors, completedAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ agentCycleComplete: true, project, model: selected.id, report }));
} catch (error) {
  await mkdir(report, { recursive: true });
  await writeFile(path.join(report, 'result.json'), JSON.stringify({ agentCycleComplete: false, model: selected?.id, project, failedAt: new Date().toISOString() }, null, 2));
  console.error(error instanceof assert.AssertionError ? error.message : `Development verification failed (${error?.name || 'Error'}).`);
  process.exitCode = 1;
} finally {
  await app?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`) && path.basename(resolved).startsWith('codeclub-live-development-'));
  await rm(resolved, { recursive: true, force: true });
}
