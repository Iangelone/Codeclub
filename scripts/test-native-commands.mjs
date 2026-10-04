import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-native-command-'));
const project = path.join(directory, 'project');
await mkdir(project);
let app;
const fixturePids = new Set();
const server = createServer((_, response) => response.end('<title>Native command QA</title>'));
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app,BrowserWindow} from 'electron';app.setPath('userData',${JSON.stringify(path.join(directory, 'profile'))});for(const method of ['show','showInactive','focus','maximize'])BrowserWindow.prototype[method]=function(){};await import(${JSON.stringify(new URL('../electron-dist/main.js', import.meta.url).href)});`);
  const env = { ...process.env, CODECLUB_NEXT_DEV_URL: `http://127.0.0.1:${server.address().port}` };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [wrapper], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.codeclub?.invoke);
  const invoke = request => page.evaluate(({ request, project }) => window.codeclub.invoke('codeclub_run_command', { projectPath: project, request }), { request, project });
  const success = await invoke({ command: process.execPath, args: ['-e', 'console.log(process.argv[1])', 'literal $value; & text'] });
  assert.equal(success.ok, true);
  assert.equal(success.stdout.trim(), 'literal $value; & text');
  const failure = await invoke({ command: process.execPath, args: ['-e', 'process.exit(7)'] });
  assert.equal(failure.ok, false); assert.equal(failure.code, 7);
  if (process.platform === 'win32') {
    await writeFile(path.join(project, 'literal.cmd'), '@echo off\r\necho %~1\r\nexit /b 9\r\n');
    const shim = await invoke({ command: path.join(project, 'literal.cmd'), args: ["spaces $value; text's"] });
    assert.equal(shim.code, 9); assert.equal(shim.ok, false);
    assert.equal(shim.stdout.trim(), "spaces $value; text's");
  }
  const pidFile = path.join(project, 'child.pid');
  const hanging = `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},1000);`;
  const timed = await invoke({ command: process.execPath, args: ['-e', hanging], timeoutMs: 4000 });
  assert.equal(timed.ok, false); assert.equal(timed.error, 'COMMAND_TIMEOUT');
  const pid = Number(await readFile(pidFile, 'utf8'));
  fixturePids.add(pid);
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.throws(() => process.kill(pid, 0), 'Timeout must stop the child process too');
  await writeFile(path.join(project, 'detached.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
  await writeFile(path.join(project, 'detached.cmd'), `@echo off\r\nstart "" /B "${process.execPath}" "${path.join(project, 'detached.mjs')}"\r\nexit /b 0\r\n`);
  const detached = await invoke({ command: path.join(project, 'detached.cmd'), args: [], timeoutMs: 4000 });
  const detachedPid = Number(await readFile(pidFile, 'utf8'));
  fixturePids.add(detachedPid);
  if (detached.ok) assert.equal(detached.code, 0); else assert.equal(detached.error, 'COMMAND_TIMEOUT');
  const until = Date.now() + 5000;
  while (Date.now() < until) { try { process.kill(detachedPid, 0); } catch { break; } await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.throws(() => process.kill(detachedPid, 0), 'Background child must stop even after parent exit');
  console.log('Native commands: literal arguments, Windows shims, exit codes, timeout and descendant cleanup passed.');
} finally {
  for (const pid of fixturePids) { try { process.kill(pid); } catch {} }
  await app?.close();
  await new Promise(resolve => server.close(resolve));
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`) && path.basename(resolved).startsWith('codeclub-native-command-'));
  await rm(resolved, { recursive: true, force: true });
}
