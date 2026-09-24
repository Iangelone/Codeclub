import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ComputerUse, ocrElements, omniElements, localParserUrl } from '../electron-dist/computer-use.js';

const element = { runtimeId: '1.2', name: 'Save', role: 'Button', className: 'Button', automationId: 'save', processId: 4, windowId: '10', bounds: { x: -500, y: 50, width: 100, height: 40 }, enabled: true, offscreen: false, patterns: ['Invoke'] };
const state = () => ({ ok: true, window: { ...element, runtimeId: '1', role: 'Window' }, focused: element, elements: [structuredClone(element)] });
function setup() {
  const calls = []; let time = 1000; let failAction = false;
  const engine = new ComputerUse(async (command, request) => { calls.push({ command, request }); return command === 'action' ? { ok: !failAction, error: failAction ? 'Focus changed' : undefined } : state(); }, path.resolve('public/tesseract'), () => time);
  return { engine, calls, advance: () => { time += 91000; }, fail: () => { failAction = true; } };
}
test('requires a current reference; never defaults missing coordinates to 0,0', async () => {
  const { engine, calls } = setup();
  assert.equal((await engine.run('action', { action: 'click' })).ok, false);
  const observed = await engine.run('state');
  assert.equal((await engine.run('action', { action: 'click', snapshotId: observed.snapshotId })).ok, false);
  assert.equal(calls.filter((c) => c.command === 'action').length, 0);
});
test('semantic action is scoped, returns new observation and consumes old references', async () => {
  const { engine, calls } = setup();
  const observed = await engine.run('state');
  const result = await engine.run('action', { action: 'click', snapshotId: observed.snapshotId, ref: 'e1' });
  assert.equal(result.ok, true); assert.equal(result.verification.verified, false);
  assert.notEqual(result.state.snapshotId, observed.snapshotId);
  const action = calls.find((c) => c.command === 'action').request;
  assert.equal(action.windowId, '10'); assert.equal(action.target.runtimeId, '1.2');
  assert.equal((await engine.run('action', { action: 'click', snapshotId: observed.snapshotId, ref: 'e1' })).ok, false);
});
test('expired, foreign and failed actions cannot silently succeed', async () => {
  const { engine, calls, advance, fail } = setup();
  let observed = await engine.run('state'); advance();
  assert.equal((await engine.run('action', { action: 'click', snapshotId: observed.snapshotId, ref: 'e1' })).ok, false);
  observed = await engine.run('state');
  assert.equal((await engine.run('action', { action: 'click', snapshotId: observed.snapshotId, ref: 'e999' })).ok, false);
  fail(); const result = await engine.run('action', { action: 'click', snapshotId: observed.snapshotId, ref: 'e1' });
  assert.equal(result.ok, false); assert.equal(result.error, 'Focus changed');
  assert.equal(calls.filter((c) => c.command === 'action').length, 1);
});
test('OCR reads current block layout and maps negative monitor coordinates', () => {
  const parsed = ocrElements({ blocks: [{ paragraphs: [{ lines: [{ text: 'Guardar archivo', confidence: 90, bbox: { x0: 100, y0: 40, x1: 300, y1: 80 } }] }] }] }, { x: -1920, y: 100 }, 2);
  assert.equal(parsed[0].name, 'Guardar archivo');
  assert.deepEqual(parsed[0].bounds, { x: -1870, y: 120, width: 100, height: 20 });
  assert.equal(parsed[0].role, 'TextRegion');
  assert.deepEqual(ocrElements({ blocks: null }, { x: 0, y: 0 }), []);
});
test('stop invalidates snapshots and queued work', async () => {
  const { engine, calls } = setup();
  const observed = await engine.run('state');
  const action = engine.run('action', { action: 'click', snapshotId: observed.snapshotId, ref: 'e1' });
  engine.stop();
  assert.equal((await action).ok, false);
  assert.equal(calls.filter((c) => c.command === 'action').length, 0);
});
test('OmniParser validates boxes and distinguishes icon candidates from text', () => {
  const capture = { origin: { x: -100, y: 20 }, width: 1000, height: 500 };
  const items = omniElements([
    { type: 'icon', content: 'Open settings', interactivity: true, bbox: [0.1, 0.2, 0.2, 0.4] },
    { type: 'text', content: 'Heading', interactivity: false, bbox: [0.2, 0.2, 0.4, 0.4] },
    { type: 'icon', content: 'Invalid', bbox: [-1, 0, 1, 1] },
  ], capture);
  assert.equal(items.length, 2); assert.equal(items[0].role, 'IconCandidate');
  assert.deepEqual(items[0].bounds, { x: 0, y: 120, width: 100, height: 100 });
  assert.deepEqual(items[1].actions, []);
  assert.throws(() => omniElements({}, capture));
});
test('optional parser cannot upload screenshots to a remote host', () => {
  assert.equal(localParserUrl('http://127.0.0.1:8000').href, 'http://127.0.0.1:8000/parse/');
  for (const url of ['https://example.com', 'http://localhost:8000', 'http://127.0.0.1.evil.com', 'http://user:secret@127.0.0.1', 'http://127.0.0.1/?token=x']) assert.throws(() => localParserUrl(url));
});
