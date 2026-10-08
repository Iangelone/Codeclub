import assert from 'node:assert/strict';
import { createResourceTools } from '../src/lib/engine/resource-tools.ts';
import { ORBS_STORAGE_KEY } from '../src/lib/chat-resources.ts';

const settings = new Map();
const files = new Map([
  ['plugin.json', JSON.stringify({ name: 'fixture', version: '1.0.0' })],
  ['skills/one/SKILL.md', 'original'],
  ['mcp.json', JSON.stringify({ mcpServers: { one: { type: 'stdio', command: 'node', env: { API_KEY: 'private-fixture' } }, two: { type: 'stdio', command: 'node' } } })],
]);
let approve = true;
const calls = [];
const events = [];
const plugins = [
  { id: 'fixture', name: 'Fixture', scope: 'global', source: 'global', skills: [{ id: 'one', name: 'One' }, { id: 'two', name: 'Two' }], mcpServers: JSON.parse(files.get('mcp.json')).mcpServers },
  { id: 'builtin', name: 'Built-in', scope: 'global', source: 'global', builtIn: true, skills: [], mcpServers: {} },
];
const target = new EventTarget();
globalThis.window = Object.assign(target, {
  localStorage: { getItem: () => null },
  codeclub: {
    settingsGet: async key => settings.get(key),
    settingsSet: async (key, value) => settings.set(key, structuredClone(value)),
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === 'codeclub_list_agent_plugins') return structuredClone(plugins);
      if (command === 'codeclub_agent_plugin_read_file') return { content: files.get(args.path) };
      if (command === 'codeclub_agent_plugin_write_file') { files.set(args.path, args.content); return { ok: true }; }
      if (command === 'codeclub_agent_plugin_remove_skill') return { ok: true, ...args };
      if (command === 'codeclub_scheduled_list') return [];
      throw Error(`Unexpected command ${command}`);
    },
  },
});
window.addEventListener('codeclub:orbs-changed', () => events.push('orbs'));
window.addEventListener('codeclub:mcp-changed', () => events.push('mcp'));
const tools = createResourceTools({ projectPath: '', providerId: 'fixture-provider', modelId: 'fixture-model', recordToolEvent() {}, setAgentState() {}, requestToolApproval: async () => approve });
const run = (name, input) => tools[name].execute(input, { toolCallId: 'fixture', messages: [] });

const resources = await run('listResources', {});
assert.ok(resources.resources.some(item => item.kind === 'mcp' && item.serverName === 'one'));
assert.ok(!JSON.stringify(resources).includes('private-fixture'), 'Discovery excludes credentials');
await assert.rejects(run('editPluginResource', { action: 'write', scope: 'global', pluginId: 'builtin', path: 'plugin.json', content: '{}' }), /solo lectura/);
await assert.rejects(run('editPluginResource', { action: 'read', scope: 'project', pluginId: 'fixture', path: 'plugin.json' }), /proyecto/);
await assert.rejects(run('editPluginResource', { action: 'read', scope: 'global', pluginId: 'fixture', path: '../outside' }), /Solo se admite/);
await run('editPluginResource', { action: 'write', scope: 'global', pluginId: 'fixture', path: 'skills/one/SKILL.md', content: 'updated' });
assert.equal(files.get('skills/one/SKILL.md'), 'updated');

const inspected=await run('manageMcpServer', { action: 'inspect', scope: 'global', pluginId: 'fixture', serverName: 'one' });
assert.ok(!JSON.stringify(inspected).includes('private-fixture'));
await run('manageMcpServer', { action: 'update', scope: 'global', pluginId: 'fixture', serverName: 'one', configJson: JSON.stringify({ command: 'python' }) });
assert.equal(JSON.parse(files.get('mcp.json')).mcpServers.one.env.API_KEY,'private-fixture','Editing a server preserves its omitted credentials');
await run('manageMcpServer', { action: 'update', scope: 'global', pluginId: 'fixture', serverName: 'two', configJson: JSON.stringify({ type: 'stdio', command: 'python' }) });
let mcp = JSON.parse(files.get('mcp.json'));
assert.equal(mcp.mcpServers.one.env.API_KEY, 'private-fixture', 'Editing one server preserves sibling configuration');
assert.equal(mcp.mcpServers.two.command, 'python');
approve = false;
assert.equal((await run('manageMcpServer', { action: 'remove', scope: 'global', pluginId: 'fixture', serverName: 'one' })).cancelled, true);
assert.equal((await run('deleteSkill', { scope: 'global', pluginId: 'fixture', skillId: 'one' })).cancelled, true);
assert.ok(!calls.some(call => call.command === 'codeclub_agent_plugin_remove_skill'), 'Denied deletion performs no native mutation');
approve = true;
await run('manageMcpServer', { action: 'remove', scope: 'global', pluginId: 'fixture', serverName: 'one' });
mcp = JSON.parse(files.get('mcp.json'));
assert.deepEqual(Object.keys(mcp.mcpServers), ['two'], 'Removing a server preserves the package and other servers');
await run('deleteSkill', { scope: 'global', pluginId: 'fixture', skillId: 'one' });
assert.equal(calls.filter(call => call.command === 'codeclub_agent_plugin_remove_skill').length, 1);
assert.ok(!calls.some(call => call.command === 'codeclub_delete_agent_plugin'), 'Deleting a skill does not delete its plugin');

const orb = await run('manageOrb', { action: 'create', name: 'Fixture orb', purpose: 'Fixture work' });
assert.equal(settings.get(ORBS_STORAGE_KEY)[0].providerId, 'fixture-provider');
await run('manageOrb', { action: 'update', id: orb.id, purpose: 'Updated work' });
assert.equal(settings.get(ORBS_STORAGE_KEY)[0].name, 'Fixture orb');
assert.equal(settings.get(ORBS_STORAGE_KEY)[0].purpose, 'Updated work');
approve = false;
assert.equal((await run('manageOrb', { action: 'remove', id: orb.id })).cancelled, true);
assert.equal(settings.get(ORBS_STORAGE_KEY).length, 1);
approve = true;
await run('manageOrb', { action: 'remove', id: orb.id });
assert.deepEqual(settings.get(ORBS_STORAGE_KEY), []);
assert.ok(events.includes('orbs') && events.includes('mcp'));
assert.ok(!calls.some(call => call.command === 'codeclub_scheduled_run'), 'Creating and editing orbs never starts them');
console.log('Resource tools: scoped edits, read-only built-ins, targeted deletion, approval, orb persistence and secret-free discovery passed.');
