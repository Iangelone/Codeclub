import assert from 'node:assert/strict';
import { jsonSchema, Output, tool } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import { adaptLangChainTools, runStream } from '../src/lib/engine/run.ts';
import { createDynamicToolAccess } from '../src/lib/engine/tools.ts';

const usage = { inputTokens: { total: 10 }, outputTokens: { total: 4, text: 3, reasoning: 1 } };
const stream = (parts, reason) => ({ stream: simulateReadableStream({ chunks: [
  { type: 'stream-start', warnings: [] }, ...parts,
  { type: 'finish', finishReason: { unified: reason, raw: reason }, usage },
], initialDelayInMs: null, chunkDelayInMs: null }) });
let effects = 0;
const tools = { change: tool({
  description: 'Fixture effect',
  inputSchema: jsonSchema({ type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false }),
  execute: async ({ value }) => { effects++; return { ok: true, value }; },
}) };
const call = (id) => ({ type: 'tool-call', toolCallId: id, toolName: 'change', input: '{"value":7}' });
const discovery = createDynamicToolAccess(tools);
const discovered = await discovery.searchTools.execute({ query: 'change' }, {});
assert.equal(discovered.tools[0].schema.type, 'object');
assert.equal(discovered.tools[0].schema.properties.value.type, 'number');
assert.equal(discovered.tools[0].schema.jsonSchema, undefined, 'Discovery must unwrap SDK schemas');
let dynamicEffects = 0;
const dynamic = createDynamicToolAccess({ write: tool({
  inputSchema: jsonSchema({ type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false }),
  execute: async input => { dynamicEffects++; return input; },
}) });
const dynamicAdapted = await adaptLangChainTools(dynamic);
const encoded = await dynamicAdapted.executeTool.execute({ name: 'write', input: JSON.stringify({ content: 'first\nsecond' }) }, {});
assert.equal(encoded.result.content, 'first\nsecond');
assert.equal(dynamicEffects, 1);
for (const input of ['{invalid', '[]', 'null', '{}', { content: 42 }, { content: 'x', unknown: true }]) {
  const rejected = await dynamicAdapted.executeTool.execute({ name: 'write', input }, {});
  assert.equal(rejected.ok, false);
}
assert.equal(dynamicEffects, 1, 'Dynamic dispatch must validate nested arguments before effects');
const text = [{ type: 'text-start', id: 'answer' }, { type: 'text-delta', id: 'answer', delta: 'Verified.' }, { type: 'text-end', id: 'answer' }];
const model = new MockLanguageModelV3({ doStream: [stream([call('one')], 'tool-calls'), stream(text, 'stop')] });
const steps = [], deltas = [], endings = [], usages = [], modelCalls = [];
const result = await runStream({ model, system: 'Fixture', messages: [{ role: 'user', content: 'Change once' }], tools,
  callbacks: { onModelCall: metrics => modelCalls.push(metrics), onTextDelta: value => deltas.push(value), onStepEnd: step => steps.push(step.stepNumber), onEnd: info => endings.push(info), onUsage: info => usages.push(info) },
});
assert.equal(result, 'Verified.'); assert.equal(effects, 1);
assert.deepEqual(steps, [0, 1]); assert.equal(endings.length, 1); assert.equal(endings[0].steps.length, 2);
assert.equal(usages.length, 1); assert.equal(usages[0].inputTokens, 20); assert.equal(usages[0].outputTokens, 8); assert.equal(usages[0].reasoningTokens, 2);
assert.equal(deltas.at(-1), 'Verified.');
assert.ok(model.doStreamCalls[1].prompt.some(message => message.role === 'tool'));
assert.deepEqual(modelCalls.map(call => call.status), ['started', 'completed', 'started', 'completed']);
assert.equal(modelCalls[0].callId, modelCalls[1].callId);
assert.notEqual(modelCalls[0].callId, modelCalls[2].callId);
assert.equal(modelCalls[1].inputTokens, 10);
assert.equal(modelCalls[1].outputTokens, 4);
assert.equal(modelCalls[1].attempt, 1);
assert(modelCalls[1].durationMs >= 0);
assert(modelCalls[1].context.beforeBytes >= modelCalls[1].context.afterBytes);

const adapted = await adaptLangChainTools(tools);
await assert.rejects(adapted.change.execute({ value: 'invalid' }, {}));
assert.equal(effects, 1, 'LangChain validation must precede native effects');
const abort = new AbortController(); abort.abort();
await assert.rejects(async () => adapted.change.execute({ value: 7 }, { abortSignal: abort.signal }));
assert.equal(effects, 1);

const invalidModel = new MockLanguageModelV3({ doStream: [
  stream([{ ...call('invalid'), input: '{"value":"invalid"}' }], 'tool-calls'),
  stream([call('corrected')], 'tool-calls'), stream(text, 'stop'),
] });
assert.equal(await runStream({ model: invalidModel, system: 'Fixture', messages: [{ role: 'user', content: 'Recover from invalid arguments' }], tools, callbacks: { onTextDelta: () => {} } }), 'Verified.');
assert.equal(invalidModel.doStreamCalls.length, 3, 'Tool errors must reach the next model step so it can correct its arguments');
assert.equal(effects, 2, 'Only the corrected call may perform the effect');
effects = 1;

let limitEnd;
const endless = new MockLanguageModelV3({ doStream: () => stream([call(`next-${effects}`)], 'tool-calls') });
await runStream({ model: endless, system: 'Fixture', messages: [{ role: 'user', content: 'Loop' }], tools, maxSteps: 2,
  callbacks: { onTextDelta: () => {}, onEnd: info => { limitEnd = info; } },
});
assert.equal(endless.doStreamCalls.length, 2); assert.equal(effects, 3);
assert.equal(limitEnd.steps.at(-1).finishReason, 'tool-calls');

let failedCalls = 0;
const failedMetrics = [];
const failure = new MockLanguageModelV3({ doStream: () => {
  if (failedCalls++ === 0) return stream([call('before-failure')], 'tool-calls');
  return stream([{ type: 'error', error: new Error('Fixture transport failed') }], 'error');
} });
await assert.rejects(runStream({ model: failure, system: 'Fixture', messages: [{ role: 'user', content: 'Fail after effect' }], tools, callbacks: { onModelCall: metrics => failedMetrics.push(metrics), onTextDelta: () => {} } }));
assert.equal(effects, 4, 'A later transport failure must not replay the graph effect');
assert.equal(failedCalls, 2);
assert.equal(failedMetrics.at(-1).status, 'error');
assert.equal(failedMetrics.at(-1).inputTokens, undefined, 'Unknown usage must not be reported as zero');

const rateLimit = Object.assign(new Error('Rate limit'), { name: 'RateLimitError', responseHeaders: { 'retry-after': '0' } });
const throttled = new MockLanguageModelV3({ doStream: [stream([call('before-limit')], 'tool-calls'), stream([{ type: 'error', error: rateLimit }], 'error'), stream(text, 'stop')] });
const retryMetrics = [];
assert.equal(await runStream({ model: throttled, system: 'Fixture', messages: [{ role: 'user', content: 'Finish after quota recovery' }], tools, callbacks: { onModelCall: metrics => retryMetrics.push(metrics), onTextDelta: () => {} } }), 'Verified.');
assert.equal(retryMetrics.find(metrics => metrics.status === 'retrying').retryDelayMs, 0);
assert.equal(retryMetrics.at(-1).attempt, 2);
assert.equal(effects, 5, 'Rate-limit recovery must not replay the previous tool effect');
assert.equal(throttled.doStreamCalls.length, 3);
const exhausted = new MockLanguageModelV3({ doStream: () => stream([{ type: 'error', error: rateLimit }], 'error') });
await assert.rejects(runStream({ model: exhausted, system: 'Fixture', messages: [{ role: 'user', content: 'Bound recovery' }], tools: {}, callbacks: { onTextDelta: () => {} } }));
assert.equal(exhausted.doStreamCalls.length, 3, 'Rate-limit recovery must stop after two retries');
const partialLimit = new MockLanguageModelV3({ doStream: stream([call('partial-limit'), { type: 'error', error: rateLimit }], 'error') });
await assert.rejects(runStream({ model: partialLimit, system: 'Fixture', messages: [{ role: 'user', content: 'Never replay a partially executed step' }], tools, callbacks: { onTextDelta: () => {} } }));
assert.equal(partialLimit.doStreamCalls.length, 1, 'A tool call in the failed step forbids replay');
const backoffAbort = new AbortController();
const pausedModel = new MockLanguageModelV3({ doStream: stream([{ type: 'error', error: Object.assign(new Error('Rate limit'), { name: 'RateLimitError', responseHeaders: { 'retry-after': '5' } }) }], 'error') });
const pausedRun = runStream({ model: pausedModel, system: 'Fixture', messages: [{ role: 'user', content: 'Cancel during backoff' }], tools: {}, signal: backoffAbort.signal, callbacks: { onTextDelta: () => {} } });
setTimeout(() => backoffAbort.abort(), 20);
await assert.rejects(pausedRun);
assert.equal(pausedModel.doStreamCalls.length, 1);

const unavailable = Object.assign(new Error('Service temporarily unavailable'), { statusCode: 503, responseHeaders: { 'retry-after': '0' } });
const recovered = new MockLanguageModelV3({ doStream: [stream([{ type: 'error', error: unavailable }], 'error'), stream(text, 'stop')] });
assert.equal(await runStream({ model: recovered, system: 'Fixture', messages: [{ role: 'user', content: 'Recover temporary outage' }], tools: {}, callbacks: { onTextDelta: () => {} } }), 'Verified.');
assert.equal(recovered.doStreamCalls.length, 2);
const serviceDown = new MockLanguageModelV3({ doStream: () => stream([{ type: 'error', error: unavailable }], 'error') });
await assert.rejects(runStream({ model: serviceDown, system: 'Fixture', messages: [{ role: 'user', content: 'Bound outage retries' }], tools: {}, callbacks: { onTextDelta: () => {} } }));
assert.equal(serviceDown.doStreamCalls.length, 3);
const partialOutage = new MockLanguageModelV3({ doStream: stream([call('partial-outage'), { type: 'error', error: unavailable }], 'error') });
await assert.rejects(runStream({ model: partialOutage, system: 'Fixture', messages: [{ role: 'user', content: 'No replay after a tool' }], tools, callbacks: { onTextDelta: () => {} } }));
assert.equal(partialOutage.doStreamCalls.length, 1);
const forbidden = new MockLanguageModelV3({ doStream: stream([{ type: 'error', error: Object.assign(new Error('Unauthorized'), { statusCode: 401 }) }], 'error') });
await assert.rejects(runStream({ model: forbidden, system: 'Fixture', messages: [{ role: 'user', content: 'No retry for invalid credentials' }], tools: {}, callbacks: { onTextDelta: () => {} } }));
assert.equal(forbidden.doStreamCalls.length, 1);
const separated = new MockLanguageModelV3({ doStream: [stream([...text, call('between-paragraphs')], 'tool-calls'), stream(text, 'stop')] });
assert.equal(await runStream({ model: separated, system: 'Fixture', messages: [{ role: 'user', content: 'Separate step text' }], tools, callbacks: { onTextDelta: () => {} } }), 'Verified.\n\nVerified.');

let structured;
const objectModel = new MockLanguageModelV3({ doStream: stream([
  { type: 'text-start', id: 'json' }, { type: 'text-delta', id: 'json', delta: '{"completed":true}' }, { type: 'text-end', id: 'json' },
], 'stop') });
await runStream({ model: objectModel, system: 'Fixture', messages: [{ role: 'user', content: 'Verify' }], tools: {},
  structuredOutput: Output.object({ schema: jsonSchema({ type: 'object', properties: { completed: { type: 'boolean' } }, required: ['completed'] }) }),
  callbacks: { onTextDelta: () => { throw new Error('Structured output must not stream raw JSON into the chat'); }, onStructuredOutput: value => { structured = value; } },
});
assert.deepEqual(structured, { completed: true });

const browserResults = [], browserMetrics = [];
const browserTools = { getBrowserState: tool({
  inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false }),
  execute: async () => {
    const observation = { ok: true, snapshotId: `observation-${browserResults.length + 1}`, url: 'https://example.org', text: 'Unique page evidence', elements: [{ selector: '#play', tag: 'button', name: 'Play', text: 'Play', bounds: { x: 1, y: 2, width: 30, height: 30 } }], media: [{ paused: false, muted: false }] };
    browserResults.push(observation);
    return observation;
  },
}) };
const browserCall = id => ({ type: 'tool-call', toolCallId: id, toolName: 'getBrowserState', input: '{}' });
const browserModel = new MockLanguageModelV3({ doStream: [stream([browserCall('first')], 'tool-calls'), stream([browserCall('second')], 'tool-calls'), stream(text, 'stop')] });
await runStream({ model: browserModel, system: 'Fixture', messages: [{ role: 'user', content: 'Inspect browser' }], tools: browserTools, callbacks: { onTextDelta: () => {}, onModelCall: metrics => browserMetrics.push(metrics) } });
const browserPrompt = JSON.stringify(browserModel.doStreamCalls.at(-1).prompt);
assert(browserPrompt.includes('observation-2'), 'Latest snapshot must reach the model');
assert(!browserPrompt.includes('observation-1'), 'Stale selectors/IDs must not reach the next request');
assert(browserPrompt.includes('#play'));
assert(browserPrompt.includes('Unique page evidence'));
assert.equal(browserResults[0].snapshotId, 'observation-1', 'The raw executor evidence must stay intact');
assert(browserMetrics.at(-1).context.afterBytes < browserMetrics.at(-1).context.beforeBytes);

const cancelled = new AbortController();
let abortNotified = 0;
const cancelledModel = new MockLanguageModelV3(); cancelled.abort();
await assert.rejects(runStream({ model: cancelledModel, system: 'Fixture', messages: [{ role: 'user', content: 'Cancel' }], tools: {}, signal: cancelled.signal,
  callbacks: { onTextDelta: () => {}, onAbort: () => { abortNotified++; } },
}));
assert.equal(cancelledModel.doStreamCalls.length, 0); assert.equal(abortNotified, 1);
console.log('Agent graph: LangChain validation, multi-step continuation, streaming, structured output, total usage, limits, abort and no replay after partial failure passed.');

// Discovery promotes arbitrary tools with their exact schemas on the next model step.
const promotedAccess = createDynamicToolAccess(tools);
const promotedModel = new MockLanguageModelV3({ doStream: [
  stream([{ type: 'tool-call', toolCallId: 'discover', toolName: 'searchTools', input: '{"query":"change"}' }], 'tool-calls'),
  stream([call('promoted')], 'tool-calls'), stream(text, 'stop'),
] });
const beforeEffects = effects;
await runStream({ model: promotedModel, system: 'Fixture', messages: [{ role: 'user', content: 'Discover then change' }], tools: promotedAccess, callbacks: { onTextDelta: () => {} } });
assert.equal(effects, beforeEffects + 1);
assert(!promotedModel.doStreamCalls[0].tools.some(entry => entry.name === 'change'));
assert(promotedModel.doStreamCalls[1].tools.some(entry => entry.name === 'change' && entry.inputSchema.properties.value.type === 'number'));
assert(JSON.stringify(promotedModel.doStreamCalls[1].prompt).includes('schemaInToolDefinition'));
const { getDiscoveredTools, compactToolSchemas } = await import('../src/lib/engine/tool-discovery.ts');
assert(!getDiscoveredTools(createDynamicToolAccess(tools)).change, 'Discovery stays isolated per session');
const catalog = [{ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'fixture', toolName: 'searchTools', output: { type: 'json', value: discovered } }] }];
const originalCatalog = JSON.stringify(catalog);
const compactedCatalog = compactToolSchemas(catalog, new Map([['change', discovered.tools[0].schema]]));
assert.equal(compactedCatalog.schemasCompacted, 1);
assert.equal(JSON.stringify(catalog), originalCatalog, 'Audit data must remain intact');
assert.equal(compactToolSchemas(compactedCatalog.messages, new Map()).schemasCompacted, 0);
assert.equal(compactToolSchemas(catalog, new Map([['change', { type: 'string' }]])).schemasCompacted, 0);
await dynamicAdapted.executeTool.execute({ name: 'write', input: { content: 'again' } }, {});
assert.equal(dynamicEffects, 2, 'Definition reuse must never cache effects');
console.log('Tool discovery promotion and schema compaction passed.');
