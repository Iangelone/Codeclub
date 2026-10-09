import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compactBrowserContext } from '../src/lib/engine/browser-context.ts';

const control = { selector: '#play', tag: 'button', role: '', name: 'Play', text: 'Play', disabled: false, bounds: { x: 1, y: 2, width: 30, height: 30 } };
const state = (snapshotId, text = 'Page evidence') => ({ ok: true, browserId: 'browser', targetId: 'tab', snapshotId, url: 'https://example.org/', title: 'Example', text, elements: [control, { selector: '#password', tag: 'input', type: 'password' }], media: [{ paused: false, muted: false, volume: 0.4 }] });
const result = (id, value, toolName = 'executeTool', type = 'json') => ({ role: 'tool', content: [{ type: 'tool-result', toolCallId: id, toolName, output: { type, value: type === 'text' ? JSON.stringify(value) : value } }] });
const wrapped = value => ({ ok: true, tool: 'externalBrowserAction', result: { ok: true, state: value } });
const messages = [
  { role: 'user', content: 'Inspect the page' },
  result('old', wrapped(state('old'))),
  result('new', wrapped(state('new'))),
];
const original = JSON.stringify(messages);
const compacted = compactBrowserContext(messages);
assert.equal(JSON.stringify(messages), original, 'Raw audit data must not be mutated');
const old = compacted.messages[1].content[0].output.value.result.state;
const latest = compacted.messages[2].content[0].output.value.result.state;
assert.equal(old.context.historical, true);
assert.equal(old.snapshotId, undefined, 'Expired references must not be offered to the model');
assert.equal(old.elements, undefined);
assert.equal(old.text, undefined, 'Only exactly equivalent page text is omitted');
assert.equal(old.context.repeatedTextOmitted, true);
assert.equal(latest.snapshotId, 'new');
assert.deepEqual(latest.elements.map(element => element.selector), ['#play', '#password']);
assert.deepEqual(latest.media, state('new').media);
assert.equal(latest.elements[0].name, 'Play');
assert.equal(latest.elements[0].text, undefined);
assert.equal(latest.elements[0].bounds, undefined);
assert.equal(compacted.stats.historicalSnapshots, 1);
assert(compacted.stats.afterBytes < compacted.stats.beforeBytes);

const distinct = compactBrowserContext([result('one', wrapped(state('one', 'Important earlier evidence'))), result('two', wrapped(state('two', 'Different later evidence')))]);
assert.equal(distinct.messages[0].content[0].output.value.result.state.text, 'Important earlier evidence');
const otherTab = { ...state('other'), targetId: 'other-tab' };
assert.equal(compactBrowserContext([result('a', wrapped(state('a'))), result('b', wrapped(otherTab))]).stats.historicalSnapshots, 0);
const failure = result('error', { ok: false, tool: 'externalBrowserState', result: { ok: false, error: 'Snapshot expired' } });
const file = result('file', state('file'), 'readFile');
assert.deepEqual(compactBrowserContext([failure, file]).messages, [failure, file]);
const direct = compactBrowserContext([result('direct', state('direct'), 'getBrowserState', 'text')]);
assert.equal(JSON.parse(direct.messages[0].content[0].output.value).snapshotId, 'direct');
assert.equal(direct.stats.snapshotsCompacted, 1);
const compactAgain = compactBrowserContext(compacted.messages);
assert.deepEqual(compactAgain.messages, compacted.messages, 'Compaction must be idempotent');
console.log('Browser context: selectors, media, unique evidence, errors, target isolation, text/JSON envelopes and audit preservation passed.');

// Optional offline measurement on a user-supplied trace; never sends it to a provider.
if (process.argv[2]) {
  const trace = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  const turn = trace.messages.at(-1);
  const events = turn.timeline.filter(event => event.type === 'tool' && event.output?.type === 'tool-result');
  const context = events.map(event => result(event.id, event.output.output, event.name));
  const measured = compactBrowserContext(context);
  assert.equal(measured.messages.length, context.length);
  console.log(JSON.stringify({ ...measured.stats, savedPercent: Number((100 * (1 - measured.stats.afterBytes / measured.stats.beforeBytes)).toFixed(1)) }));
}
