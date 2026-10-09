import assert from 'node:assert/strict';
import { asSchema } from 'ai';
import { createTools, createDynamicToolAccess } from '../src/lib/engine/tools.ts';
import { adaptLangChainTools } from '../src/lib/engine/run.ts';

let nativeCalls = 0, events = 0, approvals = 0;
globalThis.window = { codeclub: { invoke: async () => { nativeCalls++; throw Error('Invalid arguments reached native operations'); } } };
try {
  const definitions = createTools({ projectPath: 'C:\\fixture', projectScoped: true, recordToolEvent: () => { events++; }, setAgentState() {}, requestToolApproval: async () => { approvals++; return false; } });
  Object.assign(definitions, createDynamicToolAccess(definitions));
  const adapted = await adaptLangChainTools(definitions);
  let checks = 0;
  for (const [name, definition] of Object.entries(definitions)) {
    assert.equal(typeof definition.description, 'string', `${name} needs a description`);
    const schema = await asSchema(definition.inputSchema).jsonSchema;
    assert.equal(schema.type, 'object', `${name} uses an object contract`);
    assert.equal(schema.additionalProperties, false, `${name} rejects unknown fields`);
    for (const input of [null, [], { __invalidArgument: true }, ...(schema.required?.length ? [{}] : [])]) {
      await assert.rejects(adapted[name].execute(input, { toolCallId: `contract-${name}`, messages: [] }), /schema/, `${name} must reject invalid arguments`);
      checks++;
    }
  }
  assert.equal(nativeCalls, 0);
  assert.equal(approvals, 0);
  assert.equal(events, 0);
  console.log(JSON.stringify({ passed: true, tools: Object.keys(definitions).length, rejectedInputs: checks, nativeEffects: nativeCalls }));
} finally { delete globalThis.window; }
