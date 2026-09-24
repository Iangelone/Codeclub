import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools, createDynamicToolAccess } from '../src/lib/engine/tools';

test('dynamic tool execution preserves native failures and redacts desktop audit payloads', async () => {
  const events: unknown[] = [];
  const calls: string[] = [];
  (globalThis as any).window = { codeclub: { invoke: async (command: string) => { calls.push(command); return { ok: false, error: 'Focus changed' }; } } };
  try {
    const log = (...args: unknown[]) => events.push(args);
    const tools = createTools({ projectPath: '', recordToolEvent: log, setAgentState: () => {}, requestToolApproval: async () => true });
    const dynamic = createDynamicToolAccess(tools, log) as any;
    const output = await dynamic.executeTool.execute({ name: 'computerAction', input: { action: 'type', text: 'private text', snapshotId: 's' } }, { toolCallId: 'test', messages: [] });
    assert.equal(output.ok, false); assert.equal(output.result.ok, false);
    assert.ok(!JSON.stringify(events).includes('private text'));
    assert.deepEqual(calls, ['codeclub_computer_action']);
  } finally { delete (globalThis as any).window; }
});

test('aborting an SDK tool call cancels the native desktop host through dynamic access', async () => {
  const calls: string[] = [];
  let finish!: (result: unknown) => void;
  (globalThis as any).window = { codeclub: { invoke: async (command: string) => {
    calls.push(command);
    if (command === 'codeclub_computer_stop') { finish({ ok: false, error: 'Cancelled' }); return { ok: true }; }
    return new Promise((resolve) => { finish = resolve; });
  } } };
  try {
    const tools = createTools({ projectPath: '', recordToolEvent: () => {}, setAgentState: () => {}, requestToolApproval: async () => true });
    const dynamic = createDynamicToolAccess(tools) as any;
    const abort = new AbortController();
    const result = dynamic.executeTool.execute({ name: 'computerGetState', input: {} }, { toolCallId: 'test', messages: [], abortSignal: abort.signal });
    abort.abort();
    assert.equal((await result).ok, false);
    assert.deepEqual(calls, ['codeclub_computer_get_state', 'codeclub_computer_stop']);
  } finally { delete (globalThis as any).window; }
});
