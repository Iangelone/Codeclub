/** Real orb UI and SDK execution against temporary stores and a local mock provider. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { build } from 'esbuild';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-orb-chat-'));
const settings = { codeclub_last_provider_id: 'ordinary', codeclub_last_model_id: 'ordinary-model' };
const histories = new Map(), files = new Map(), requests = [], errors = [], published = [], nativeCommands = [];
let browser, server, assignment, finish, responseText = '¿Querés que revisemos los próximos pasos del proyecto?';
let androidPinSaved = false;
let pairingVersion=0, pairingReady=false, pairingFailure=false;
const component = name => JSON.stringify(path.join(repo, `src/components/${name}.tsx`));
try {
  await writeFile(path.join(directory, 'ui.tsx'), `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import OrbsPanel from ${component('OrbsPanel')};import OrbSidebar from ${component('OrbSidebar')};import OrbPaletteProvider from ${component('OrbPaletteProvider')};function App(){const [id,setId]=useState();const orb=window.qaOrbs?.find(o=>o.id===id);return <OrbPaletteProvider><div style={{display:'flex',height:650}}><div style={{width:720}}><OrbsPanel workspaceMode createMode={!id} selectedOrbId={id} onCreated={setId}/></div><div style={{width:260}}><OrbSidebar orb={orb} onNew={()=>setId(undefined)}/></div></div></OrbPaletteProvider>};createRoot(document.getElementById('root')).render(<App/>);`);
  await writeFile(path.join(directory, 'runner.tsx'), `import React from 'react';import {createRoot} from 'react-dom/client';import Runner from ${component('ScheduledTaskRunner')};import OrbPaletteProvider from ${component('OrbPaletteProvider')};createRoot(document.getElementById('root')).render(<OrbPaletteProvider><Runner/></OrbPaletteProvider>);`);
  for (const name of ['ui', 'runner']) await build({ entryPoints: [path.join(directory, `${name}.tsx`)], outfile: path.join(directory, `${name}.js`), bundle: true, jsx: 'automatic', format: 'esm', platform: 'browser', nodePaths: [path.join(repo, 'node_modules')], define: { 'process.env.NODE_ENV': process.env.CODECLUB_QA_DEVELOPMENT ? '"development"' : '"production"' }, logLevel: 'silent', plugins: [{ name: 'catalog', setup(builder) { builder.onResolve({ filter: /ai-catalog$/ }, () => ({ path: 'catalog', namespace: 'qa' })); builder.onLoad({ filter: /.*/, namespace: 'qa' }, () => ({ contents: `export const providers=[{id:'qa',label:'QA provider',api:location.origin+'/v1',requiresApiKey:true}];export const models=[{id:'qa-model',label:'QA model',providerId:'qa',contextWindow:32768}];`, loader: 'js' })); } }] });
  const cssRoot = path.join(repo, 'out/_next/static/chunks');
  const css = (await Promise.all((await readdir(cssRoot)).filter(file => file.endsWith('.css')).map(file => readFile(path.join(cssRoot, file), 'utf8')))).join('\n');
  server = createServer(async (request, response) => {
    if (request.url.endsWith('.js')) { response.setHeader('content-type', 'text/javascript'); response.end(await readFile(path.join(directory, request.url.slice(1)))); return; }
    if (request.url === '/style.css') { response.setHeader('content-type', 'text/css'); response.end(css); return; }
    if (request.url === '/v1/chat/completions') {
      let body = ''; for await (const chunk of request) body += chunk; requests.push(JSON.parse(body));
      if (responseText === 'ERROR') { response.statusCode = 401; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ error: { message: 'Mock provider error' } })); return; }
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ id: 'qa', object: 'chat.completion', model: 'qa-model', choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: responseText === 'UPCOMING_SILENCE' ? 'NO_SUGGESTION' : responseText } }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })); return;
    }
    response.end(`<html lang="en"><head><link rel="stylesheet" href="/style.css"></head><body style="margin:0;background:#161616"><div id="root"></div><script type="module" src="/${request.url === '/runner' ? 'runner' : 'ui'}.js"></script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const bridge = async (method, args) => {
    if (method === 'settingsGet') return settings[args[0]] ?? args[1];
    if (method === 'settingsSet') { settings[args[0]] = args[1]; return; }
    if (method === 'chatSaveTail') { histories.set(args[1], args[3]); return; }
    if (method === 'chatAll') return histories.get(args[1]) || [];
    if (method === 'chatPage' || method === 'chatTurns') { const messages = histories.get(args[1]) || []; return { messages, start: 0, total: messages.length }; }
    if (method === 'chatAppend') { const messages = histories.get(args[1]) || []; messages.push(args[2]); histories.set(args[1], messages); return messages.length; }
    if (method === 'credentialPresent') return true;
    if (method === 'credentialSet') return true;
    if (['listProjects', 'tasksList', 'sessionList', 'globalChatsList'].includes(method)) return [];
    if (method === 'taskAssignment') return assignment;
    if (method === 'taskFinish') { finish(args[0]); return; }
    if (method === 'sessionClaim') return 'qa-session';
    if (method === 'sessionPublish') { published.push(args[2]); return true; }
    if (method === 'appConfigDir' || method === 'appCacheDir') return '/qa';
    if (method === 'joinPath') return args.join('/');
    if (method === 'fileExists') return files.has(args[0]);
    if (method === 'readTextFile') return files.get(args[0]) || '';
    if (method === 'writeTextFile') { files.set(args[0], args[1]); return; }
    if (method === 'invoke') {
      const [command, data] = args; nativeCommands.push(command);
      if(command==='codeclub_android_pairing_create'){if(pairingFailure)throw new Error('Network unavailable');return {pairId:`fixture-${++pairingVersion}`,expiresAt:Date.now()+180000,code:'CC1.fixture',qr:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII='};}
      if(command==='codeclub_android_pairing_status')return {devices:[],paired:pairingReady};
      if(command==='codeclub_android_pairing_cancel')return {ok:true};
      if (command === 'codeclub_android_list_devices') return {ok:true,devices:[{deviceId:'qa-android',state:'device'}]};
      if (command === 'codeclub_android_pin_status') return {saved:androidPinSaved};
      if (command === 'codeclub_android_pin_save') { assert.equal(data.request.deviceId, 'qa-android'); androidPinSaved=Boolean(data.request.pin); return {saved:androidPinSaved}; }
      if (command === 'codeclub_admin_status') return { elevated: false, computerName: 'QA computer' };
      if (command === 'codeclub_browser_extension_info') return { browsers: [] };
      if (command === 'codeclub_list_agent_plugins') return [];
      if (command === 'codeclub_orb_proactive_result') return data.message.trim() !== 'NO_SUGGESTION';
      if (command === 'codeclub_http_fetch') { assert.equal(data.request.credentialKey, 'qa_api_key'); assert.ok(data.request.url.startsWith(origin)); const result = await fetch(data.request.url, { method: data.request.method, headers: Object.fromEntries(data.request.headers.map(item => [item.name, item.value])), body: data.request.body }); return { status: result.status, status_text: result.statusText, body: await result.text(), headers: [...result.headers].map(([name, value]) => ({ name, value })) }; }
      if (command === 'codeclub_http_abort') return;
      throw new Error(`Unexpected native command: ${command}`);
    }
    return null;
  };
  const prepare = async page => {
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); }); await page.exposeFunction('qaBridge', bridge);
    await page.addInitScript(() => {
      localStorage.setItem('codeclub-language', 'en');
      const api = {}; for (const method of ['settingsGet', 'settingsSet', 'chatSaveTail', 'chatAll', 'chatPage', 'chatTurns', 'chatAppend', 'credentialPresent', 'credentialSet', 'listProjects', 'tasksList', 'sessionList', 'globalChatsList', 'taskAssignment', 'taskFinish', 'sessionClaim', 'sessionPublish', 'appConfigDir', 'appCacheDir', 'joinPath', 'fileExists', 'readTextFile', 'writeTextFile', 'invoke', 'globalChatUpsert', 'sessionSelect', 'makeDirectory', 'appendTextFile']) api[method] = (...args) => window.qaBridge(method, args);
      const original = api.settingsSet; api.settingsSet = async (key, value) => { if (key === 'codeclub_orbs') window.qaOrbs = value; return original(key, value); };
      for (const name of ['onSettingsChanged', 'onTasksChanged', 'onSessions', 'onSessionCommand']) api[name] = () => () => {};
      const sessionListeners = []; api.onSessions = listener => { sessionListeners.push(listener); return () => { const index = sessionListeners.indexOf(listener); if (index >= 0) sessionListeners.splice(index, 1); }; }; window.qaSessions = items => sessionListeners.forEach(listener => listener(items));
      window.codeclub = api;
    });
  };
  const ui = await browser.newPage({ viewport: { width: 1100, height: 800 }, reducedMotion: 'reduce' }); await prepare(ui); await ui.goto(origin);
  await expect(ui.getByRole('switch')).toHaveCount(1);
  await ui.getByRole('switch').first().click();
  await ui.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(ui.getByRole('log')).toContainText('Hi, I’m your orb.');
  await expect(ui.getByRole('dialog')).toHaveCount(0);
  await ui.evaluate(() => window.dispatchEvent(new CustomEvent('codeclub:toggle-slash-menu')));
  await expect(ui.getByRole('option').first()).toBeVisible();
  for (const label of ['Provider', 'Model', 'Credential']) await expect(ui.getByRole('option').filter({ hasText: new RegExp(`^${label}`) })).toHaveCount(0);
  if (process.env.CODECLUB_QA_DEVELOPMENT) {
    await ui.getByRole('option').filter({ hasText: /^Development/ }).click();
    await expect(ui.getByRole('option').filter({ hasText: /^Test: list files/ })).toBeVisible();
    await ui.getByRole('option').filter({ hasText: /^Test: list files/ }).click();
    await expect(ui.locator('textarea').first()).toHaveValue(/Respond in English/);
    await ui.locator('textarea').first().fill('');
  } else await ui.evaluate(() => window.dispatchEvent(new CustomEvent('codeclub:toggle-slash-menu')));
  const orb = settings.codeclub_orbs[0]; assert.equal(orb.maximumAutonomy, true); assert.equal(orb.allowComputer, true);
  for (const devices of [[], [{ state: 'unauthorized' }]]) {
    await ui.evaluate(({ chatId, devices }) => window.qaSessions([{ chatId, projectPath: '', busy: false, messages: [{ role: 'assistant', tools: [{ name: 'executeTool', input: { name: 'androidListDevices' }, output: { ok: true, result: { ok: true, devices } } }] }] }]), { chatId: orb.chatId, devices });
    await expect(ui.getByText('Android', { exact: true })).toHaveCount(0);
  }
  await ui.evaluate(chatId => window.qaSessions([{ chatId, projectPath: '', busy: false, state: 'question', approvals: [], messages: [{ role: 'assistant', tools: [{ id: 'qa-request', name: 'askUser', output: { status: 'awaiting_user', question: 'Connect your account' } }, { name: 'executeTool', input: { name: 'browserAction' } }, { name: 'computerGetState' }, { name: 'executeTool', input: { name: 'androidListDevices' }, output: { ok: true, result: { ok: true, devices: [{ state: 'device' }] } } }], timeline: [{ id: 'qa-progress', type: 'progress', text: 'Reviewed the page' }] }] }]), orb.chatId);
  await expect(ui.getByRole('button', { name: 'Connect your account', exact: true })).toBeVisible();
  await expect(ui.getByRole('heading', { name: 'Devices', exact: true })).toBeVisible();
  await expect(ui.getByText('Browser', { exact: true })).toBeVisible();
  await expect(ui.getByText('Computer', { exact: true })).toBeVisible();
  await expect(ui.getByText('QA computer', { exact: true })).toHaveCount(0);
  await expect(ui.getByText('Android', { exact: true })).toBeVisible();
  await expect(ui.getByRole('region', { name: 'Devices', exact: true })).toContainText('Connected');
  await expect(ui.getByRole('button', { name: 'Reviewed the page', exact: true })).toBeVisible();
  await ui.getByRole('button', {name:'Connect Android',exact:true}).click();
  const pairing=ui.getByRole('dialog',{name:'Connect Android',exact:true});
  await expect(pairing.getByRole('img')).toHaveAttribute('alt','Temporary QR to connect Android to Codeclub');
  const previousVersion=pairingVersion;
  await pairing.getByRole('button',{name:'Refresh',exact:true}).click();
  await expect(pairing.getByRole('img')).toBeVisible();assert.ok(pairingVersion>previousVersion);
  pairingReady=true;await expect(pairing.getByRole('status')).toHaveText('Android paired');
  await expect(pairing.getByRole('button',{name:'Copy code',exact:true})).toBeDisabled();
  await ui.keyboard.press('Escape');await expect(pairing).toHaveCount(0);
  await expect(ui.getByRole('button',{name:'Connect Android',exact:true})).toBeFocused();
  pairingReady=false;
  await ui.getByRole('button', {name:'Credentials',exact:true}).click();
  const credentials = ui.getByRole('dialog', {name:'Credentials',exact:true});
  await expect(credentials.getByLabel('PIN', {exact:true})).toHaveAttribute('type', 'password');
  await credentials.getByLabel('PIN', {exact:true}).fill('1357');
  await credentials.getByRole('button', {name:'Save',exact:true}).click();
  await expect(credentials.getByRole('status')).toHaveText('Saved');
  await expect(credentials.getByLabel('PIN', {exact:true})).toHaveValue('');
  await ui.keyboard.press('Escape');
  await expect(credentials).toHaveCount(0);
  await expect(ui.getByRole('button', {name:'Credentials',exact:true})).toBeFocused();
  await ui.getByRole('button', {name:'Credentials',exact:true}).click();
  await expect(credentials.getByRole('status')).toHaveText('Saved');
  await expect(credentials.getByLabel('PIN', {exact:true})).toHaveValue('');
  await credentials.getByRole('button', {name:'Remove PIN',exact:true}).click();
  await expect(credentials.getByRole('button', {name:'Remove PIN',exact:true})).toHaveCount(0);
  await ui.keyboard.press('Escape');
  await ui.evaluate(chatId => window.qaSessions([{ chatId, projectPath: '', busy: true, state: 'tool_call', tool: 'browserAction', approvals: [], messages: [{ role: 'assistant', timeline: [{ id: 'busy-progress', type: 'progress', text: 'Reading the current page' }] }] }]), orb.chatId);
  await ui.getByRole('button', { name: 'Working', exact: true }).click();
  await expect(ui.getByRole('tooltip')).toContainText('Reading the current page');
  await expect(ui.getByRole('button', { name: 'Working', exact: true }).locator('svg').first()).toHaveClass(/animate-spin/);
  await expect(ui.getByRole('button', { name: 'Clear chat', exact: true })).toBeDisabled();
  await ui.evaluate(({ chatId, messages }) => window.qaSessions([{ chatId, projectPath: '', busy: false, state: 'finished', tool: '', approvals: [], messages }]), { chatId: orb.chatId, messages: histories.get(orb.chatId) });

  settings.codeclub_orbs[0].allowComputer = false;
  await ui.evaluate(() => window.dispatchEvent(new CustomEvent('codeclub:orbs-changed')));
  await ui.getByRole('button', { name: 'Configure', exact: true }).click();
  const dialog = ui.getByRole('dialog'); await expect(dialog).toBeVisible();
  assert.ok((await dialog.boundingBox()).width <= 420);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click(); await expect(dialog).toHaveCount(0);
  assert.equal(settings.codeclub_orbs[0].allowComputer, true, 'Current setup replaces obsolete browser-only access');
  assert.equal(settings.codeclub_last_provider_id, 'ordinary'); assert.equal(settings.codeclub_last_model_id, 'ordinary-model');
  await ui.evaluate(() => { localStorage.setItem('codeclub-language', 'es'); window.dispatchEvent(new CustomEvent('codeclub:language-change', { detail: { language: 'es' } })); });
  await expect(ui.getByRole('heading', { name: 'Configurar', exact: true })).toBeVisible();
  pairingFailure=true;
  await ui.getByRole('button',{name:'Conectar Android',exact:true}).click();
  await expect(ui.getByRole('dialog',{name:'Conectar Android',exact:true}).getByRole('alert')).toContainText('No se pudo preparar');
  pairingFailure=false;await ui.getByRole('button',{name:'Renovar',exact:true}).click();
  await expect(ui.getByRole('dialog',{name:'Conectar Android',exact:true}).getByRole('img')).toBeVisible();
  await ui.keyboard.press('Escape');await expect(ui.getByRole('button',{name:'Conectar Android',exact:true})).toBeFocused();
  assert.ok(nativeCommands.includes('codeclub_android_pairing_cancel'));
  await ui.getByRole('button', {name:'Claves',exact:true}).click();
  await expect(ui.getByRole('dialog', {name:'Claves',exact:true}).getByRole('button', {name:'Guardar',exact:true})).toBeVisible();
  await expect(ui.getByRole('dialog', {name:'Claves',exact:true})).toBeFocused();
  await ui.keyboard.press('Escape');
  await expect(ui.getByRole('dialog', {name:'Claves',exact:true})).toHaveCount(0);
  await ui.getByRole('button', { name: 'Limpiar chat', exact: true }).click();
  await expect(ui.getByRole('log')).not.toContainText('Hi, I’m your orb.');
  assert.deepEqual(histories.get(orb.chatId), []);
  await ui.close();
  for (responseText of ['¿Querés que revisemos los próximos pasos del proyecto?', 'NO_SUGGESTION', 'UPCOMING_SILENCE', 'ERROR']) {
    const history = [{ role: 'assistant', content: 'Existing welcome' }, { role: 'user', content: 'Review the project later' }]; histories.set(orb.chatId, [...history]); requests.length = 0; published.length = 0; nativeCommands.length = 0;
    assignment = { task: { id: `orb_proactive_${orb.id}`, orbId: orb.id, name: orb.name, prompt: JSON.stringify({ currentSurface: 'chat', frequentContexts: [['chat', 4]], upcomingTasks: responseText === 'UPCOMING_SILENCE' ? [{ name: 'QA study session', scheduledAt: '2026-10-09T12:15:00Z', projectPath: '', execution: 'scheduled-with-existing-approvals' }] : [] }), projectPath: '', provider: 'qa', model: 'qa-model', proactive: true, maximumAutonomy: true, allowComputer: false, autonomous: true, language: 'es' }, run: { id: 'run', chatId: orb.chatId } };
    const runner = await browser.newPage(); await prepare(runner); const done = new Promise(resolve => { finish = resolve; }); await runner.goto(`${origin}/runner`);
    const outcome = await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('Runner timeout')), 15000).unref())]);
    const messages = histories.get(orb.chatId); assert.deepEqual(messages.slice(0, 2), history);
    assert.ok(published.every(session => session.messages[0].content === 'Existing welcome'));
    assert.ok(requests.length > 0); assert.equal(requests[0].max_tokens, 350); assert.ok(!requests[0].tools?.length);
    assert.ok(!nativeCommands.includes('codeclub_list_agent_plugins')); assert.ok(!nativeCommands.includes('codeclub_write_file'));
    if (responseText === 'ERROR') { assert.equal(outcome, 'TASK_EXECUTION_FAILED'); assert.equal(messages.filter(message => message.role === 'assistant').length, 1); }
    else { assert.equal(outcome, undefined); assert.equal(messages.filter(message => message.source === 'orb-proactive').length, responseText === 'NO_SUGGESTION' ? 0 : 1); }
    if (responseText === 'UPCOMING_SILENCE') assert.ok(messages.at(-1).content.includes('QA study session'), 'Silent model still delivers a localized approaching task notice');
    await runner.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, continueToChat: true, compactConfiguration: true, isolatedPreferences: true, proactiveDelivery: true, historyPreserved: true, noActionTools: true, silence: true, errorsWithoutSpam: true, language: true }));
} finally {
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory); assert.equal(path.dirname(resolved), path.resolve(tmpdir())); assert.ok(path.basename(resolved).startsWith('codeclub-orb-chat-')); await rm(resolved, { recursive: true, force: true });
}
