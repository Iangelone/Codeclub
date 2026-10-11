import assert from 'node:assert/strict';
import { createAndroidTools } from '../src/lib/engine/android-tools.ts';
import { createDynamicToolAccess, selectToolsForPrompt } from '../src/lib/engine/tools.ts';
import { adaptLangChainTools } from '../src/lib/engine/run.ts';

const calls = [], events = [];
globalThis.window = { codeclub: { invoke: async (command, args) => {
  calls.push({ command, args });
  return { ok: true, devices: [{ deviceId: 'opaque', state: 'device', model: 'Fixture' }], snapshotId: 'snapshot', elements: [] };
} } };
const tools = createAndroidTools({ projectPath: '', setAgentState() {}, recordToolEvent: (...args) => events.push(args), requestToolApproval: async () => true });
for (const prompt of ['usa mi celular', 'observe Android phone', 'controlar el teléfono']) {
  assert.deepEqual(Object.keys(selectToolsForPrompt(tools, 'development', prompt)).sort(), ['androidAction', 'androidGetState', 'androidListDevices'].sort());
}
const dynamic = createDynamicToolAccess(tools, (...args) => events.push(args));
assert.ok(selectToolsForPrompt(tools, 'development', 'Android screenshot').androidScreenshot);
const discovery = await dynamic.searchTools.execute({ query: 'android' }, {});
assert.equal(discovery.tools.length, 6);
assert.ok(selectToolsForPrompt(tools, 'development', 'bloquea mi celular').androidLock);
assert.ok(selectToolsForPrompt(tools, 'development', 'desbloquea mi celular').androidUnlock);
const adapted = await adaptLangChainTools(dynamic);
const run = input => adapted.executeTool.execute(input, {});
assert.equal((await run({ name: 'androidListDevices', input: {} })).ok, true);
assert.equal(calls[0].command, 'codeclub_android_list_devices');
const before = calls.length;
assert.equal((await run({ name: 'androidAction', input: { deviceId: 'opaque', action: 'erase' } })).ok, false);
assert.equal((await run({ name: 'androidUnlock', input: {deviceId:'opaque', pin:'fixture-secret'} })).ok, false, 'unlock schema rejects secrets');
assert.equal(calls.length, before, 'schema rejects unsupported actions before native effects');
assert.equal((await run({name:'androidUnlock', input:{deviceId:'opaque'}})).ok, true);
assert.equal(calls.at(-1).command, 'codeclub_android_unlock');
assert.equal((await run({ name: 'androidAction', input: { deviceId: 'opaque', action: 'type', text: 'fixture-private-text', snapshotId: 'snapshot' } })).ok, true);
assert.equal(JSON.stringify(events).includes('fixture-private-text'), false, 'audit events omit input text and native snapshots');
const controller = new AbortController(); controller.abort();
const count = calls.length;
assert.equal((await tools.androidGetState.execute({ deviceId: 'opaque' }, { abortSignal: controller.signal })).ok, false);
assert.equal(calls.length, count);
const visionOutput = tools.androidScreenshot.toModelOutput({ output: { ok: true, data: 'fixture-image', snapshotId: 'snapshot' } });
assert.equal(visionOutput.type, 'content');
assert.equal(visionOutput.value[1].type, 'file');
assert.equal(visionOutput.value[1].mediaType, 'image/png');
assert.equal(visionOutput.value[1].data.data, 'fixture-image');
delete globalThis.window;
console.log('Android tool integration passed: bilingual routing, discovery, LangChain schema validation, native command mapping, audit privacy, cancellation.');
