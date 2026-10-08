import assert from 'node:assert/strict';
import { _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const directory = await mkdtemp(path.join(tmpdir(), 'codeclub-plugin-resources-'));
const profile = path.join(directory, 'profile');
let app;
try {
  const wrapper = path.join(directory, 'main.mjs');
  await writeFile(wrapper, `import {app,BrowserWindow} from 'electron';app.setPath('userData',${JSON.stringify(profile)});for(const method of ['show','showInactive','focus','maximize'])BrowserWindow.prototype[method]=function(){};await import(${JSON.stringify(new URL('../electron-dist/main.js', import.meta.url).href)});`);
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [wrapper], env });
  const page = await app.firstWindow();
  await page.waitForFunction(() => Boolean(window.codeclub?.invoke));
  const invoke = (command, args) => page.evaluate(({ command, args }) => window.codeclub.invoke(command, args), { command, args });
  const scope = { projectPath: '', scope: 'global', pluginId: 'fixture' };
  const write = (file, content) => invoke('codeclub_agent_plugin_write_file', { ...scope, path: file, content });
  await write('plugin.json', JSON.stringify({ name: 'fixture', version: '1.0.0' }));
  await write('skills/one/SKILL.md', 'one');
  await write('skills/two/SKILL.md', 'two');
  await write('mcp.json', '{"mcpServers":{}}');
  await invoke('codeclub_agent_plugin_remove_skill', { ...scope, skillId: 'one' });
  assert.equal((await invoke('codeclub_agent_plugin_read_file', { ...scope, path: 'skills/two/SKILL.md' })).content, 'two');
  assert.equal((await invoke('codeclub_agent_plugin_read_file', { ...scope, path: 'mcp.json' })).content, '{"mcpServers":{}}');
  await assert.rejects(invoke('codeclub_agent_plugin_remove_skill', { ...scope, skillId: '../../outside' }));
  await assert.rejects(write('../outside.txt', 'bad'));
  const outside = path.join(directory, 'outside');
  await mkdir(outside);
  await writeFile(path.join(outside, 'SKILL.md'), 'protected');
  await symlink(outside, path.join(profile, 'plugins', 'fixture', 'skills', 'escape'), 'junction');
  await assert.rejects(invoke('codeclub_agent_plugin_remove_skill', { ...scope, skillId: 'escape' }));
  await assert.rejects(write('skills/escape/SKILL.md', 'bad'));
  await assert.rejects(invoke('codeclub_agent_plugin_read_file', { ...scope, path: 'skills/escape/SKILL.md' }));
  assert.equal(await readFile(path.join(outside, 'SKILL.md'), 'utf8'), 'protected');
  console.log('Native plugin resources: targeted skill removal, sibling preservation and junction/traversal isolation passed.');
} finally {
  await app?.close();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith('codeclub-plugin-resources-')) throw Error('Unexpected test directory');
  await rm(resolved, { recursive: true, force: true });
}
